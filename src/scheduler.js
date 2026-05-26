import cron from 'node-cron';
import { fullScan }    from './tools/fullScan.js';
import { lintFile }   from './tools/lintFile.js';
import { findTodos }  from './tools/findTodos.js';
import { healthCheck } from './tools/healthCheck.js';
import { runCommand } from './tools/runCommand.js';
import { runAgent, ALL_TOOLS }   from './agent.js';
import { acquireLock, releaseAllLocks } from './tools/fileLock.js';
import { saveMaintenanceReport, formatReportSummary } from './tools/maintenanceReport.js';
import { config } from './config.js';

let _nightTask     = null;
let _dayTask       = null;
let lastScanResult = null;
let lastScanTime   = null;

// ---------------------------------------------------------------------------
// Live status — lets admin UI poll or receive SSE updates
// ---------------------------------------------------------------------------
const _status = {
  state:       'idle',   // idle | running | done | error
  mode:        null,     // 'deep' | 'light'
  startedAt:   null,
  finishedAt:  null,
  progress:    [],       // [{step, msg, at}]
  lastReport:  null,
  error:       null,
};

// Optional SSE broadcast hook — set by server.js
let _broadcastFn = null;
export function setBroadcastFn(fn) { _broadcastFn = fn; }

function pushProgress(step, msg) {
  const entry = { step, msg, at: new Date().toISOString() };
  _status.progress.push(entry);
  _broadcastFn?.(entry);
  console.log(`[Maintenance] ${step}: ${msg}`);
}

export function getMaintenanceStatus() {
  return { ..._status };
}

export function getLastScan() {
  return { result: lastScanResult, scannedAt: lastScanTime };
}

// ---------------------------------------------------------------------------
// Safety gates
// ---------------------------------------------------------------------------

const HIGH_RISK_PATTERNS = [
  '/routes/', '/models/', '/middleware/',
  'auth', 'config.js', 'index.js', 'server.js', 'app.js',
];

function isHighRisk(filePath) {
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
      working_directory:  config.codebasePath,
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

  pushProgress('start', `Night maintenance started`);

  // Step 1 — Full scan
  pushProgress('scan', 'Running full scan...');
  let scan;
  try {
    scan = await fullScan();
    lastScanResult = scan;
    lastScanTime   = new Date().toISOString();
    const s = scan.summary;
    pushProgress('scan', `Scan done — ${s.critical_todos} critical TODOs, ${s.lint_errors} lint errors, ${s.dead_code_files} dead files, ${s.uncommitted_files} uncommitted`);
  } catch (err) {
    scan = { error: err.message, summary: {} };
    pushProgress('scan', `Scan failed: ${err.message}`);
  }

  // Step 2 — Run tests
  pushProgress('tests', 'Running test suite...');
  const tests = await runTests();
  pushProgress('tests', `Tests: ${tests.passed ? 'PASS' : 'FAIL'}`);

  // Step 3 — Auto-fix safe issues
  const issueCount = (scan?.summary?.lint_errors ?? 0) + (scan?.summary?.critical_todos ?? 0);
  if (config.autoFixEnabled && issueCount > 0) {
    pushProgress('fix', `Auto-fixing ${issueCount} issue(s)...`);
    try {
      await runAgent(
        `AUTONOMOUS MAINTENANCE MODE — proceed without human confirmation.\n\n` +
        `Codebase scan summary:\n${JSON.stringify(scan?.summary ?? {}, null, 2)}\n\n` +
        `Task: Fix all SAFE issues only (lint errors, missing null checks, unused variables, console.log cleanup).\n\n` +
        `MANDATORY RULES — never break these:\n` +
        `1. SKIP any file that contains in its path: routes/, models/, middleware/, auth, config.js, index.js, server.js, app.js\n` +
        `2. Only apply a fix if fix_error returns confidence >= ${config.autoFixMinConfidence}\n` +
        `3. Always follow the exact sequence: git_backup → show_diff → write_file → run_command\n` +
        `4. Fix one file at a time — never batch multiple files in a single write_file call\n` +
        `5. Run npm test after each fix to confirm nothing broke\n` +
        `6. If a fix causes a test failure, do NOT proceed with more fixes\n\n` +
        `Feature additions, schema changes, and route changes are STRICTLY OFF-LIMITS.`,
        [],
        ALL_TOOLS,
        null,
        'maintenance-scheduler',
        makeWriteApprovalFn(writeLog),
        commandApprovalFn,
      );
    } catch (err) {
      pushProgress('fix', `Auto-fix error: ${err.message}`);
      _status.error = err.message;
    }
  } else if (!config.autoFixEnabled) {
    pushProgress('fix', 'Auto-fix disabled (AUTO_FIX_ENABLED=false). Scan-only mode.');
  } else {
    pushProgress('fix', 'No issues found. Codebase is clean.');
  }

  const duration_sec = ((Date.now() - t0) / 1000).toFixed(1);
  const fixes = {
    applied: writeLog.filter(w =>  w.approved),
    skipped: writeLog.filter(w => !w.approved),
  };

  const report = { mode: 'night', started_at: _status.startedAt, duration_sec, scan, tests, fixes };
  const reportPath = saveMaintenanceReport(report);
  pushProgress('done', `Report saved: ${reportPath}. Applied: ${fixes.applied.length} fix(es), Skipped: ${fixes.skipped.length}.`);

  _status.state      = 'done';
  _status.finishedAt = new Date().toISOString();
  _status.lastReport = report;

  console.log(`\n${formatReportSummary(report)}`);
  releaseAllLocks('maintenance-scheduler');
  return report;
}

// ---------------------------------------------------------------------------
// Day: light scan — no fixes, just visibility
// ---------------------------------------------------------------------------

async function runDayScan() {
  _status.state    = 'running';
  _status.mode     = 'light';
  _status.startedAt = new Date().toISOString();
  _status.progress  = [];
  _status.error     = null;

  const t0 = Date.now();
  pushProgress('start', 'Day light scan started');
  try {
    const [lint, todos, health] = await Promise.all([
      lintFile({   path:      'backend/src' }),
      findTodos({  directory: config.codebasePath }),
      healthCheck(),
    ]);
    lastScanResult = { lint, todos, health };
    lastScanTime   = new Date().toISOString();
    const errors    = lint?.total_errors                     ?? 0;
    const criticals = todos?.by_severity?.critical?.length  ?? 0;
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
    console.log(`[Scheduler] Interval mode: deep maintenance every ${intervalMinutes} min`);
    return;
  }

  const nightCron = config.nightMaintenanceCron;
  const dayCron   = config.dayLightScanCron;

  if (nightCron && cron.validate(nightCron)) {
    _nightTask = cron.schedule(nightCron, runNightMaintenance, { timezone: 'Asia/Kolkata' });
    console.log(`[Scheduler] Night deep maintenance : ${nightCron} IST`);
  } else {
    console.warn(`[Scheduler] Invalid NIGHT_MAINTENANCE_CRON: "${nightCron}" — night maintenance disabled`);
  }

  if (dayCron && cron.validate(dayCron)) {
    _dayTask = cron.schedule(dayCron, runDayScan, { timezone: 'Asia/Kolkata' });
    console.log(`[Scheduler] Day light scan         : ${dayCron} IST`);
  } else {
    console.warn(`[Scheduler] Invalid DAY_LIGHT_SCAN_CRON: "${dayCron}" — day scans disabled`);
  }

  runDayScan();
}

export function stopScheduler() {
  _nightTask?.stop();
  _dayTask?.stop();
  _nightTask = null;
  _dayTask   = null;
  console.log('[Scheduler] Stopped.');
}

export async function triggerScan(mode = 'light') {
  if (mode === 'deep') return runNightMaintenance();
  await runDayScan();
  return lastScanResult;
}
