import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import session from 'express-session';
import passport from 'passport';
import { Strategy as GitHubStrategy } from 'passport-github2';
import { config } from '../config.js';
import { startScheduler } from '../scheduler.js';
import { TOOL_COUNT } from '../agent.js';
import { createRouter } from './router.js';

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

// GET /admin
app.get('/admin', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ---------------------------------------------------------------------------
app.listen(config.webPort, () => {
  console.log(`\nTIQ Agent Web UI   → http://localhost:${config.webPort}`);
  console.log(`TIQ Agent Admin    → http://localhost:${config.webPort}/admin`);
  console.log(`Tool count: ${TOOL_COUNT} | Model: ${config.model}`);
  startScheduler(config.scanIntervalMinutes);
});
