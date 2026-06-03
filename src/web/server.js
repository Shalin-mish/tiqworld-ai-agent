import express from 'express';
import path from 'path';
import net from 'net';
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
import { reviewPR } from '../prReview.js';

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
// GitHub Webhook — auto-trigger agent review on PR open/push
// ---------------------------------------------------------------------------
import crypto from 'crypto';

app.post('/webhook/github', express.raw({ type: 'application/json' }), (req, res) => {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;

  // Verify signature if secret is configured
  if (secret) {
    const sig = req.headers['x-hub-signature-256'];
    if (!sig) { res.status(401).send('Missing signature'); return; }
    const expected = `sha256=${crypto.createHmac('sha256', secret).update(req.body).digest('hex')}`;
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      res.status(401).send('Invalid signature'); return;
    }
  }

  const event = req.headers['x-github-event'];
  let payload;
  try {
    payload = JSON.parse(req.body.toString());
  } catch {
    res.status(400).send('Invalid JSON payload'); return;
  }

  // PR opened or synchronized — trigger a review scan
  if (event === 'pull_request' && ['opened', 'synchronize'].includes(payload.action)) {
    const pr   = payload.pull_request;
    const repo = payload.repository;
    if (!pr || !repo) { res.json({ ok: true, message: 'Incomplete PR payload, skipped' }); return; }
    const branch = pr.head?.ref;
    const title  = pr.title;
    const owner  = repo.owner?.login;
    const repoName = repo.name;
    console.log(`[webhook] PR #${pr.number} "${title}" on ${owner}/${repoName} — starting review`);
    logEvent({ user: 'webhook', action: 'pr_review_trigger', sessionId: 'webhook', branch, title });
    reviewPR({ owner, repo: repoName, pull_number: pr.number, branch })
      .catch(err => console.error('[webhook PR review error]', err.message));
    res.json({ ok: true, message: 'PR review started', branch, title, pr: pr.number });
    return;
  }

  // Push to non-main branch — trigger light scan
  if (event === 'push' && typeof payload.ref === 'string' && !payload.ref.includes('/main')) {
    const branch = payload.ref.replace('refs/heads/', '');
    console.log(`[webhook] Push on branch ${branch} — triggering light scan`);
    logEvent({ user: 'webhook', action: 'push_scan_trigger', sessionId: 'webhook', branch });
    triggerScan('light').catch(err => console.error('[webhook scan error]', err.message));
    res.json({ ok: true, message: 'Light scan triggered', branch });
    return;
  }

  res.json({ ok: true, message: 'Event received, no action needed' });
});

// GET /webhook/status — confirm webhook endpoint is alive
app.get('/webhook/status', (_req, res) => {
  res.json({ ok: true, message: 'Webhook endpoint active', githubAuthEnabled });
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
// Port binding — behaviour differs by environment:
//   production : hard fail with kill instructions (nginx expects fixed port)
//   development: auto-find next free port so devs aren't blocked
// ---------------------------------------------------------------------------
function isPortFree(port) {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.on('error', () => { resolve(false); });
    tester.on('listening', () => { tester.close(() => resolve(true)); });
    tester.listen(port);
  });
}

async function findFreePort(preferred, maxTries = 10) {
  for (let i = 0; i < maxTries; i++) {
    if (await isPortFree(preferred + i)) return preferred + i;
  }
  throw new Error(`No free port found in range ${preferred}–${preferred + maxTries - 1}`);
}

async function startServer() {
  const isProduction = process.env.NODE_ENV === 'production';
  let port = config.webPort;

  if (!(await isPortFree(port))) {
    if (isProduction) {
      console.error(`\n[Server] FATAL: Port ${port} is already in use.`);
      console.error(`[Server] In production, port must be fixed. Kill the blocking process:`);
      console.error(`  Windows: netstat -ano | findstr :${port}  → then: taskkill /PID <id> /F`);
      console.error(`  Linux:   fuser -k ${port}/tcp`);
      console.error(`  PM2:     pm2 restart tiq-agent`);
      process.exit(1);
    } else {
      const fallback = await findFreePort(port + 1);
      console.warn(`\n[Server] Port ${port} busy — using ${fallback} instead (dev mode).`);
      port = fallback;
    }
  }

  const server = app.listen(port, () => {
    console.log(`\nTIQ Agent Web UI   → http://localhost:${port}`);
    console.log(`TIQ Agent Admin    → http://localhost:${port}/?tab=admin`);
    console.log(`Tool count: ${TOOL_COUNT} | Model: ${config.model}`);
    startScheduler(config.scanIntervalMinutes);
  });

  function shutdown(signal) {
    console.log(`\n[Server] ${signal} received — shutting down gracefully...`);
    server.close((err) => {
      if (err) console.error('[Server] Error during shutdown:', err.message);
      else console.log('[Server] All connections closed. Bye.');
      process.exit(err ? 1 : 0);
    });
    setTimeout(() => { console.error('[Server] Forced exit after timeout.'); process.exit(1); }, 10000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

startServer();
