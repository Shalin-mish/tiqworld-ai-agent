import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { runAgent, TOOL_COUNT } from '../agent.js';
import { classify, getTools, TASK_LABELS } from '../dispatcher.js';
import { clearLog } from '../session.js';
import { config } from '../config.js';
import { startScheduler, getLastScan, triggerScan } from '../scheduler.js';
import { logEvent, readLog, logStats } from '../activityLog.js';
import { listArchives } from '../writeArchive.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Session store — { history, taskType, user, memory }
// memory = { filesRead: Map<path,count>, toolCalls: [], writes: [] }
// ---------------------------------------------------------------------------
const sessions = new Map();

function getSession(id) {
  if (!sessions.has(id)) {
    sessions.set(id, {
      history:  [],
      taskType: null,
      user:     'unknown',
      memory: {
        filesRead: new Map(), // path → call count
        toolCalls: [],        // { name, inputSummary, at }
        writes:    [],        // { path, status, reason, at }
      },
    });
  }
  return sessions.get(id);
}

function recordSessionTool(session, name, input) {
  const mem = session.memory;
  const inputSummary = input ? Object.values(input)[0] ?? '' : '';
  mem.toolCalls.push({ name, inputSummary: String(inputSummary).slice(0, 80), at: new Date().toISOString() });

  // Track file paths for read/write/lint tools
  if (['read_file','write_file','show_diff','lint_file'].includes(name) && input?.file_path) {
    const p = input.file_path;
    mem.filesRead.set(p, (mem.filesRead.get(p) ?? 0) + 1);
  }
}

// ---------------------------------------------------------------------------
// Approval queue — write_file + run_command both pause here until resolved
// ---------------------------------------------------------------------------
const pendingApprovals = new Map();

function makeApprovalFn(sessionId, send) {
  const session = getSession(sessionId);
  return (filePath, diff, reason, isNew, oldContent, newContent) =>
    new Promise((resolve) => {
      const id = crypto.randomUUID();
      pendingApprovals.set(id, { resolve, filePath, diff, reason, isNew });
      // Track as pending write in session memory
      session.memory.writes.push({ path: filePath, status: 'pending', reason, at: new Date().toISOString(), approvalId: id });
      send('approval_needed', { approvalId: id, filePath, diff, reason, isNew });
    });
}

function makeCommandApprovalFn(sessionId, send) {
  return (command, directory) =>
    new Promise((resolve) => {
      const id = crypto.randomUUID();
      pendingApprovals.set(id, { resolve, command, directory });
      send('command_approval_needed', { approvalId: id, command, directory: directory || '(root)' });
    });
}

// ---------------------------------------------------------------------------
// GET /api/status
// ---------------------------------------------------------------------------
app.get('/api/status', (_req, res) => {
  const { scannedAt, result } = getLastScan();
  res.json({
    ok:           true,
    tool_count:   TOOL_COUNT,
    version:      '0.6.0',
    model:        config.model,
    last_scan:    scannedAt ?? null,
    scan_summary: result?.summary ?? null,
  });
});

// ---------------------------------------------------------------------------
// POST /api/identify  — set the current user's name for this session
// ---------------------------------------------------------------------------
app.post('/api/identify', (req, res) => {
  const { sessionId, user } = req.body ?? {};
  if (!sessionId || !user?.trim()) {
    res.status(400).json({ error: 'sessionId and user required' }); return;
  }
  const session = getSession(sessionId);
  session.user  = user.trim().slice(0, 40);
  logEvent({ user: session.user, action: 'session_start', sessionId });
  res.json({ ok: true, user: session.user });
});

// ---------------------------------------------------------------------------
// POST /api/scan  — trigger manual full scan
// ---------------------------------------------------------------------------
app.post('/api/scan', async (req, res) => {
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

// ---------------------------------------------------------------------------
// GET /api/last-scan
// ---------------------------------------------------------------------------
app.get('/api/last-scan', (_req, res) => {
  const { result, scannedAt } = getLastScan();
  if (!result) { res.json({ ok: false, message: 'No scan run yet' }); return; }
  res.json({ ok: true, scannedAt, result });
});

// ---------------------------------------------------------------------------
// POST /api/clear
// ---------------------------------------------------------------------------
app.post('/api/clear', (req, res) => {
  const id   = req.body.sessionId ?? 'default';
  const user = getSession(id).user ?? 'unknown';
  sessions.delete(id);
  clearLog();
  logEvent({ user, action: 'session_clear', sessionId: id });
  res.json({ ok: true, sessionId: id });
});

// ---------------------------------------------------------------------------
// GET /api/activity  — last N activity log entries
// ---------------------------------------------------------------------------
app.get('/api/activity', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit ?? '100', 10), 500);
  res.json({ ok: true, entries: readLog(limit), stats: logStats() });
});

// ---------------------------------------------------------------------------
// GET /api/writes  — list write archives
// ---------------------------------------------------------------------------
app.get('/api/writes', (_req, res) => {
  res.json({ ok: true, archives: listArchives(100) });
});

// ---------------------------------------------------------------------------
// GET /api/session/:id/memory  — what this session has read/changed
// ---------------------------------------------------------------------------
app.get('/api/session/:id/memory', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) { res.json({ ok: false, message: 'Session not found' }); return; }
  const mem = session.memory;
  res.json({
    ok:        true,
    sessionId: req.params.id,
    user:      session.user,
    taskType:  session.taskType,
    filesRead: Object.fromEntries(mem.filesRead),
    toolCalls: mem.toolCalls,
    writes:    mem.writes,
    summary: {
      files_read:  mem.filesRead.size,
      tool_calls:  mem.toolCalls.length,
      writes_total: mem.writes.length,
      writes_approved: mem.writes.filter(w => w.status === 'approved').length,
      writes_denied:   mem.writes.filter(w => w.status === 'denied').length,
    },
  });
});

// ---------------------------------------------------------------------------
// POST /api/approve  — resolve a pending write_file or run_command approval
// ---------------------------------------------------------------------------
app.post('/api/approve', (req, res) => {
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

  // Update session memory write status if this was a write_file approval
  if (sessionId && pending.path) {
    const session = sessions.get(sessionId);
    if (session) {
      const wi = session.memory.writes.findIndex(w => w.approvalId === approvalId);
      if (wi !== -1) session.memory.writes[wi].status = approved ? 'approved' : 'denied';
    }
  }

  res.json({ ok: true, decision });
});

// ---------------------------------------------------------------------------
// GET /api/chat  — SSE, streams tool events then final answer
// ---------------------------------------------------------------------------
app.get('/api/chat', async (req, res) => {
  const question  = (req.query.q ?? '').trim();
  if (!question) { res.status(400).json({ error: 'q is required' }); return; }

  const sessionId = req.query.sessionId ?? 'default';
  const session   = getSession(sessionId);
  const user      = session.user;

  // Log the question
  logEvent({ user, action: 'query', sessionId, detail: { q: question.slice(0, 200) } });

  // SSE setup
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  const send = (type, payload) =>
    res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);

  if (!session.taskType) {
    session.taskType = classify(question);
    send('task_type', { label: TASK_LABELS[session.taskType], raw: session.taskType });
  }

  const tools = getTools(session.taskType);

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
        }
      },
      user,
      approvalFn,
      commandApprovalFn,
    );

    session.history = messages.slice(-20);
    send('answer', { text: answer });
  } catch (err) {
    send('error', { message: err.message });
    logEvent({ user, action: 'error', sessionId, detail: { message: err.message } });
  }

  res.write('data: [DONE]\n\n');
  res.end();
});

// ---------------------------------------------------------------------------
// GET /admin  — serve admin panel
// ---------------------------------------------------------------------------
app.get('/admin', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.listen(config.webPort, () => {
  console.log(`\nTIQ Agent Web UI   → http://localhost:${config.webPort}`);
  console.log(`TIQ Agent Admin    → http://localhost:${config.webPort}/admin`);
  console.log(`Tool count: ${TOOL_COUNT} | Model: ${config.model}`);
  startScheduler(config.scanIntervalMinutes);
});
