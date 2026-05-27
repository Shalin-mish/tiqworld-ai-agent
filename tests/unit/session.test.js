/**
 * session.js unit tests.
 *
 * Strategy: we need session.js to use a temp file, not the real
 * .agent-session.json. We do this by re-importing the module fresh
 * for each test group via dynamic import + vi.resetModules(), after
 * pointing process.cwd() at a temp directory.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs   from 'fs';
import path from 'path';
import os   from 'os';

let tmpDir;

// Fresh module + fresh temp dir for every test — no bleed between tests.
async function freshSession() {
  vi.resetModules();
  const mod = await import('../../src/session.js');
  return mod;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tiq-session-test-'));
  vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// recordToolCall + getLog
// ---------------------------------------------------------------------------

describe('recordToolCall() + getLog()', () => {
  it('records a single entry in memory', async () => {
    const { recordToolCall, getLog } = await freshSession();
    recordToolCall('read_file', { path: 'foo.js' }, 'ok');
    const log = getLog();
    expect(log).toHaveLength(1);
    expect(log[0].tool).toBe('read_file');
    expect(log[0].summary).toBe('ok');
    expect(log[0].at).toBeTruthy();
  });

  it('returns a copy — mutating result does not affect internal log', async () => {
    const { recordToolCall, getLog } = await freshSession();
    recordToolCall('search_code', { keyword: 'x' }, 'found');
    const first = getLog();
    first.push({ tool: 'injected' });
    expect(getLog()).toHaveLength(1);
  });

  it('accumulates multiple calls in order', async () => {
    const { recordToolCall, getLog } = await freshSession();
    recordToolCall('list_files', {}, '5 files');
    recordToolCall('read_file',  {}, 'content');
    recordToolCall('search_code', {}, '3 matches');
    const log = getLog();
    expect(log).toHaveLength(3);
    expect(log.map(e => e.tool)).toEqual(['list_files', 'read_file', 'search_code']);
  });
});

// ---------------------------------------------------------------------------
// Disk persistence — write-through
// ---------------------------------------------------------------------------

describe('disk persistence', () => {
  it('writes .agent-session.json after recordToolCall', async () => {
    const { recordToolCall } = await freshSession();
    recordToolCall('lint_file', { file_path: 'foo.js' }, 'ok');
    const sessionFile = path.join(tmpDir, '.agent-session.json');
    expect(fs.existsSync(sessionFile)).toBe(true);
    const saved = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
    expect(Array.isArray(saved)).toBe(true);
    expect(saved[0].tool).toBe('lint_file');
  });

  it('loads existing log from disk on startup', async () => {
    // Pre-seed the file before importing the module
    const sessionFile = path.join(tmpDir, '.agent-session.json');
    const seed = [{ tool: 'git_log', input: {}, summary: '5 commits', at: new Date().toISOString() }];
    fs.writeFileSync(sessionFile, JSON.stringify(seed), 'utf8');

    const { getLog } = await freshSession();
    const log = getLog();
    expect(log).toHaveLength(1);
    expect(log[0].tool).toBe('git_log');
  });

  it('starts with empty log if file is missing', async () => {
    const { getLog } = await freshSession();
    expect(getLog()).toHaveLength(0);
  });

  it('silently recovers from a corrupt session file', async () => {
    const sessionFile = path.join(tmpDir, '.agent-session.json');
    fs.writeFileSync(sessionFile, '{ this is not valid json ~~~', 'utf8');

    const { getLog, recordToolCall } = await freshSession();
    expect(getLog()).toHaveLength(0); // corrupt file → start fresh
    // Should still be able to record new calls
    expect(() => recordToolCall('health_check', {}, 'ok')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// clearLog
// ---------------------------------------------------------------------------

describe('clearLog()', () => {
  it('empties the in-memory log', async () => {
    const { recordToolCall, clearLog, getLog } = await freshSession();
    recordToolCall('read_file', {}, 'ok');
    recordToolCall('read_file', {}, 'ok');
    clearLog();
    expect(getLog()).toHaveLength(0);
  });

  it('deletes the session file from disk', async () => {
    const { recordToolCall, clearLog } = await freshSession();
    recordToolCall('read_file', {}, 'ok');
    const sessionFile = path.join(tmpDir, '.agent-session.json');
    expect(fs.existsSync(sessionFile)).toBe(true);
    clearLog();
    expect(fs.existsSync(sessionFile)).toBe(false);
  });

  it('does not throw if session file does not exist', async () => {
    const { clearLog } = await freshSession();
    expect(() => clearLog()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// getStats
// ---------------------------------------------------------------------------

describe('getStats()', () => {
  it('returns total:0 and empty by_tool when log is empty', async () => {
    const { getStats } = await freshSession();
    const stats = getStats();
    expect(stats.total).toBe(0);
    expect(stats.by_tool).toEqual({});
  });

  it('counts calls per tool correctly', async () => {
    const { recordToolCall, getStats } = await freshSession();
    recordToolCall('read_file',   {}, 'ok');
    recordToolCall('read_file',   {}, 'ok');
    recordToolCall('search_code', {}, 'ok');
    const stats = getStats();
    expect(stats.total).toBe(3);
    expect(stats.by_tool.read_file).toBe(2);
    expect(stats.by_tool.search_code).toBe(1);
  });

  it('total matches sum of by_tool values', async () => {
    const { recordToolCall, getStats } = await freshSession();
    ['a', 'b', 'a', 'c', 'a'].forEach(t => recordToolCall(t, {}, 'ok'));
    const { total, by_tool } = getStats();
    const sum = Object.values(by_tool).reduce((s, n) => s + n, 0);
    expect(sum).toBe(total);
  });
});
