/**
 * Unit tests for src/notifications.js
 * Mocks fs so no real disk I/O happens — pure logic testing only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  default: {
    existsSync:    vi.fn(() => false),
    mkdirSync:     vi.fn(),
    readFileSync:  vi.fn(() => { throw new Error('ENOENT'); }),
    writeFileSync: vi.fn(),
  },
}));

import fs from 'fs';
import { notify, getNotifications, markRead, markAllRead, unreadCount } from '../../src/notifications.js';

beforeEach(() => {
  vi.clearAllMocks();
  fs.existsSync.mockReturnValue(false);
  fs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function seedNotifs(items) {
  fs.existsSync.mockReturnValue(true);
  fs.readFileSync.mockReturnValue(JSON.stringify(items));
}

function lastWrite() {
  return JSON.parse(fs.writeFileSync.mock.calls[0][1]);
}

// ---------------------------------------------------------------------------
// notify()
// ---------------------------------------------------------------------------
describe('notify()', () => {
  it('creates a notification with correct shape', () => {
    notify('success', 'Deploy done', 'All green');
    const written = lastWrite();
    expect(written).toHaveLength(1);
    const n = written[0];
    expect(n.type).toBe('success');
    expect(n.title).toBe('Deploy done');
    expect(n.body).toBe('All green');
    expect(n.read).toBe(false);
    expect(typeof n.id).toBe('string');
    expect(n.id.length).toBeGreaterThan(0);
    expect(typeof n.at).toBe('string');
  });

  it('appends to existing notifications', () => {
    seedNotifs([{ id: 'old', type: 'info', title: 'Old', body: '', at: new Date().toISOString(), read: false }]);
    notify('error', 'New error', 'Something broke');
    const written = lastWrite();
    expect(written).toHaveLength(2);
    expect(written[1].title).toBe('New error');
  });

  it('caps stored list at 500 entries (oldest evicted)', () => {
    const big = Array.from({ length: 500 }, (_, i) => ({
      id: String(i), type: 'info', title: `N${i}`, body: '', at: new Date().toISOString(), read: false,
    }));
    seedNotifs(big);
    notify('info', 'Overflow', 'body');
    const written = lastWrite();
    expect(written).toHaveLength(500);
    expect(written[499].title).toBe('Overflow');
  });

  it('accepts all valid notification types without throwing', () => {
    for (const type of ['success', 'warning', 'error', 'info']) {
      expect(() => notify(type, 'title', 'body')).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// getNotifications()
// ---------------------------------------------------------------------------
describe('getNotifications()', () => {
  it('returns empty array when no file exists', () => {
    expect(getNotifications()).toEqual([]);
  });

  it('returns notifications newest-first (reverse chronological)', () => {
    seedNotifs([
      { id: '1', type: 'info', title: 'First',  body: '', at: '2026-01-01T00:00:00Z', read: false },
      { id: '2', type: 'info', title: 'Second', body: '', at: '2026-01-02T00:00:00Z', read: false },
    ]);
    const result = getNotifications();
    expect(result[0].title).toBe('Second');
    expect(result[1].title).toBe('First');
  });

  it('respects limit parameter', () => {
    seedNotifs(Array.from({ length: 20 }, (_, i) => ({
      id: String(i), type: 'info', title: `N${i}`, body: '', at: new Date().toISOString(), read: false,
    })));
    expect(getNotifications(5)).toHaveLength(5);
  });

  it('returns all items when limit exceeds total count', () => {
    seedNotifs([{ id: '1', type: 'info', title: 'A', body: '', at: new Date().toISOString(), read: false }]);
    expect(getNotifications(100)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// markRead()
// ---------------------------------------------------------------------------
describe('markRead()', () => {
  it('marks only the targeted notification as read', () => {
    seedNotifs([
      { id: 'n1', type: 'info', title: 'A', body: '', at: new Date().toISOString(), read: false },
      { id: 'n2', type: 'info', title: 'B', body: '', at: new Date().toISOString(), read: false },
    ]);
    markRead('n1');
    const written = lastWrite();
    expect(written.find(n => n.id === 'n1').read).toBe(true);
    expect(written.find(n => n.id === 'n2').read).toBe(false);
  });

  it('does not write to disk for an unknown id', () => {
    seedNotifs([{ id: 'n1', type: 'info', title: 'A', body: '', at: new Date().toISOString(), read: false }]);
    markRead('no-such-id');
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('already-read notification remains read (safe to call twice)', () => {
    seedNotifs([{ id: 'n1', type: 'info', title: 'A', body: '', at: new Date().toISOString(), read: true }]);
    markRead('n1');
    const written = lastWrite();
    expect(written[0].read).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// markAllRead()
// ---------------------------------------------------------------------------
describe('markAllRead()', () => {
  it('marks every notification as read regardless of current state', () => {
    seedNotifs([
      { id: '1', type: 'info',    title: 'A', body: '', at: new Date().toISOString(), read: false },
      { id: '2', type: 'error',   title: 'B', body: '', at: new Date().toISOString(), read: false },
      { id: '3', type: 'success', title: 'C', body: '', at: new Date().toISOString(), read: true  },
    ]);
    markAllRead();
    const written = lastWrite();
    expect(written.every(n => n.read === true)).toBe(true);
  });

  it('handles empty notification list without throwing', () => {
    seedNotifs([]);
    expect(() => markAllRead()).not.toThrow();
    const written = lastWrite();
    expect(written).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// unreadCount()
// ---------------------------------------------------------------------------
describe('unreadCount()', () => {
  it('returns 0 when no notifications exist', () => {
    expect(unreadCount()).toBe(0);
  });

  it('counts only unread notifications', () => {
    seedNotifs([
      { id: '1', type: 'info', title: 'A', body: '', at: new Date().toISOString(), read: false },
      { id: '2', type: 'info', title: 'B', body: '', at: new Date().toISOString(), read: true  },
      { id: '3', type: 'info', title: 'C', body: '', at: new Date().toISOString(), read: false },
    ]);
    expect(unreadCount()).toBe(2);
  });

  it('returns 0 when all notifications are read', () => {
    seedNotifs([{ id: '1', type: 'info', title: 'A', body: '', at: new Date().toISOString(), read: true }]);
    expect(unreadCount()).toBe(0);
  });

  it('returns total count when all are unread', () => {
    seedNotifs([
      { id: '1', type: 'error', title: 'X', body: '', at: new Date().toISOString(), read: false },
      { id: '2', type: 'error', title: 'Y', body: '', at: new Date().toISOString(), read: false },
    ]);
    expect(unreadCount()).toBe(2);
  });
});
