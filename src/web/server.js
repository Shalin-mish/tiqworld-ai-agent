import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import session from 'express-session';
import passport from 'passport';
import { Strategy as GitHubStrategy } from 'passport-github2';
import { config } from '../config.js';
import {
  startScheduler, triggerScan,
  getMaintenanceStatus, setBroadcastFn, getSchedulerHealth,
} from '../scheduler.js';
import { TOOL_COUNT } from '../agent.js';
import { logEvent } from '../activityLog.js';
import { listReports } from '../tools/maintenanceReport.js';
import { getNotifications, markAllRead, unreadCount } from '../notifications.js';
import { createRouter, sessions } from './router.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json());
app.use(session({
  secret:            config.sessionSecret,
  resave:            false,
  saveUninitialized: false,
  cookie:            { secure: false, maxAge: 8 * 60 * 60 * 1000 },
}));
app.use(passport.initialize());
app.use(passport.session());
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Maintenance SSE broadcast
// ---------------------------------------------------------------------------
const maintenanceClients = new Set();

setBroadcastFn((entry) => {
  const data = `data: ${JSON.stringify({ type: 'maintenance_progress', ...entry })}\n\n`;
  for (const res of maintenanceClients) {
    try { res.write(data); } catch (_) { maintenanceClients.delete(res); }
  }
});

app.get('/api/maintenance/stream', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();
  maintenanceClients.add(res);
  res.write(`data: ${JSON.stringify({ type: 'maintenance_status', ...getMaintenanceStatus() })}\n\n`);
  req.on('close', () => maintenanceClients.delete(res));
});

app.get('/api/maintenance/status', (_req, res) => {
  res.json({ ok: true, ...getMaintenanceStatus() });
});

app.post('/api/maintenance/trigger', (req, res) => {
  const mode    = req.body?.mode ?? 'deep';
  const current = getMaintenanceStatus();
  if (current.state === 'running') {
    res.json({ ok: false, message: 'Maintenance already running', status: current }); return;
  }
  const sessionId = req.body?.sessionId ?? 'system';
  const user      = sessions.get(sessionId)?.user ?? 'admin';
  logEvent({ user, action: `maintenance_trigger_${mode}`, sessionId });
  triggerScan(mode).catch(err => console.error('[Maintenance trigger error]', err.message));
  res.json({ ok: true, message: `${mode} maintenance started`, mode });
});

app.get('/api/maintenance/reports', (_req, res) => {
  try { res.json({ ok: true, reports: listReports(50) }); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.get('/api/scheduler/health', (_req, res) => {
  res.json({ ok: true, ...getSchedulerHealth() });
});

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------
app.get('/api/notifications', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit ?? '50', 10), 200);
  res.json({ ok: true, notifications: getNotifications(limit), unread: unreadCount() });
});

app.post('/api/notifications/read-all', (_req, res) => {
  markAllRead();
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// GitHub OAuth (optional — only active when credentials are in .env)
// ---------------------------------------------------------------------------
const githubAuthEnabled = !!(config.githubClientId && config.githubClientSecret);

if (githubAuthEnabled) {
  passport.use(new GitHubStrategy(
    {
      clientID:     config.githubClientId,
      clientSecret: config.githubClientSecret,
      callbackURL:  `http://localhost:${config.webPort}/auth/github/callback`,
      scope:        ['read:user'],
    },
    (_accessToken, _refreshToken, profile, done) => {
      done(null, {
        login:     profile.username,
        name:      profile.displayName || profile.username,
        avatarUrl: profile.photos?.[0]?.value ?? null,
        githubId:  profile.id,
      });
    },
  ));
  passport.serializeUser((user, done)   => done(null, user));
  passport.deserializeUser((user, done) => done(null, user));
}

// GET /auth/github
app.get('/auth/github', (req, res, next) => {
  if (!githubAuthEnabled) {
    res.status(503).send('GitHub OAuth is not configured. Add GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET to .env');
    return;
  }
  passport.authenticate('github')(req, res, next);
});

// GET /auth/github/callback
app.get('/auth/github/callback',
  passport.authenticate('github', { failureRedirect: '/?auth=failed' }),
  (_req, res) => res.redirect('/?auth=ok'),
);

// GET /auth/logout
app.get('/auth/logout', (req, res) => {
  req.logout(() => res.redirect('/'));
});

// ---------------------------------------------------------------------------
// All API routes (shared with tests via router.js)
// ---------------------------------------------------------------------------
app.use('/', createRouter({ githubAuthEnabled }));

// GET /admin — redirect to inline admin tab
app.get('/admin', (_req, res) => {
  res.redirect('/?tab=admin');
});

// ---------------------------------------------------------------------------
app.listen(config.webPort, () => {
  console.log(`\nTIQ Agent Web UI   → http://localhost:${config.webPort}`);
  console.log(`TIQ Agent Admin    → http://localhost:${config.webPort}/?tab=admin`);
  console.log(`Tool count: ${TOOL_COUNT} | Model: ${config.model}`);
  startScheduler(config.scanIntervalMinutes);
});
