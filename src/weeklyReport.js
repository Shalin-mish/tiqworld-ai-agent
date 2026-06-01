import fs   from 'fs';
import path from 'path';
import { listReports } from './tools/maintenanceReport.js';
import { notify }      from './notifications.js';

const LOGS_DIR = path.join(process.cwd(), 'logs');

// Build weekly summary from last 7 days of maintenance reports
export function buildWeeklyReport() {
  const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const all   = listReports(200).filter(r => {
    if (r.error) return false;
    return new Date(r.started_at).getTime() >= since;
  });

  if (all.length === 0) {
    return {
      week_start:   new Date(since).toISOString().slice(0, 10),
      week_end:     new Date().toISOString().slice(0, 10),
      runs:         0,
      fixes_total:  0,
      skipped_total: 0,
      tests_failed: 0,
      top_issues:   [],
      summary:      'No maintenance runs in the past 7 days.',
    };
  }

  const fixes_total  = all.reduce((s, r) => s + (r.fixes_applied ?? 0), 0);
  const skipped_total = all.reduce((s, r) => s + (r.fixes_skipped ?? 0), 0);
  const tests_failed = all.filter(r => r.tests_passed === false).length;
  const max_todos    = Math.max(...all.map(r => r.critical_todos ?? 0));
  const max_lint     = Math.max(...all.map(r => r.lint_errors   ?? 0));
  const max_dead     = Math.max(...all.map(r => r.dead_files     ?? 0));

  const top_issues = [];
  if (max_todos  > 0) top_issues.push(`${max_todos} critical TODOs`);
  if (max_lint   > 0) top_issues.push(`${max_lint} lint errors`);
  if (max_dead   > 0) top_issues.push(`${max_dead} dead files`);
  if (tests_failed > 0) top_issues.push(`tests failed ${tests_failed}x`);

  const health = top_issues.length === 0 ? '✅ Clean' : `⚠️ ${top_issues.join(', ')}`;

  return {
    week_start:    new Date(since).toISOString().slice(0, 10),
    week_end:      new Date().toISOString().slice(0, 10),
    runs:          all.length,
    fixes_total,
    skipped_total,
    tests_failed,
    top_issues,
    health,
    summary: `${all.length} runs | ${fixes_total} auto-fixed | ${skipped_total} need attention | ${health}`,
  };
}

// Format for Slack (rich block kit message)
export function formatSlackReport(report) {
  const statusEmoji = report.top_issues.length === 0 ? '✅' : '⚠️';
  const lines = [
    `${statusEmoji} *TIQ Agent — Weekly Report* (${report.week_start} → ${report.week_end})`,
    ``,
    `📊 *This week:*`,
    `• Maintenance runs: *${report.runs}*`,
    `• Auto-fixes applied: *${report.fixes_total}*`,
    `• Issues needing attention: *${report.skipped_total}*`,
    `• Test failures: *${report.tests_failed}*`,
  ];

  if (report.top_issues.length > 0) {
    lines.push(``, `🔴 *Top issues:*`);
    report.top_issues.forEach(i => lines.push(`  • ${i}`));
  } else {
    lines.push(``, `🟢 *Codebase is clean — no outstanding issues.*`);
  }

  lines.push(``, `_Powered by TIQ AI Agent • sample_codebase_`);
  return lines.join('\n');
}

// Save weekly report to logs/
export function saveWeeklyReport(report) {
  if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
  const file = path.join(LOGS_DIR, `weekly-${report.week_end}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  return file;
}

// Send weekly report to Slack + in-app notification
export async function sendWeeklyReport() {
  const report = buildWeeklyReport();
  saveWeeklyReport(report);

  const slackUrl = process.env.NOTIFICATION_WEBHOOK_URL;
  if (slackUrl) {
    const text    = formatSlackReport(report);
    const payload = slackUrl.includes('hooks.slack.com')
      ? { text }
      : { content: text.replace(/\*/g, '**') };

    try {
      await fetch(slackUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });
      console.log('[Weekly Report] Sent to Slack/Discord');
    } catch (err) {
      console.error('[Weekly Report] Webhook failed:', err.message);
    }
  }

  notify(
    report.top_issues.length === 0 ? 'success' : 'warning',
    `Weekly Report: ${report.week_start} → ${report.week_end}`,
    report.summary,
  );

  console.log(`[Weekly Report] ${report.summary}`);
  return report;
}
