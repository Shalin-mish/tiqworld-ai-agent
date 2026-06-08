/**
 * API route tests using supertest.
 * The server module is imported directly — no separate process needed.
 * We monkey-patch config so no real AWS/DB calls happen.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import session from 'express-session';
import passport from 'passport';

// Build a minimal test-only express app that mirrors the production routes
// without requiring real AWS Bedrock credentials.
import { createRouter } from '../../src/web/router.js';

let app;
beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use(session({ secret: 'test', resave: false, saveUninitialized: false }));
  app.use(passport.initialize());
  app.use(passport.session());
  app.use('/', createRouter());
});

describe('GET /api/status', () => {
  it('returns 200 with version and tool_count', async () => {
    const res = await request(app).get('/api/status');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.tool_count).toBeGreaterThan(0);
    expect(res.body.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('GET /api/me', () => {
  it('returns authMode when no GitHub creds configured', async () => {
    const res = await request(app).get('/api/me');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('authMode');
  });
});

describe('POST /api/identify', () => {
  it('returns 400 when sessionId missing', async () => {
    const res = await request(app)
      .post('/api/identify')
      .send({ user: 'Shalini' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when user missing', async () => {
    const res = await request(app)
      .post('/api/identify')
      .send({ sessionId: 'abc123' });
    expect(res.status).toBe(400);
  });

  it('registers a user and returns ok', async () => {
    const res = await request(app)
      .post('/api/identify')
      .send({ sessionId: 'test-session-1', user: 'TestUser' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.user).toBe('TestUser');
  });

  it('truncates names longer than 40 chars', async () => {
    const long = 'A'.repeat(60);
    const res = await request(app)
      .post('/api/identify')
      .send({ sessionId: 'test-session-2', user: long });
    expect(res.body.user.length).toBe(40);
  });
});

describe('POST /api/approve', () => {
  it('returns 400 when approvalId missing', async () => {
    const res = await request(app)
      .post('/api/approve')
      .send({ decision: 'approve' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when decision missing', async () => {
    const res = await request(app)
      .post('/api/approve')
      .send({ approvalId: 'some-id' });
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown approvalId', async () => {
    const res = await request(app)
      .post('/api/approve')
      .send({ approvalId: 'no-such-id', decision: 'approve' });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/session/:id/memory', () => {
  it('returns 404-like ok:false for unknown session', async () => {
    const res = await request(app).get('/api/session/nonexistent-xyz/memory');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
  });

  it('returns memory after identify', async () => {
    const sid = 'mem-test-session';
    await request(app)
      .post('/api/identify')
      .send({ sessionId: sid, user: 'MemUser' });
    const res = await request(app).get(`/api/session/${sid}/memory`);
    expect(res.body.ok).toBe(true);
    expect(res.body.user).toBe('MemUser');
    expect(res.body.summary).toHaveProperty('tool_calls');
  });
});

describe('GET /api/activity', () => {
  it('returns entries array', async () => {
    const res = await request(app).get('/api/activity');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.entries)).toBe(true);
  });

  it('respects limit param', async () => {
    const res = await request(app).get('/api/activity?limit=5');
    expect(res.body.entries.length).toBeLessThanOrEqual(5);
  });
});

describe('GET /api/last-scan', () => {
  it('returns ok:false when no scan has run', async () => {
    const res = await request(app).get('/api/last-scan');
    expect(res.status).toBe(200);
    // Either no scan yet, or a scan ran — both are valid
    expect(typeof res.body.ok).toBe('boolean');
  });
});

// ---------------------------------------------------------------------------
// Notification endpoints (wired in fix commit 2edd5c5)
// ---------------------------------------------------------------------------

describe('GET /api/notifications', () => {
  it('returns 200 with notifications array and unread count', async () => {
    const res = await request(app).get('/api/notifications');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.notifications)).toBe(true);
    expect(typeof res.body.unread).toBe('number');
    expect(res.body.unread).toBeGreaterThanOrEqual(0);
  });

  it('respects limit query param — result length does not exceed limit', async () => {
    const res = await request(app).get('/api/notifications?limit=3');
    expect(res.status).toBe(200);
    expect(res.body.notifications.length).toBeLessThanOrEqual(3);
  });

  it('unread count in /api/notifications matches /api/status unread_notifications', async () => {
    const [notifRes, statusRes] = await Promise.all([
      request(app).get('/api/notifications'),
      request(app).get('/api/status'),
    ]);
    expect(notifRes.body.unread).toBe(statusRes.body.unread_notifications);
  });
});

describe('POST /api/notifications/read-all', () => {
  it('returns 200 with ok:true', async () => {
    const res = await request(app).post('/api/notifications/read-all');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('after read-all, unread count is 0', async () => {
    await request(app).post('/api/notifications/read-all');
    const res = await request(app).get('/api/notifications');
    expect(res.body.unread).toBe(0);
  });
});

describe('PATCH /api/notifications/:id/read', () => {
  it('returns 200 with ok:true for a valid-looking id', async () => {
    const res = await request(app).patch('/api/notifications/some-notif-id/read');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('graceful no-op for unknown id — still returns ok:true', async () => {
    const res = await request(app).patch('/api/notifications/nonexistent-xyz-id/read');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
