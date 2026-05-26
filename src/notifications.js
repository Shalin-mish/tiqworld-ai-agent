import fs   from 'fs';
import path from 'path';

const LOGS_DIR  = path.join(process.cwd(), 'logs');
const NOTIF_FILE = path.join(LOGS_DIR, 'notifications.json');

function ensureDir() {
  if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
}

function readAll() {
  ensureDir();
  try { return JSON.parse(fs.readFileSync(NOTIF_FILE, 'utf-8')); }
  catch { return []; }
}

function writeAll(list) {
  ensureDir();
  fs.writeFileSync(NOTIF_FILE, JSON.stringify(list.slice(-500), null, 2));
}

// Add a notification (persisted to disk + optional webhook)
export function notify(type, title, body) {
  const all = readAll();
  all.push({
    id:    Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    type,  // 'success' | 'warning' | 'error' | 'info'
    title,
    body,
    at:    new Date().toISOString(),
    read:  false,
  });
  writeAll(all);
  sendWebhook(type, title, body).catch(() => {});
}

export function getNotifications(limit = 50) {
  return readAll().reverse().slice(0, limit);
}

export function markRead(id) {
  const all = readAll();
  const n = all.find(x => x.id === id);
  if (n) { n.read = true; writeAll(all); }
}

export function markAllRead() {
  const all = readAll().map(n => ({ ...n, read: true }));
  writeAll(all);
}

export function unreadCount() {
  return readAll().filter(n => !n.read).length;
}

// Slack or Discord webhook — set NOTIFICATION_WEBHOOK_URL in .env
async function sendWebhook(type, title, body) {
  const url = process.env.NOTIFICATION_WEBHOOK_URL;
  if (!url) return;

  const icon = { success: '✅', warning: '⚠️', error: '❌', info: 'ℹ️' }[type] ?? '🤖';
  const text = `${icon} *[TIQ Agent] ${title}*\n${body}`;

  const payload = url.includes('hooks.slack.com')
    ? { text }
    : { content: text.replace(/\*/g, '**') };  // Discord uses **bold**

  await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  });
}
