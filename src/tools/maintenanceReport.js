import fs   from 'fs';
import path from 'path';

const LOGS_DIR = path.join(process.cwd(), 'logs');

function ensureLogsDir() {
  if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
}

export function saveMaintenanceReport(report) {
  ensureLogsDir();
  const ts   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
  const file = path.join(LOGS_DIR, `maintenance-${ts}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2), 'utf-8');
  return file;
}

export function listReports(limit = 50) {
  ensureLogsDir();
  const files = fs.readdirSync(LOGS_DIR)
    .filter(f => f.startsWith('maintenance-') && f.endsWith('.json'))
    .sort()
    .reverse()
    .slice(0, limit);

  return files.map(f => {
    try {
      const raw    = fs.readFileSync(path.join(LOGS_DIR, f), 'utf-8');
      const data   = JSON.parse(raw);
      const s      = data.scan?.summary ?? {};
      return {
        file,
        mode:          data.mode,
        started_at:    data.started_at,
        duration_sec:  data.duration_sec,
        tests_passed:  data.tests?.passed ?? null,
        fixes_applied: data.fixes?.applied?.length ?? 0,
        fixes_skipped: data.fixes?.skipped?.length ?? 0,
        critical_todos: s.critical_todos ?? 0,
        lint_errors:    s.lint_errors    ?? 0,
        dead_files:     s.dead_code_files ?? 0,
      };
    } catch (_) {
      return { file: f, error: 'parse error' };
    }
  });
}

export function formatReportSummary(report) {
  const { mode, started_at, duration_sec, scan, tests, fixes } = report;
  const bar = '━'.repeat(52);
  const lines = [
    bar,
    `MAINTENANCE REPORT — ${mode.toUpperCase()} — ${new Date(started_at).toLocaleString('en-IN')}`,
    `Duration: ${duration_sec}s`,
    bar,
  ];

  if (scan?.summary) {
    const s = scan.summary;
    lines.push(
      'SCAN RESULTS:',
      `  Critical TODOs : ${s.critical_todos}`,
      `  Lint errors    : ${s.lint_errors}`,
      `  Dead files     : ${s.dead_code_files}`,
      `  Uncommitted    : ${s.uncommitted_files}`,
      `  Missing env    : ${s.missing_env_vars}`,
    );
  }

  if (tests) {
    lines.push('');
    const status = tests.passed ? '✓ PASS' : '✗ FAIL';
    lines.push(`TESTS: ${status}`);
    if (!tests.passed && tests.output) {
      lines.push(`  ${tests.output.slice(0, 200)}`);
    }
  }

  if (fixes?.applied?.length) {
    lines.push('', 'AUTO-FIXED:');
    fixes.applied.forEach(f => lines.push(`  ✓ ${f.file} — ${f.description}`));
  }

  if (fixes?.skipped?.length) {
    lines.push('', 'NEEDS ATTENTION (not auto-fixed):');
    fixes.skipped.forEach(f => lines.push(`  ⚠  ${f.file} — ${f.reason}`));
  }

  if (!fixes?.applied?.length && !fixes?.skipped?.length) {
    lines.push('', 'No issues to fix — codebase is clean.');
  }

  lines.push(bar);
  return lines.join('\n');
}
