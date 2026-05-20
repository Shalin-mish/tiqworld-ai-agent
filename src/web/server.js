import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { runAgent, TOOL_COUNT } from '../agent.js';
import { classify, getTools, TASK_LABELS } from '../dispatcher.js';
import { clearLog } from '../session.js';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// In-memory conversation store keyed by sessionId.
// Each entry: { history: Message[], taskType: string | null }
const sessions = new Map();

function getSession(id) {
  if (!sessions.has(id)) sessions.set(id, { history: [], taskType: null });
  return sessions.get(id);
}

// ---------------------------------------------------------------------------
// GET /api/status  — health ping, shows tool count + version
// ---------------------------------------------------------------------------
app.get('/api/status', (_req, res) => {
  res.json({ ok: true, tool_count: TOOL_COUNT, version: '0.4.0', model: config.model });
});

// ---------------------------------------------------------------------------
// POST /api/clear  — reset a session's conversation + session log
// ---------------------------------------------------------------------------
app.post('/api/clear', (req, res) => {
  const id = req.body.sessionId ?? 'default';
  sessions.delete(id);
  clearLog();
  res.json({ ok: true, sessionId: id });
});

// ---------------------------------------------------------------------------
// GET /api/chat  — SSE endpoint, streams tool events then final answer
//
// Query params:
//   q         — user message (required)
//   sessionId — client-supplied UUID (default: "default")
// ---------------------------------------------------------------------------
app.get('/api/chat', async (req, res) => {
  const question = (req.query.q ?? '').trim();
  if (!question) { res.status(400).json({ error: 'q is required' }); return; }

  const sessionId = req.query.sessionId ?? 'default';
  const session   = getSession(sessionId);

  // SSE setup
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  const send = (type, payload) => {
    res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
  };

  // Classify only on the first turn of a session.
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
      (event) => send('tool_call', { name: event.name, input: event.input }),
    );

    // Keep last 20 messages to avoid unbounded growth.
    session.history = messages.slice(-20);

    send('answer', { text: answer });
  } catch (err) {
    send('error', { message: err.message });
  }

  res.write('data: [DONE]\n\n');
  res.end();
});

app.listen(config.webPort, () => {
  console.log(`\nTIQ Agent Web UI → http://localhost:${config.webPort}`);
  console.log(`Tool count: ${TOOL_COUNT} | Model: ${config.model}\n`);
});
