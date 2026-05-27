/**
 * Per-session tool-call log.
 * Each sessionId gets its own isolated log — prevents User A's history
 * leaking into User B's recall_session results.
 */

const logs = new Map(); // sessionId → LogEntry[]

function getOrCreate(sessionId) {
  if (!logs.has(sessionId)) logs.set(sessionId, []);
  return logs.get(sessionId);
}

export function recordToolCall(name, input, resultSummary, sessionId = 'default') {
  getOrCreate(sessionId).push({
    tool:    name,
    input,
    summary: resultSummary,
    at:      new Date().toISOString(),
  });
}

export function getLog(sessionId = 'default') {
  return [...(logs.get(sessionId) ?? [])];
}

export function clearLog(sessionId = 'default') {
  if (sessionId === '*') { logs.clear(); return; }
  logs.delete(sessionId);
}

export function getStats(sessionId = 'default') {
  const entries = logs.get(sessionId) ?? [];
  const by_tool = {};
  for (const e of entries) by_tool[e.tool] = (by_tool[e.tool] ?? 0) + 1;
  return { total: entries.length, by_tool };
}
