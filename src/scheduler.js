import { fullScan } from './tools/fullScan.js';

let lastScanResult = null;
let lastScanTime   = null;
let scanTimer      = null;

export function getLastScan() {
  return { result: lastScanResult, scannedAt: lastScanTime };
}

async function runScan(label = 'scheduled') {
  console.log(`\n[Scheduler] Running ${label} full scan...`);
  const t0 = Date.now();
  try {
    lastScanResult = await fullScan();
    lastScanTime   = new Date().toISOString();
    const elapsed  = ((Date.now() - t0) / 1000).toFixed(1);
    const s = lastScanResult.summary;
    console.log(
      `[Scheduler] Done in ${elapsed}s — ` +
      `${s.critical_todos} critical TODOs, ` +
      `${s.lint_errors} lint errors, ` +
      `${s.dead_code_files} dead files, ` +
      `${s.uncommitted_files} uncommitted`
    );
  } catch (err) {
    console.error(`[Scheduler] Scan failed: ${err.message}`);
  }
}

export function startScheduler(intervalMinutes = 0) {
  runScan('startup');
  if (intervalMinutes > 0) {
    const ms = intervalMinutes * 60 * 1000;
    scanTimer = setInterval(() => runScan('scheduled'), ms);
    console.log(`[Scheduler] Auto-scan every ${intervalMinutes} minutes`);
  }
}

export function stopScheduler() {
  if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
}

export async function triggerScan() {
  await runScan('manual');
  return lastScanResult;
}
