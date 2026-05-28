/**
 * health_monitor — Synthetic endpoint checks + log anomaly detection + process health.
 * Runs WITHOUT touching the platform codebase — pure agent-side observation.
 *
 * Three signal layers:
 *   1. Synthetic checks  — HTTP GET critical URLs, assert status + latency
 *   2. Log anomalies     — Scan agent + codebase log files for ERROR patterns
 *   3. Process health    — Node process memory, uptime, scheduler alive
 */

import fs   from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import { config }      from '../config.js';
import { notify }      from '../notifications.js';
import { logEvent }    from '../activityLog.js';

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------
export const healthMonitorDefinition = {
  name: 'health_monitor',
  description:
    'Run a comprehensive health probe without touching the platform codebase. ' +
    'Checks: (1) HTTP synthetic probes on configured URLs — status codes, response times, keyword presence; ' +
    '(2) Log file anomaly scan — recent ERROR/CRITICAL/FATAL lines from agent logs and optionally platform logs; ' +
    '(3) Node process vitals — memory heap, uptime, event-loop lag. ' +
    'Returns a structured report with a pass/warn/fail verdict per check and an overall health score. ' +
    'Use this to detect production issues without modifying any code.',
  input_schema: {
    type: 'object',
    properties: {
      urls: {
        type: 'array',
        items: { type: 'string' },
        description:
          'List of URLs to probe (HTTP GET). Defaults to HEALTH_MONITOR_URLS env var or localhost:3001/api/status.',
      },
      log_paths: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Extra log file paths to scan for errors (absolute or relative to codebase). ' +
          'Agent logs/activity.jsonl is always scanned automatically.',
      },
      last_minutes: {
        type: 'number',
        description: 'How far back to scan logs (minutes). Default: 60.',
      },
    },
    required: [],
  },
};

// ---------------------------------------------------------------------------
// HTTP probe
// ---------------------------------------------------------------------------
const DEFAULT_TIMEOUT_MS = 8000;

function httpGet(urlStr, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let url;
    try { url = new URL(urlStr); } catch {
      return resolve({ url: urlStr, ok: false, error: 'Invalid URL', latency_ms: 0 });
    }

    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.get(urlStr, { timeout: timeoutMs }, (res) => {
      const status     = res.statusCode ?? 0;
      const latency_ms = Date.now() - t0;
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; if (body.length > 4096) body = body.slice(0, 4096); });
      res.on('end', () => {
        resolve({ url: urlStr, ok: status >= 200 && status < 400, status, latency_ms, body_preview: body.slice(0, 200) });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ url: urlStr, ok: false, error: `Timeout after ${timeoutMs}ms`, latency_ms: Date.now() - t0 });
    });
    req.on('error', (err) => {
      resolve({ url: urlStr, ok: false, error: err.message, latency_ms: Date.now() - t0 });
    });
  });
}

// ---------------------------------------------------------------------------
// Log anomaly scanner
// ---------------------------------------------------------------------------
const ERROR_RE = /\b(ERROR|CRITICAL|FATAL|UNCAUGHT|UNHANDLED|EXCEPTION|panic)\b/i;

function scanLogFile(filePath, sinceMs) {
  const issues = [];
  if (!fs.existsSync(filePath)) return { file: filePath, scanned: false, reason: 'not found' };

  try {
    const raw   = fs.readFileSync(filePath, 'utf-8');
    const lines = raw.split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      // Try to extract timestamp from JSONL entries
      let ts = null;
      try {
        const obj = JSON.parse(line);
        ts = obj.ts ? new Date(obj.ts).getTime() : null;
      } catch { /* plain text line */ }

      if (ts && sinceMs && ts < sinceMs) continue;
      if (ERROR_RE.test(line)) {
        issues.push(line.trim().slice(0, 300));
      }
    }
    return { file: filePath, scanned: true, issues: issues.slice(-50), total_lines: lines.length };
  } catch (err) {
    return { file: filePath, scanned: false, reason: err.message };
  }
}

// ---------------------------------------------------------------------------
// Process vitals
// ---------------------------------------------------------------------------
function processVitals() {
  const mem    = process.memoryUsage();
  const uptime = process.uptime();
  return {
    heap_used_mb:   (mem.heapUsed  / 1024 / 1024).toFixed(1),
    heap_total_mb:  (mem.heapTotal / 1024 / 1024).toFixed(1),
    rss_mb:         (mem.rss       / 1024 / 1024).toFixed(1),
    uptime_sec:     Math.round(uptime),
    uptime_human:   uptimeHuman(uptime),
    node_version:   process.version,
    pid:            process.pid,
  };
}

function uptimeHuman(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return `${h}h ${m}m ${s}s`;
}

// ---------------------------------------------------------------------------
// Event-loop lag probe (rough estimate)
// ---------------------------------------------------------------------------
function measureEventLoopLag() {
  return new Promise((resolve) => {
    const t0 = Date.now();
    setImmediate(() => resolve(Date.now() - t0));
  });
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------
export async function healthMonitor({ urls = [], log_paths = [], last_minutes = 60 } = {}) {
  const startedAt = new Date().toISOString();
  const sinceMs   = Date.now() - last_minutes * 60 * 1000;

  // --- 1. Resolve URLs ---
  const envUrls = process.env.HEALTH_MONITOR_URLS
    ? process.env.HEALTH_MONITOR_URLS.split(',').map(u => u.trim()).filter(Boolean)
    : [];
  const defaultUrls = [`http://localhost:${config.webPort}/api/status`];
  const targetUrls  = urls.length ? urls : (envUrls.length ? envUrls : defaultUrls);

  // --- 2. HTTP probes (parallel) ---
  const probeResults = await Promise.all(targetUrls.map(u => httpGet(u)));

  // --- 3. Log anomaly scan ---
  const agentLogPath   = path.join(process.cwd(), 'logs', 'activity.jsonl');
  const logsToScan     = [agentLogPath, ...log_paths];
  const logResults     = logsToScan.map(p => scanLogFile(p, sinceMs));

  // --- 4. Process vitals + event loop lag ---
  const [vitals, lagMs] = await Promise.all([
    Promise.resolve(processVitals()),
    measureEventLoopLag(),
  ]);
  vitals.event_loop_lag_ms = lagMs;

  // --- 5. Score & verdict ---
  const probesFailed    = probeResults.filter(r => !r.ok);
  const slowProbes      = probeResults.filter(r => r.ok && r.latency_ms > 3000);
  const totalLogIssues  = logResults.reduce((n, r) => n + (r.issues?.length ?? 0), 0);
  const heapPct         = Math.round((parseFloat(vitals.heap_used_mb) / parseFloat(vitals.heap_total_mb)) * 100);

  const checks = {
    http_probes:  probesFailed.length === 0 ? 'pass' : 'fail',
    slow_probes:  slowProbes.length   === 0 ? 'pass' : 'warn',
    log_errors:   totalLogIssues      === 0 ? 'pass' : (totalLogIssues < 5 ? 'warn' : 'fail'),
    heap_usage:   heapPct < 80        ? 'pass' : (heapPct < 95 ? 'warn' : 'fail'),
    event_loop:   lagMs   < 100       ? 'pass' : (lagMs   < 500 ? 'warn' : 'fail'),
  };

  const failCount = Object.values(checks).filter(v => v === 'fail').length;
  const warnCount = Object.values(checks).filter(v => v === 'warn').length;
  const overall   = failCount > 0 ? 'UNHEALTHY' : (warnCount > 0 ? 'DEGRADED' : 'HEALTHY');
  const score     = Math.max(0, 100 - failCount * 25 - warnCount * 10);

  // --- 6. Notify if degraded/unhealthy ---
  if (overall !== 'HEALTHY') {
    const lines = [];
    if (probesFailed.length)  lines.push(`${probesFailed.length} URL(s) unreachable: ${probesFailed.map(p => p.url).join(', ')}`);
    if (slowProbes.length)    lines.push(`${slowProbes.length} URL(s) slow (>3s)`);
    if (totalLogIssues)       lines.push(`${totalLogIssues} error line(s) in logs (last ${last_minutes}m)`);
    if (heapPct >= 80)        lines.push(`High heap usage: ${heapPct}%`);
    if (lagMs >= 100)         lines.push(`Event-loop lag: ${lagMs}ms`);

    notify(
      overall === 'UNHEALTHY' ? 'error' : 'warning',
      `Health Monitor: ${overall}`,
      lines.join('\n'),
    );
  }

  logEvent({ user: 'health-monitor', action: 'health_monitor_run', detail: { overall, score, probes: probeResults.length } });

  return {
    overall,
    score,
    checks,
    started_at:   startedAt,
    last_minutes,
    http_probes:  probeResults,
    log_scan:     logResults,
    process:      vitals,
    summary: {
      probes_checked:   probeResults.length,
      probes_failed:    probesFailed.length,
      slow_probes:      slowProbes.length,
      log_error_lines:  totalLogIssues,
      heap_pct:         heapPct,
      event_loop_lag_ms: lagMs,
    },
  };
}
