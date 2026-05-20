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

const sessions = new Map();

function getSession(id) {
  if (!sessions.has(id)) sessions.set(id, { history: [], taskType: null, user: 'unknown' });
  return sessions.get(id);
}

app.get('/api/status', (_req, res) => {
  const { scannedAt, result } = getLastScan();
  res.json({ ok: true, tool_count: TOOL_COUNT, version: '0.5.0', model: config.model,
    last_scan: scannedAt ?? null, scan_summary: result?.summary ?? null });
});

app.post('/api/identify', (req, res) => {
  const { sessionId, user } = req.body ?? {};
  if (!sessionId || !user?.trim()) { res.status(400).json({ error: 'sessionId and user required' }); return; }
  const session = getSession(sessionId);
  session.user  = user.trim().slice(0, 40);
  logEvent({ user: session.user, action: 'session_start', sessionId });
  res.json({ ok: true, user: session.user });
});

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

app.get('/api/last-scan', (_req, res) => {
  const { result, scannedAt } = getLastScan();
  if (!result) { res.json({ ok: false, message: 'No scan run yet' }); return; }
  res.json({ ok: true, scannedAt, result });
});

app.post('/api/clear', (req, res) => {
  const id   = req.body.sessionId ?? 'default';
  const user = getSession(id).user ?? 'unknown';
  sessions.delete(id);
  clearLog();
  logEvent({ user, action: 'session_clear', sessionId: id });
  res.json({ ok: true, sessionId: id });
});

app.get('/api/activity', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit ?? '100', 10), 500);
  res.json({ ok: true, entries: readLog(limit), stats: logStats() });
});

app.get('/api/writes', (_req, res) => {
  res.json({ ok: true, archives: listArchives(100) });
});

app.get('/api/chat', async (req, res) => {
  const question  = (req.query.q ?? '').trim();
  if (!question) { res.status(400).json({ error: 'q is required' }); return; }

  const sessionId = req.query.sessionId ?? 'default';
  const session   = getSession(sessionId);
  const user      = session.user;

  logEvent({ user, action: 'query', sessionId, detail: { q: question.slice(0, 200) } });

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

  try {
    const { answer, messages } = await runAgent(
      question,
      session.history,
      tools,
      (event) => {
        send('tool_call', { name: event.name, input: event.input });
        logEvent({ user, action: `tool:${event.name}`, sessionId, detail: { input: event.input } });
      },
      user,
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

app.get('/admin', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.listen(config.webPort, () => {
  console.log(`\nTIQ Agent Web UI   → http://localhost:${config.webPort}`);
  console.log(`TIQ Agent Admin    → http://localhost:${config.webPort}/admin`);
  console.log(`Tool count: ${TOOL_COUNT} | Model: ${config.model}`);
  startScheduler(config.scanIntervalMinutes);
});
