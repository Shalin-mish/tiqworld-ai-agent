export const MAX_TOOL_RESULT_CHARS = 3000;

/**
 * Caps a tool-result JSON string at MAX_TOOL_RESULT_CHARS.
 * Appends a note so Claude knows data was cut, not absent.
 */
export function truncateResult(raw) {
  if (raw.length <= MAX_TOOL_RESULT_CHARS) return raw;
  return (
    raw.slice(0, MAX_TOOL_RESULT_CHARS) +
    `\n...[truncated ${raw.length - MAX_TOOL_RESULT_CHARS} chars — use a narrower query if more detail is needed]`
  );
}
