import { Router }      from 'express';
import rateLimit       from 'express-rate-limit';
import { runAgent, TOOL_COUNT, projectInfo } from '../agent.js';
import { classify, getTools, TASK_LABELS } from '../dispatcher.js';
import { clearLog }    from '../session.js';
import { config }      from '../config.js';
import { getLastScan, triggerScan } from '../scheduler.js';
import { logEvent, readLog, logStats } from '../activityLog.js';
import { listArchives } from '../writeArchive.js';
import { unreadCount, getNotifications, markAllRead, markRead } from '../notifications.js';
import { healthMonitor } from '../tools/healthMonitor.js';
import { saveSession, loadSession, deleteSession, listPersistedSessions } from '../sessionPersistence.js';

// ---------------------------------------------------------------------------
// Session store  { history, taskType, user, github, memory, lastActiveAt, tokens }
// ---------------------------------------------------------------------------
export const sessions = new Map();

// Evict sessions idle for more than 2 hours — runs every 30 minutes.
const SESSION_TTL_MS   = 2 * 60 * 60 * 1000;
const SESSION_GC_INTERVAL = 30 * 60 * 1000;
setInterval(() => {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, s] of sessions) {
    if (s.lastActiveAt < cutoff) sessions.delete(id);
  }
}, SESSION_GC_INTERVAL).unref();

export function getSession(id) {
  if (!sessions.has(id)) {
    // Try to hydrate from disk (survives server restarts)
    const persisted = loadSession(id);
    sessions.set(id, persisted
      ? { ...persisted, lastActiveAt: Date.now() }
      : {
          history:      [],
          taskType:     null,
          user:         'unknown',
          github:       null,
          lastActiveAt: Date.now(),
          tokens:       { in: 0, out: 0, cacheRead: 0 },
          memory: {
            filesRead: new Map(),
            toolCalls: [],
            writes:    [],
          },
        }
    );
  }
  const s = sessions.get(id);
  s.lastActiveAt = Date.now();
  return s;
}

function recordSessionTool(session, name, input) {
  const mem = session.memory;
  const inputSummary = input ? Object.values(input)[0] ?? '' : '';
  mem.toolCalls.push({ name, inputSummary: String(inputSummary).slice(0, 80), at: new Date().toISOString() });
  if (['read_file','write_file','show_diff','lint_file'].includes(name) && input?.file_path) {
    const p = input.file_path;
    mem.filesRead.set(p, (mem.filesRead.get(p) ?? 0) + 1);
  }
}

// ---------------------------------------------------------------------------
// Approval queue — with 5-minute auto-reject timeout
// ---------------------------------------------------------------------------
export const pendingApprovals = new Map();

const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;

function scheduleApprovalTimeout(id, sessionId) {
  setTimeout(() => {
    const pending = pendingApprovals.get(id);
    if (!pending) return;
    pendingApprovals.delete(id);
    pending.resolve('no');
    // Mark write as timed-out in session memory
    const session = sessions.get(sessionId);
    if (session) {
      const wi = session.memory.writes.findIndex(w => w.approvalId === id);
      if (wi !== -1) session.memory.writes[wi].status = 'timed_out';
    }
  }, APPROVAL_TIMEOUT_MS).unref();
}

function makeApprovalFn(sessionId, send) {
  const session = getSession(sessionId);
  return (filePath, diff, reason, isNew) =>
    new Promise((resolve) => {
      const id = crypto.randomUUID();
      pendingApprovals.set(id, { resolve, filePath, diff, reason, isNew });
      session.memory.writes.push({ path: filePath, status: 'pending', reason, at: new Date().toISOString(), approvalId: id });
      send('approval_needed', { approvalId: id, filePath, diff, reason, isNew });
      scheduleApprovalTimeout(id, sessionId);
    });
}

function makeCommandApprovalFn(sessionId, send) {
  return (command, directory) =>
    new Promise((resolve) => {
      const id = crypto.randomUUID();
      pendingApprovals.set(id, { resolve, command, directory });
      send('command_approval_needed', { approvalId: id, command, directory: directory || '(root)' });
      scheduleApprovalTimeout(id, sessionId);
    });
}

// ---------------------------------------------------------------------------
// Rate limiters
// ---------------------------------------------------------------------------
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max:      15,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many requests — max 15 queries/min per IP. Please slow down.' },
});

const scanLimiter = rateLimit({
  windowMs: 60 * 1000,
  max:      5,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many scan requests — max 5/min per IP.' },
});

// ---------------------------------------------------------------------------
// Router factory — allows tests to inject githubAuthEnabled flag
// ---------------------------------------------------------------------------
export function createRouter({ githubAuthEnabled = false } = {}) {
  const router = Router();

  // GET /api/status
  router.get('/api/status', (_req, res) => {
    const { scannedAt, result } = getLastScan();
    res.json({
      ok:                   true,
      tool_count:           TOOL_COUNT,
      version:              '1.0.0',
      model:                config.model,
      last_scan:            scannedAt ?? null,
      scan_summary:         result?.summary ?? null,
      unread_notifications: unreadCount(),
      project_name:         projectInfo?.name        ?? 'Unknown Project',
      language:             projectInfo?.language     ?? 'unknown',
      framework:            projectInfo?.framework    ?? 'unknown',
      is_monorepo:          projectInfo?.isMonorepo   ?? false,
    });
  });

  // GET /api/me
  router.get('/api/me', (req, res) => {
    if (req.user) {
      res.json({ ok: true, user: req.user, authMode: 'github' });
    } else {
      res.json({ ok: false, user: null, authMode: githubAuthEnabled ? 'github' : 'name' });
    }
  });

  // POST /api/identify
  router.post('/api/identify', (req, res) => {
    const { sessionId, user } = req.body ?? {};
    if (!sessionId || !user?.trim()) {
      res.status(400).json({ error: 'sessionId and user required' }); return;
    }
    const agentSession = getSession(sessionId);
    agentSession.user  = req.user?.login ?? user.trim().slice(0, 40);
    if (req.user) agentSession.github = req.user;
    logEvent({ user: agentSession.user, action: 'session_start', sessionId, detail: { authMode: req.user ? 'github' : 'name' } });
    res.json({ ok: true, user: agentSession.user, github: req.user ?? null });
  });

  // POST /api/scan  (rate-limited)
  router.post('/api/scan', scanLimiter, async (req, res) => {
    const sessionId = req.body?.sessionId ?? 'system';
    const user      = getSession(sessionId).user ?? 'unknown';
    logEvent({ user, action: 'manual_scan', sessionId });
    try {
      const result = await triggerScan();
      res.json({ ok: true, result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/last-scan
  router.get('/api/last-scan', (_req, res) => {
    const { result, scannedAt } = getLastScan();
    if (!result) { res.json({ ok: false, message: 'No scan run yet' }); return; }
    res.json({ ok: true, scannedAt, result });
  });

  // GET /api/health-monitor — run a live health probe
  router.get('/api/health-monitor', async (_req, res) => {
    try {
      const result = await healthMonitor({ last_minutes: 60 });
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/override — force task type for a session (when confidence is low)
  router.post('/api/override', (req, res) => {
    const { sessionId } = req.body ?? {};
    const taskType = req.body?.taskType?.toLowerCase?.();
    const valid = ['query', 'review', 'maintenance', 'feature'];
    if (!sessionId || !valid.includes(taskType)) {
      res.status(400).json({ error: `sessionId and taskType required. Valid types: ${valid.join(', ')}` });
      return;
    }
    const session  = getSession(sessionId);
    session.taskType = taskType;
    session.history  = [];
    logEvent({ user: session.user, action: 'task_override', sessionId, detail: { taskType } });
    res.json({ ok: true, taskType, label: TASK_LABELS[taskType] });
  });

  // POST /api/clear
  router.post('/api/clear', (req, res) => {
    const id   = req.body.sessionId ?? 'default';
    const user = getSession(id).user ?? 'unknown';
    sessions.delete(id);
    clearLog(id);
    deleteSession(id);
    logEvent({ user, action: 'session_clear', sessionId: id });
    res.json({ ok: true, sessionId: id });
  });

  // GET /api/sessions — list persisted sessions (restart-survivable)
  router.get('/api/sessions', (_req, res) => {
    res.json({ ok: true, sessions: listPersistedSessions() });
  });

  // GET /api/activity
  router.get('/api/activity', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit ?? '100', 10), 500);
    res.json({ ok: true, entries: readLog(limit), stats: logStats() });
  });

  // GET /api/writes
  router.get('/api/writes', (_req, res) => {
    res.json({ ok: true, archives: listArchives(100) });
  });

  // GET /api/notifications
  router.get('/api/notifications', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit ?? '50', 10), 200);
    res.json({ ok: true, notifications: getNotifications(limit), unread: unreadCount() });
  });

  // POST /api/notifications/read-all
  router.post('/api/notifications/read-all', (_req, res) => {
    markAllRead();
    res.json({ ok: true });
  });

  // PATCH /api/notifications/:id/read
  router.patch('/api/notifications/:id/read', (req, res) => {
    markRead(req.params.id);
    res.json({ ok: true });
  });

  // GET /api/session/:id/memory
  router.get('/api/session/:id/memory', (req, res) => {
    const session = sessions.get(req.params.id);
    if (!session) { res.json({ ok: false, message: 'Session not found' }); return; }
    const mem = session.memory;
    res.json({
      ok:        true,
      sessionId: req.params.id,
      user:      session.user,
      github:    session.github ?? null,
      taskType:  session.taskType,
      tokens:    session.tokens,
      filesRead: Object.fromEntries(mem.filesRead),
      toolCalls: mem.toolCalls,
      writes:    mem.writes,
      summary: {
        files_read:       mem.filesRead.size,
        tool_calls:       mem.toolCalls.length,
        writes_total:     mem.writes.length,
        writes_approved:  mem.writes.filter(w => w.status === 'approved').length,
        writes_denied:    mem.writes.filter(w => w.status === 'denied').length,
      },
    });
  });

  // POST /api/approve
  router.post('/api/approve', (req, res) => {
    const { approvalId, decision, sessionId } = req.body ?? {};
    if (!approvalId || !decision) {
      res.status(400).json({ error: 'approvalId and decision required' }); return;
    }
    const pending = pendingApprovals.get(approvalId);
    if (!pending) {
      res.status(404).json({ error: 'Approval request not found or already resolved' }); return;
    }
    pendingApprovals.delete(approvalId);
    const approved = decision === 'approve';
    pending.resolve(approved ? 'yes' : 'no');
    if (sessionId && pending.filePath) {
      const session = sessions.get(sessionId);
      if (session) {
        const wi = session.memory.writes.findIndex(w => w.approvalId === approvalId);
        if (wi !== -1) session.memory.writes[wi].status = approved ? 'approved' : 'denied';
      }
    }
    res.json({ ok: true, decision });
  });

  // GET /api/chat — SSE streaming (rate-limited)
  router.get('/api/chat', chatLimiter, async (req, res) => {
    // Cap question length — prevents multi-KB inputs from burning tokens
    const MAX_Q = 4000;
    const raw      = (req.query.q ?? '').trim();
    const question = raw.slice(0, MAX_Q);
    if (!question) { res.status(400).json({ error: 'q is required' }); return; }

    const sessionId = req.query.sessionId ?? 'default';
    const session   = getSession(sessionId);
    const user      = session.user;

    if (raw.length > MAX_Q) {
      logEvent({ user, action: 'input_truncated', sessionId, detail: { original: raw.length, cap: MAX_Q } });
    }
    logEvent({ user, action: 'query', sessionId, detail: { q: question.slice(0, 200) } });

    res.setHeader('Content-Type',  'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection',    'keep-alive');
    res.flushHeaders();

    let _clientAborted = false;
    req.on('close', () => { _clientAborted = true; });

    const send = (type, payload) => {
      if (_clientAborted) return;
      res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
    };

    // Overall SSE timeout — kills hanging requests before the browser gives up
    const chatAbort = new AbortController();
    const chatTimeoutHandle = setTimeout(() => {
      chatAbort.abort();
      send('error', { message: `Request timed out after ${config.chatTimeoutMs / 1000}s` });
      res.write('data: [DONE]\n\n');
      res.end();
    }, config.chatTimeoutMs);

    if (!session.taskType) {
      const classResult = classify(question);
      session.taskType  = classResult.type;
      send('task_type', {
        label:      TASK_LABELS[session.taskType],
        raw:        session.taskType,
        confidence: classResult.confidence,
        scores:     classResult.scores,
        lowConfidence: classResult.confidence < 50,
      });
    }

    const tools             = getTools(session.taskType);
    const approvalFn        = makeApprovalFn(sessionId, send);
    const commandApprovalFn = makeCommandApprovalFn(sessionId, send);

    try {
      const { answer, messages } = await runAgent(
        question,
        session.history,
        tools,
        (event) => {
          if (event.type === 'tool_call') {
            send('tool_call', { name: event.name, input: event.input });
            logEvent({ user, action: `tool:${event.name}`, sessionId, detail: { input: event.input } });
            recordSessionTool(session, event.name, event.input);
          } else if (event.type === 'tool_result') {
            send('tool_result', { name: event.name, result: event.result });
          } else if (event.type === 'token_usage') {
            // Accumulate per-session token totals and forward to UI
            session.tokens.in        += event.in        ?? 0;
            session.tokens.out       += event.out       ?? 0;
            session.tokens.cacheRead += event.cacheRead ?? 0;
            send('token_usage', {
              turn:    event,
              session: session.tokens,
            });
          }
        },
        user,
        approvalFn,
        commandApprovalFn,
        sessionId,
        8,
        chatAbort.signal,
      );
      clearTimeout(chatTimeoutHandle);
      // Keep last 8 messages (4 turns) — matches CLI cap, saves tokens
      session.history = messages.slice(-8);
      // Persist session to disk so history survives server restarts
      saveSession(sessionId, session);
      send('answer', { text: answer });
    } catch (err) {
      clearTimeout(chatTimeoutHandle);
      send('error', { message: err.message });
      logEvent({ user, action: 'error', sessionId, detail: { message: err.message } });
    }

    if (!chatAbort.signal.aborted) {
      res.write('data: [DONE]\n\n');
      res.end();
    }
  });

  return router;
}
