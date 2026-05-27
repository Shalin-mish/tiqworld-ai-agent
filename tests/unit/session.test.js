import { describe, it, expect, beforeEach } from 'vitest';
import { recordToolCall, getLog, clearLog, getStats } from '../../src/session.js';

beforeEach(() => {
  clearLog('*');
});

describe('per-session isolation', () => {
  it('User A and User B have separate logs', () => {
    recordToolCall('read_file', { file_path: 'a.js' }, 'ok', 'session-A');
    recordToolCall('list_files', { path: 'src' }, 'ok', 'session-B');

    const a = getLog('session-A');
    const b = getLog('session-B');

    expect(a).toHaveLength(1);
    expect(a[0].tool).toBe('read_file');

    expect(b).toHaveLength(1);
    expect(b[0].tool).toBe('list_files');
  });

  it('getLog returns a copy, not the internal array', () => {
    recordToolCall('read_file', { file_path: 'x.js' }, 'ok', 'session-X');
    const log = getLog('session-X');
    log.push({ tool: 'injected', input: {}, summary: 'bad', at: '' });
    expect(getLog('session-X')).toHaveLength(1);
  });

  it('clearLog deletes only the target session', () => {
    recordToolCall('read_file', { file_path: 'a.js' }, 'ok', 'session-A');
    recordToolCall('read_file', { file_path: 'b.js' }, 'ok', 'session-B');
    clearLog('session-A');

    expect(getLog('session-A')).toHaveLength(0);
    expect(getLog('session-B')).toHaveLength(1);
  });

  it('clearLog("*") clears all sessions', () => {
    recordToolCall('search_code', {}, 'ok', 'session-A');
    recordToolCall('search_code', {}, 'ok', 'session-B');
    clearLog('*');
    expect(getLog('session-A')).toHaveLength(0);
    expect(getLog('session-B')).toHaveLength(0);
  });

  it('getStats counts by tool for the right session', () => {
    recordToolCall('read_file',  {}, 'ok', 'session-A');
    recordToolCall('read_file',  {}, 'ok', 'session-A');
    recordToolCall('list_files', {}, 'ok', 'session-A');
    recordToolCall('read_file',  {}, 'ok', 'session-B');

    const stats = getStats('session-A');
    expect(stats.total).toBe(3);
    expect(stats.by_tool.read_file).toBe(2);
    expect(stats.by_tool.list_files).toBe(1);

    const statsB = getStats('session-B');
    expect(statsB.total).toBe(1);
  });

  it('unknown session returns empty log without error', () => {
    expect(getLog('nonexistent-session')).toEqual([]);
    expect(getStats('nonexistent-session')).toEqual({ total: 0, by_tool: {} });
  });

  it('default sessionId falls back to "default"', () => {
    recordToolCall('git_log', {}, 'ok');
    expect(getLog()).toHaveLength(1);
    expect(getLog('default')).toHaveLength(1);
  });
});
