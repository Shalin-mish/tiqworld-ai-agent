/**
 * Session persistence tests.
 * Verifies that saveSession/loadSession/deleteSession round-trips
 * work correctly and that stale + malformed data is handled safely.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs   from 'fs';
import path from 'path';
import { saveSession, loadSession, deleteSession, listPersistedSessions } from '../../src/sessionPersistence.js';

const SESSIONS_DIR = path.join(process.cwd(), 'logs', 'sessions');
const TEST_ID      = `test-persist-${Date.now()}`;

// Clean up test files after each test
afterEach(() => {
  try {
    const safe = TEST_ID.replace(/[^a-zA-Z0-9-]/g, '_').slice(0, 80);
    const fp = path.join(SESSIONS_DIR, `${safe}.json`);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  } catch { /* ignore */ }
});

const mockSession = () => ({
  user:     'TestUser',
  github:   null,
  taskType: 'query',
  tokens:   { in: 100, out: 50, cacheRead: 30 },
  history:  [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'hi' }],
  memory: {
    filesRead: new Map([['src/foo.js', 2]]),
    toolCalls: [{ name: 'read_file', inputSummary: 'src/foo.js', at: new Date().toISOString() }],
    writes:    [],
  },
});

// ---------------------------------------------------------------------------
// save + load round-trip
// ---------------------------------------------------------------------------

describe('saveSession / loadSession round-trip', () => {
  it('saves and reloads user and taskType', () => {
    saveSession(TEST_ID, mockSession());
    const loaded = loadSession(TEST_ID);
    expect(loaded).not.toBeNull();
    expect(loaded.user).toBe('TestUser');
    expect(loaded.taskType).toBe('query');
  });

  it('reloads tokens correctly', () => {
    saveSession(TEST_ID, mockSession());
    const { tokens } = loadSession(TEST_ID);
    expect(tokens.in).toBe(100);
    expect(tokens.out).toBe(50);
    expect(tokens.cacheRead).toBe(30);
  });

  it('reloads history array', () => {
    saveSession(TEST_ID, mockSession());
    const { history } = loadSession(TEST_ID);
    expect(Array.isArray(history)).toBe(true);
    expect(history).toHaveLength(2);
    expect(history[0].role).toBe('user');
  });

  it('rehydrates filesRead as a Map', () => {
    saveSession(TEST_ID, mockSession());
    const { memory } = loadSession(TEST_ID);
    expect(memory.filesRead instanceof Map).toBe(true);
    expect(memory.filesRead.get('src/foo.js')).toBe(2);
  });

  it('reloads toolCalls array', () => {
    saveSession(TEST_ID, mockSession());
    const { memory } = loadSession(TEST_ID);
    expect(Array.isArray(memory.toolCalls)).toBe(true);
    expect(memory.toolCalls[0].name).toBe('read_file');
  });
});

// ---------------------------------------------------------------------------
// Missing session
// ---------------------------------------------------------------------------

describe('loadSession — missing / unknown', () => {
  it('returns null for an id that was never saved', () => {
    const result = loadSession('does-not-exist-xyz-999');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// deleteSession
// ---------------------------------------------------------------------------

describe('deleteSession', () => {
  it('removes the persisted file', () => {
    saveSession(TEST_ID, mockSession());
    expect(loadSession(TEST_ID)).not.toBeNull();
    deleteSession(TEST_ID);
    expect(loadSession(TEST_ID)).toBeNull();
  });

  it('does not throw when deleting a non-existent session', () => {
    expect(() => deleteSession('never-existed-abc')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// listPersistedSessions
// ---------------------------------------------------------------------------

describe('listPersistedSessions', () => {
  it('returns an array', () => {
    expect(Array.isArray(listPersistedSessions())).toBe(true);
  });

  it('includes a saved session', () => {
    saveSession(TEST_ID, mockSession());
    const list = listPersistedSessions();
    const found = list.find(s => s.sessionId === TEST_ID);
    expect(found).toBeDefined();
    expect(found.user).toBe('TestUser');
  });

  it('does not include a deleted session', () => {
    saveSession(TEST_ID, mockSession());
    deleteSession(TEST_ID);
    const list = listPersistedSessions();
    const found = list.find(s => s.sessionId === TEST_ID);
    expect(found).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// History cap (max 8 messages)
// ---------------------------------------------------------------------------

describe('history cap — max 8 messages persisted', () => {
  it('trims history longer than 8 messages on save', () => {
    const session = mockSession();
    session.history = Array.from({ length: 20 }, (_, i) => ({ role: 'user', content: `msg${i}` }));
    saveSession(TEST_ID, session);
    const { history } = loadSession(TEST_ID);
    expect(history.length).toBeLessThanOrEqual(8);
  });
});

// ---------------------------------------------------------------------------
// Malformed file — safe read
// ---------------------------------------------------------------------------

describe('corrupt snapshot file handling', () => {
  it('returns null for a corrupt JSON file without throwing', () => {
    // Write invalid JSON directly
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    const safe = TEST_ID.replace(/[^a-zA-Z0-9-]/g, '_').slice(0, 80);
    fs.writeFileSync(path.join(SESSIONS_DIR, `${safe}.json`), 'NOT VALID JSON {{{', 'utf-8');
    expect(() => loadSession(TEST_ID)).not.toThrow();
    expect(loadSession(TEST_ID)).toBeNull();
  });
});
