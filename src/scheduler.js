import cron from 'node-cron';
import { fullScan }    from './tools/fullScan.js';
import { lintFile }   from './tools/lintFile.js';
import { findTodos }  from './tools/findTodos.js';
import { healthCheck } from './tools/healthCheck.js';
import { runCommand } from './tools/runCommand.js';
import { gitBackup }  from './tools/gitBackup.js';
import { runAgent, ALL_TOOLS }   from './agent.js';
import { acquireLock, releaseAllLocks } from './tools/fileLock.js';
import { saveMaintenanceReport, formatReportSummary } from './tools/maintenanceReport.js';
import { config } from './config.js';
import { notify } from './notifications.js';

let _nightTask     = null;
let _dayTask       = null;
let lastScanResult = null;
let lastScanTime   = null;

// ---------------------------------------------------------------------------
// Live status
// ---------------------------------------------------------------------------
const _status = {
  state:      'idle',
  mode:       null,
  startedAt:  null,
  finishedAt: null,
  progress:   [],
  lastReport: null,
  error:      null,
};

let _broadcastFn = null;
export function setBroadcastFn(fn) { _broadcastFn = fn; }

function pushProgress(step, msg) {
  const entry = { step, msg, at: new Date().toISOString() };
  _status.progress.push(entry);
  _broadcastFn?.(entry);
  console.log(`[Maintenance] ${step}: ${msg}`);
}

export function getMaintenanceStatus() { return { ..._status }; }
export function getLastScan() { return { result: lastScanResult, scannedAt: lastScanTime }; }

// ---------------------------------------------------------------------------
// Safety gates
// ---------------------------------------------------------------------------

// Any file whose path matches one of these patterns is NEVER auto-written.
// IMPORTANT: tests/ and *.test.* are here so the agent cannot overwrite
// test files to make itself appear green — an agent must not be its own judge.
const HIGH_RISK_PATTERNS = [
  // Original MERN patterns
  '/routes/', '/models/', '/middleware/',
  'config.js', 'index.js', 'server.js', 'app.js',
  // tiq_workplace microservice patterns (TypeScript)
  'config.ts', 'server.ts', 'app.ts',
  '/config/', 'database.config', 'env.ts', 'env.js',
  'auth-service/src/modules/auth/',    // core auth logic — never auto-touch
  'auth-service/src/config/',
  // Test files — agent must never be its own judge
  'tests/', '__tests__/', '.test.', '.spec.',
];

export function isHighRisk(filePath) {
  return HIGH_RISK_PATTERNS.some(p => filePath.toLowerCase().includes(p));
}

const SAFE_COMMAND_PREFIXES = ['npm test', 'npm run test', 'npx eslint', 'node --check'];
function commandApprovalFn({ command = '' }) {
  return SAFE_COMMAND_PREFIXES.some(p => command.trim().startsWith(p));
}

function makeWriteApprovalFn(writeLog) {
  return ({ file_path, description }) => {
    if (isHighRisk(file_path)) {
      writeLog.push({ file: file_path, approved: false, reason: 'high-risk file — skipped by safety gate' });
      pushProgress('safety', `Auto-rejected (high-risk): ${file_path}`);
      return false;
    }
    acquireLock(file_path, 'maintenance-scheduler');
    writeLog.push({ file: file_path, description: description ?? 'auto-fix', approved: true });
    pushProgress('write', `Auto-approved write: ${file_path}`);
    return true;
  };
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

async function runTests() {
  try {
    const result = await runCommand({
      command:            'npm test',
      directory:          '',
      _commandApprovalFn: () => true,
      _user:              'maintenance-scheduler',
    });
    const passed = !result.error &&
      (result.exit_code === 0 || String(result.stdout ?? '').includes('passing'));
    return { passed, output: result.stdout ?? result.error ?? '', exit_code: result.exit_code ?? -1 };
  } catch (err) {
    return { passed: false, output: err.message, exit_code: 1 };
  }
}

// ---------------------------------------------------------------------------
// Rollback helper — restores last git_backup checkpoint
// ---------------------------------------------------------------------------

async function rollbackLastWrite(label) {
  pushProgress('rollback', `Tests failed after ${label} — rolling back via git_backup restore`);
  try {
    await gitBackup({ action: 'restore', _user: 'maintenance-scheduler' });
    pushProgress('rollback', 'Rollback complete. Codebase restored to pre-fix state.');
  } catch (err) {
    pushProgress('rollback', `Rollback FAILED: ${err.message} — manual check required`);
  }
}

// ---------------------------------------------------------------------------
// Night: deep maintenance
// ---------------------------------------------------------------------------

async function runNightMaintenance() {
  _status.state      = 'running';
  _status.mode       = 'deep';
  _status.startedAt  = new Date().toISOString();
  _status.finishedAt = null;
  _status.progress   = [];
  _status.error      = null;

  const t0       = Date.now();
  const writeLog = [];

  pushProgress('start', 'Night maintenance started');

  pushProgress('scan', 'Running full scan...');
  let scan;
  try {
    scan = await fullScan();
    lastScanResult = scan;
    lastScanTime   = new Date().toISOString();
    const s = scan.summary;
    pushProgress('scan', `Scan done — ${s.critical_todos} critical TODOs, ${s.lint_errors} lint errors, ${s.dead_code_files} dead files`);
  } catch (err) {
    scan = { error: err.message, summary: {} };
    pushProgress('scan', `Scan failed: ${err.message}`);
  }

  pushProgress('tests', 'Running test suite...');
  const testsBefore = await runTests();
  pushProgress('tests', `Tests before fixes: ${testsBefore.passed ? 'PASS' : 'FAIL'}`);

  // If tests were already failing before we touch anything, skip auto-fix —
  // we don't want to make an already-broken state harder to diagnose.
  if (!testsBefore.passed) {
    pushProgress('fix', 'Tests failing before any fixes — skipping auto-fix to avoid compounding issues.');
    _status.error = 'Pre-existing test failures detected — auto-fix skipped.';
  } else {
    const issueCount = (scan?.summary?.lint_errors ?? 0) + (scan?.summary?.critical_todos ?? 0);
    if (config.autoFixEnabled && issueCount > 0) {
      pushProgress('fix', `Auto-fixing ${issueCount} issue(s)...`);
      let fixAborted = false;
      try {
        await runAgent(
          `AUTONOMOUS MAINTENANCE MODE — proceed without human confirmation.\n\n` +
          `Codebase scan summary:\n${JSON.stringify(scan?.summary ?? {}, null, 2)}\n\n` +
          `Task: Fix all SAFE issues only (lint errors, missing null checks, unused variables, console.log cleanup).\n\n` +
          `MANDATORY RULES:\n` +
          `1. SKIP any file containing: routes/, models/, middleware/, auth, config.js, index.js, server.js, app.js\n` +
          `2. NEVER touch test files (tests/, *.test.*, *.spec.*) — tests are written by humans and reviewed independently\n` +
          `3. Only apply fix if fix_error confidence >= ${config.autoFixMinConfidence}\n` +
          `4. Sequence: git_backup → show_diff → write_file → run_command\n` +
          `5. Fix one file at a time\n` +
          `6. Run npm test after each fix\n` +
          `7. If run_command shows test failure after a write_file, IMMEDIATELY call git_backup with action=restore, then STOP\n` +
          `8. Feature additions, schema changes, route changes are STRICTLY OFF-LIMITS.`,
          [],
          ALL_TOOLS,
          null,
          'maintenance-scheduler',
          makeWriteApprovalFn(writeLog),
          commandApprovalFn,
          'maintenance-scheduler',
          20,
        );
      } catch (err) {
        pushProgress('fix', `Auto-fix error: ${err.message}`);
        _status.error = err.message;
        fixAborted = true;
      }

      // Final safety net: run tests again. If they're now failing, rollback.
      if (!fixAborted) {
        pushProgress('tests', 'Running post-fix test suite...');
        const testsAfter = await runTests();
        pushProgress('tests', `Tests after fixes: ${testsAfter.passed ? 'PASS' : 'FAIL'}`);
        if (!testsAfter.passed) {
          await rollbackLastWrite('auto-fix run');
          _status.error = 'Post-fix tests failed — all changes rolled back.';
        }
      }
    } else if (!config.autoFixEnabled) {
      pushProgress('fix', 'Auto-fix disabled. Scan-only mode.');
    } else {
      pushProgress('fix', 'No issues found. Codebase is clean.');
    }
  }

  const duration_sec = ((Date.now() - t0) / 1000).toFixed(1);
  const fixes = {
    applied: writeLog.filter(w =>  w.approved),
    skipped: writeLog.filter(w => !w.approved),
  };

  const testsResult = await runTests();
  const report = { mode: 'night', started_at: _status.startedAt, duration_sec, scan, tests: testsResult, fixes };
  const reportPath = saveMaintenanceReport(report);
  pushProgress('done', `Report saved: ${reportPath}. Applied: ${fixes.applied.length}, Skipped: ${fixes.skipped.length}.`);

  _status.state      = 'done';
  _status.finishedAt = new Date().toISOString();
  _status.lastReport = report;

  // — Send notification —
  const s = scan?.summary ?? {};
  const hasIssues = (s.critical_todos ?? 0) > 0 || (s.lint_errors ?? 0) > 0 || !testsResult.passed;
  if (_status.error) {
    notify('error', 'Night Maintenance Failed',
      `Error: ${_status.error}\nDuration: ${duration_sec}s`);
  } else if (hasIssues) {
    notify('warning', 'Night Maintenance Done — Issues Found',
      `${fixes.applied.length} fixed, ${fixes.skipped.length} need attention.\n` +
      `TODOs: ${s.critical_todos ?? 0}, Lint errors: ${s.lint_errors ?? 0}, Tests: ${testsResult.passed ? 'PASS' : 'FAIL'}`);
  } else {
    notify('success', 'Night Maintenance Complete',
      `Codebase is clean. ${fixes.applied.length} auto-fix(es) applied. Duration: ${duration_sec}s`);
  }

  console.log(`\n${formatReportSummary(report)}`);
  releaseAllLocks('maintenance-scheduler');
  return report;
}

// ---------------------------------------------------------------------------
// Day: light scan
// ---------------------------------------------------------------------------

async function runDayScan() {
  _status.state     = 'running';
  _status.mode      = 'light';
  _status.startedAt = new Date().toISOString();
  _status.progress  = [];
  _status.error     = null;

  const t0 = Date.now();
  pushProgress('start', 'Day light scan started');
  try {
    const [lint, todos, health] = await Promise.all([
      lintFile({   file_path: 'backend/src' }),
      findTodos({  directory: config.codebasePath }),
      healthCheck(),
    ]);
    lastScanResult = { lint, todos, health };
    lastScanTime   = new Date().toISOString();
    const errors    = lint?.total_errors ?? 0;
    const criticals = todos?.by_severity?.critical ?? 0;
    const elapsed   = ((Date.now() - t0) / 1000).toFixed(1);
    pushProgress('done', `Day scan done in ${elapsed}s — ${errors} lint errors, ${criticals} critical TODOs`);
  } catch (err) {
    pushProgress('error', `Day scan failed: ${err.message}`);
    _status.error = err.message;
  }
  _status.state      = 'done';
  _status.finishedAt = new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Scheduler control
// ---------------------------------------------------------------------------

export function startScheduler(intervalMinutes = 0) {
  if (intervalMinutes > 0) {
    runNightMaintenance();
    setInterval(runNightMaintenance, intervalMinutes * 60 * 1000);
    console.log(`[Scheduler] Interval mode: every ${intervalMinutes} min`);
    return;
  }
  const nightCron = config.nightMaintenanceCron;
  const dayCron   = config.dayLightScanCron;
  if (nightCron && cron.validate(nightCron)) {
    _nightTask = cron.schedule(nightCron, runNightMaintenance, { timezone: 'Asia/Kolkata' });
    console.log(`[Scheduler] Night maintenance : ${nightCron} IST`);
  } else {
    console.warn(`[Scheduler] Invalid NIGHT_MAINTENANCE_CRON: "${nightCron}"`);
  }
  if (dayCron && cron.validate(dayCron)) {
    _dayTask = cron.schedule(dayCron, runDayScan, { timezone: 'Asia/Kolkata' });
    console.log(`[Scheduler] Day light scan    : ${dayCron} IST`);
  } else {
    console.warn(`[Scheduler] Invalid DAY_LIGHT_SCAN_CRON: "${dayCron}"`);
  }
  runDayScan();
}

export function stopScheduler() {
  _nightTask?.stop(); _dayTask?.stop();
  _nightTask = null;  _dayTask = null;
  console.log('[Scheduler] Stopped.');
}

export function getSchedulerHealth() {
  return {
    night_task_active:       !!_nightTask,
    day_task_active:         !!_dayTask,
    night_cron:              config.nightMaintenanceCron,
    day_cron:                config.dayLightScanCron,
    auto_fix_enabled:        config.autoFixEnabled,
    auto_fix_min_confidence: config.autoFixMinConfidence,
    last_scan_at:            lastScanTime,
  };
}

export async function triggerScan(mode = 'light') {
  if (mode === 'deep') return runNightMaintenance();
  await runDayScan();
  return lastScanResult;
}
