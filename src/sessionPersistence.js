/**
 * Session persistence across restarts.
 * Saves session history + memory to logs/sessions/{id}.json.
 * Loaded on getSession() if the in-memory Map doesn't have it.
 *
 * Only text-serialisable parts are persisted — Map/function fields
 * are rebuilt on hydration.
 */

import fs   from 'fs';
import path from 'path';

const SESSIONS_DIR = path.join(process.cwd(), 'logs', 'sessions');
const MAX_HISTORY  = 8;    // keep last 8 messages (matches in-memory cap)
const MAX_AGE_MS   = 24 * 60 * 60 * 1000;  // 24 h — discard older snapshots

function ensureDir() {
  if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

function filePath(sessionId) {
  // Sanitise sessionId to safe filename (only alphanumeric + hyphen)
  const safe = sessionId.replace(/[^a-zA-Z0-9-]/g, '_').slice(0, 80);
  return path.join(SESSIONS_DIR, `${safe}.json`);
}

export function saveSession(sessionId, session) {
  try {
    ensureDir();
    const snapshot = {
      sessionId,
      savedAt:  new Date().toISOString(),
      user:     session.user,
      github:   session.github ?? null,
      taskType: session.taskType ?? null,
      tokens:   session.tokens,
      history:  (session.history ?? []).slice(-MAX_HISTORY),
      memory: {
        filesRead: Object.fromEntries(session.memory?.filesRead ?? new Map()),
        toolCalls: (session.memory?.toolCalls ?? []).slice(-50),
        writes:    (session.memory?.writes    ?? []).slice(-20),
      },
    };
    fs.writeFileSync(filePath(sessionId), JSON.stringify(snapshot, null, 2), 'utf-8');
  } catch {
    // Non-fatal — persistence is best-effort
  }
}

export function loadSession(sessionId) {
  try {
    const fp = filePath(sessionId);
    if (!fs.existsSync(fp)) return null;
    const raw  = JSON.parse(fs.readFileSync(fp, 'utf-8'));
    // Discard stale snapshots
    if (Date.now() - new Date(raw.savedAt).getTime() > MAX_AGE_MS) {
      fs.unlinkSync(fp);
      return null;
    }
    return {
      user:     raw.user     ?? 'unknown',
      github:   raw.github   ?? null,
      taskType: raw.taskType ?? null,
      tokens:   raw.tokens   ?? { in: 0, out: 0, cacheRead: 0 },
      history:  raw.history  ?? [],
      memory: {
        filesRead: new Map(Object.entries(raw.memory?.filesRead ?? {})),
        toolCalls: raw.memory?.toolCalls ?? [],
        writes:    raw.memory?.writes    ?? [],
      },
    };
  } catch {
    return null;
  }
}

export function deleteSession(sessionId) {
  try {
    const fp = filePath(sessionId);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  } catch { /* best-effort */ }
}

export function listPersistedSessions() {
  try {
    ensureDir();
    return fs.readdirSync(SESSIONS_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          const raw = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf-8'));
          return { sessionId: raw.sessionId, user: raw.user, savedAt: raw.savedAt };
        } catch { return null; }
      })
      .filter(Boolean);
  } catch { return []; }
}
