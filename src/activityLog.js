import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const LOG_DIR  = path.join(ROOT, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'activity.jsonl');

fs.mkdirSync(LOG_DIR, { recursive: true });

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

export function readLog(limit = 200) {
  if (!fs.existsSync(LOG_FILE)) return [];
  const lines = fs.readFileSync(LOG_FILE, 'utf-8')
    .split('\n')
    .filter(Boolean);
  return lines
    .slice(-limit)
    .reverse()
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

export function logStats() {
  const entries = readLog(1000);
  const byUser   = {};
  const byAction = {};
  for (const e of entries) {
    byUser[e.user]     = (byUser[e.user]     ?? 0) + 1;
    byAction[e.action] = (byAction[e.action] ?? 0) + 1;
  }
  return { total: entries.length, byUser, byAction, since: entries.at(-1)?.ts ?? null };
}
