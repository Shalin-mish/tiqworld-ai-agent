import { describe, it, expect } from 'vitest';
import { truncateResult, MAX_TOOL_RESULT_CHARS } from '../../src/utils/truncate.js';

describe('truncateResult()', () => {
  it('returns the string unchanged when under the limit', () => {
    const input = 'x'.repeat(MAX_TOOL_RESULT_CHARS - 1);
    expect(truncateResult(input)).toBe(input);
  });

  it('returns the string unchanged at exactly the limit', () => {
    const input = 'x'.repeat(MAX_TOOL_RESULT_CHARS);
    expect(truncateResult(input)).toBe(input);
  });

  it('truncates a string one character over the limit', () => {
    const input  = 'x'.repeat(MAX_TOOL_RESULT_CHARS + 1);
    const result = truncateResult(input);
    expect(result.startsWith('x'.repeat(MAX_TOOL_RESULT_CHARS))).toBe(true);
    expect(result).toContain('[truncated 1 chars');
  });

  it('truncates a very large string and reports correct excess count', () => {
    const excess = 5000;
    const input  = 'a'.repeat(MAX_TOOL_RESULT_CHARS + excess);
    const result = truncateResult(input);
    expect(result).toContain(`[truncated ${excess} chars`);
    // The truncated string is: MAX chars + the truncation notice
    expect(result.length).toBeGreaterThan(MAX_TOOL_RESULT_CHARS);
    expect(result.length).toBeLessThan(input.length);
  });

  it('truncation notice tells user to narrow query', () => {
    const input  = 'z'.repeat(MAX_TOOL_RESULT_CHARS + 100);
    const result = truncateResult(input);
    expect(result).toContain('narrower query');
  });

  it('preserves the first MAX_TOOL_RESULT_CHARS characters exactly', () => {
    const prefix = 'A'.repeat(MAX_TOOL_RESULT_CHARS);
    const input  = prefix + 'B'.repeat(1000);
    const result = truncateResult(input);
    expect(result.slice(0, MAX_TOOL_RESULT_CHARS)).toBe(prefix);
  });

  it('handles empty string', () => {
    expect(truncateResult('')).toBe('');
  });

  it('handles JSON-shaped input without mangling it below the limit', () => {
    const obj = { tool: 'read_file', lines: Array(10).fill('some code line') };
    const raw = JSON.stringify(obj);
    // This is well under 3000 chars so should be returned verbatim
    expect(truncateResult(raw)).toBe(raw);
  });
});
