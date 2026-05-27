import fs   from 'fs';
import path  from 'path';

// Stored in the project root so it survives restarts but is gitignored.
const SESSION_FILE = path.resolve(process.cwd(), '.agent-session.json');

// ---------------------------------------------------------------------------
// Bootstrap — load existing log from disk on startup
// ---------------------------------------------------------------------------

function loadFromDisk() {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      const raw = fs.readFileSync(SESSION_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch {
    // Corrupt file — start fresh
  }
  return [];
}

const log = loadFromDisk();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function recordToolCall(name, input, resultSummary) {
  log.push({
    tool:    name,
    input,
    summary: resultSummary,
    at:      new Date().toISOString(),
  });
  flushToDisk();
}

export function getLog() {
  return [...log];
}

export function clearLog() {
  log.length = 0;
  try { fs.unlinkSync(SESSION_FILE); } catch { /* file may not exist */ }
}

/** Per-tool call counts — useful for token diagnostics. */
export function getStats() {
  const counts = {};
  for (const entry of log) {
    counts[entry.tool] = (counts[entry.tool] ?? 0) + 1;
  }
  return { total: log.length, by_tool: counts };
}

// ---------------------------------------------------------------------------
// Disk persistence — write-through on every call (log is small)
// ---------------------------------------------------------------------------

function flushToDisk() {
  try {
    fs.writeFileSync(SESSION_FILE, JSON.stringify(log, null, 2), 'utf8');
  } catch {
    // Non-fatal — in-memory log still works
  }
}
