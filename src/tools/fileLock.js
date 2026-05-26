// In-memory file lock store — prevents maintenance and feature agents
// from writing the same file simultaneously.
const _locks = new Map();

export function acquireLock(filePath, owner) {
  if (_locks.has(filePath)) {
    return { acquired: false, held_by: _locks.get(filePath).owner };
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
