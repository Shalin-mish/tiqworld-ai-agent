import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const LOG_DIR  = path.join(ROOT, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'activity.jsonl');

fs.mkdirSync(LOG_DIR, { recursive: true });

// Append one JSON line per event — survives server restarts.
function append(entry) {
  fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n', 'utf-8');
}

export function logEvent({ user = 'unknown', action, detail = {}, sessionId = null }) {
  const entry = {
    ts:        new Date().toISOString(),
    user,
    action,
    sessionId,
    ...detail,
  };
  append(entry);
  return entry;
}

// Read last N lines without loading the whole file into memory.
// Falls back to full-read only when the file is small enough (< 512 KB).
const TAIL_CHUNK = 64 * 1024; // 64 KB — enough for ~200 JSONL lines
export function readLog(limit = 200) {
  if (!fs.existsSync(LOG_FILE)) return [];
  try {
    const stat = fs.statSync(LOG_FILE);
    let raw;
    if (stat.size <= TAIL_CHUNK * 2) {
      raw = fs.readFileSync(LOG_FILE, 'utf-8');
    } else {
      // Read only the tail chunk — avoids loading megabytes of history
      const fd  = fs.openSync(LOG_FILE, 'r');
      const buf = Buffer.alloc(TAIL_CHUNK);
      const offset = Math.max(0, stat.size - TAIL_CHUNK);
      fs.readSync(fd, buf, 0, TAIL_CHUNK, offset);
      fs.closeSync(fd);
      raw = buf.toString('utf-8');
    }
    const lines = raw.split('\n').filter(Boolean);
    return lines
      .slice(-limit)
      .reverse()
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch {
    return [];
  }
}

// Summary counts for the admin panel
export function logStats() {
  const entries = readLog(1000);
  const byUser  = {};
  const byAction = {};
  for (const e of entries) {
    byUser[e.user]     = (byUser[e.user]     ?? 0) + 1;
    byAction[e.action] = (byAction[e.action] ?? 0) + 1;
  }
  return { total: entries.length, byUser, byAction, since: entries.at(-1)?.ts ?? null };
}
