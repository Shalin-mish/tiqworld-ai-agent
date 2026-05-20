/**
 * In-memory session log for the current process lifetime.
 * Records every tool call so Claude can recall what was already read/changed
 * without re-reading files or losing context between turns.
 */

const log = [];

export function recordToolCall(name, input, resultSummary) {
  log.push({
    tool: name,
    input,
    summary: resultSummary,
    at: new Date().toISOString(),
  });
}

export function getLog() {
  return [...log];
}

export function clearLog() {
  log.length = 0;
}
