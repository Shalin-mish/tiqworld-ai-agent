import { healthCheck }    from './healthCheck.js';
import { findTodos }      from './findTodos.js';
import { checkEnvUsage }  from './checkEnvUsage.js';
import { detectDeadCode } from './detectDeadCode.js';
import { gitLog }         from './gitLog.js';
import { lintFile }       from './lintFile.js';
import { config }         from '../config.js';

export const fullScanDefinition = {
  name: 'full_scan',
  description:
    'Run all maintenance checks in one shot: health_check, find_todos, check_env_usage, detect_dead_code, git_log (last 7 days), and lint_file. Each step is timed. Returns a unified report with per-section timing so you know what took long. Use this as the single maintenance trigger instead of running tools one by one.',
  input_schema: {
    type: 'object',
    properties: {
      lint_path: {
        type: 'string',
        description: 'Directory to lint (default: backend/src)',
      },
      todo_path: {
        type: 'string',
        description: 'Directory to scan for TODOs (default: entire codebase)',
      },
    },
  },
};

async function timed(label, fn) {
  const t0 = Date.now();
  let result;
  try {
    result = await fn();
  } catch (err) {
    result = { error: err.message };
  }
  const ms = Date.now() - t0;
  return { label, result, duration_ms: ms };
}

export async function fullScan({ lint_path, todo_path } = {}) {
  const cb = config.codebasePath;
  const scanStarted = new Date().toISOString();
  const t0 = Date.now();

  // Run all scans in parallel — independent of each other
  const sections = await Promise.all([
    timed('health_check',    () => healthCheck()),
    timed('find_todos',      () => findTodos({ directory: todo_path ?? cb })),
    timed('check_env_usage', () => checkEnvUsage()),
    timed('detect_dead_code',() => detectDeadCode({ directory: todo_path ?? `${cb}/backend/src` })),
    timed('git_log',         () => gitLog({ count: 20, since: '7 days ago' })),
    timed('lint_file',       () => lintFile({ path: lint_path ?? 'backend/src' })),
  ]);

  const totalMs = Date.now() - t0;

  // Build summary counts so agent can lead with the important numbers
  const health   = sections[0].result;
  const todos    = sections[1].result;
  const env      = sections[2].result;
  const dead     = sections[3].result;
  const log      = sections[4].result;
  const lint     = sections[5].result;

  const summary = {
    critical_todos:       todos?.by_severity?.critical?.length ?? 0,
    warning_todos:        todos?.by_severity?.warning?.length  ?? 0,
    missing_env_vars:     env?.missing_from_example?.length    ?? 0,
    dead_code_files:      dead?.dead_files?.length             ?? 0,
    lint_errors:          lint?.total_errors                   ?? 0,
    lint_warnings:        lint?.total_warnings                 ?? 0,
    uncommitted_files:    health?.git_status?.uncommitted_files ?? 0,
    total_code_files:     health?.code_files                   ?? 0,
    recent_commits:       log?.commits?.length                 ?? 0,
  };

  const timings = Object.fromEntries(
    sections.map(s => [s.label, `${s.duration_ms}ms`])
  );

  return {
    scan_started:  scanStarted,
    total_duration_ms: totalMs,
    summary,
    timings,
    sections: Object.fromEntries(sections.map(s => [s.label, s.result])),
  };
}
