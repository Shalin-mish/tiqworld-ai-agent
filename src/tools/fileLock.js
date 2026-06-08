// In-memory file lock store — prevents maintenance and feature agents
// from writing the same file simultaneously within a single process.
// NOTE: This does NOT protect across multiple PM2 instances (instances > 1).
// Keep PM2 in fork mode (instances: 1) — the only safe config for this agent.
const _locks = new Map();
const LOCK_TTL_MS = 10 * 60 * 1000; // auto-expire stale locks after 10 min

export function acquireLock(filePath, owner) {
  const existing = _locks.get(filePath);
  if (existing) {
    // Auto-expire stale locks so a crashed maintenance run can't block forever
    if (Date.now() - new Date(existing.since).getTime() > LOCK_TTL_MS) {
      _locks.delete(filePath);
    } else {
      return { acquired: false, held_by: existing.owner };
    }
  }
  _locks.set(filePath, { owner, since: new Date().toISOString() });
  return { acquired: true };
}

export function releaseLock(filePath, owner) {
  const lock = _locks.get(filePath);
  if (!lock) return true;
  if (lock.owner !== owner) return false;
  _locks.delete(filePath);
  return true;
}

export function isLocked(filePath) {
  return _locks.has(filePath);
}

export function getLock(filePath) {
  return _locks.get(filePath) ?? null;
}

export function releaseAllLocks(owner) {
  for (const [k, v] of _locks.entries()) {
    if (v.owner === owner) _locks.delete(k);
  }
}

export function getAllLocks() {
  return Object.fromEntries(_locks.entries());
}
