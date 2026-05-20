import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { config } from '../config.js';
import { getAllFiles, toRel, CODE_EXTS, CONTENT_EXTS } from '../utils/fs.js';

export const healthCheckDefinition = {
  name: 'health_check',
  description:
    'Run a comprehensive health snapshot of the TIQ codebase: file counts by type, TODO/FIXME totals, git status (uncommitted files), env var gaps, and whether key config files exist. Returns everything in one call — ideal as the first thing to run at the start of a review session.',
  input_schema: { type: 'object', properties: {} },
};

const TODO_RE = /\b(FIXME|BUG|TODO|HACK|DEPRECATED)\b/i;

function countTodos(codebasePath) {
  let critical = 0, info = 0;
  for (const f of getAllFiles(codebasePath, CONTENT_EXTS)) {
    try {
      for (const line of fs.readFileSync(f, 'utf-8').split('\n')) {
        if (!TODO_RE.test(line)) continue;
        const tag = (TODO_RE.exec(line)?.[1] ?? '').toUpperCase();
        if (tag === 'FIXME' || tag === 'BUG') critical++; else info++;
      }
    } catch { /* skip unreadable */ }
  }
  return { critical, info, total: critical + info };
}

function fileCountsByExt(codebasePath) {
  const counts = {};
  for (const f of getAllFiles(codebasePath, CONTENT_EXTS)) {
    const ext = path.extname(f) || '(none)';
    counts[ext] = (counts[ext] ?? 0) + 1;
  }
  return counts;
}

function gitStatus(codebasePath) {
  try {
    const out = execSync('git status --short', { cwd: codebasePath, encoding: 'utf-8' }).trim();
    const lines = out ? out.split('\n') : [];
    return { uncommitted_files: lines.length, files: lines.slice(0, 10) };
  } catch {
    return { error: 'Not a git repo or git unavailable' };
  }
}

function envGaps(codebasePath) {
  const examplePath = path.join(codebasePath, '.env.example');
  if (!fs.existsSync(examplePath)) return { note: '.env.example not found at root' };

  const documented = new Set();
  for (const line of fs.readFileSync(examplePath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const key = t.split('=')[0].trim();
    if (key) documented.add(key);
  }

  const used = new Set();
  const RE = /process\.env\.([A-Z_][A-Z0-9_]*)/g;
  for (const f of getAllFiles(codebasePath, CODE_EXTS)) {
    try {
      const content = fs.readFileSync(f, 'utf-8');
      RE.lastIndex = 0;
      let m;
      while ((m = RE.exec(content)) !== null) used.add(m[1]);
    } catch { /* skip */ }
  }

  return {
    documented: documented.size,
    missing_from_example: [...used].filter(k => !documented.has(k)),
    documented_but_unused: [...documented].filter(k => !used.has(k)),
  };
}

function keyFilesPresent(codebasePath) {
  const checks = [
    '.env.example', '.gitignore', 'package.json',
    'backend/package.json', 'frontend/package.json',
    'backend/src/app.js', 'backend/src/server.js',
  ];
  return Object.fromEntries(
    checks.map(f => [f, fs.existsSync(path.join(codebasePath, f))])
  );
}

export function healthCheck() {
  try {
    const cb = config.codebasePath;
    const allFiles = getAllFiles(cb, CONTENT_EXTS);
    const codeFiles = getAllFiles(cb, CODE_EXTS);

    return {
      codebase_path: cb,
      total_files: allFiles.length,
      code_files: codeFiles.length,
      file_counts_by_ext: fileCountsByExt(cb),
      todos: countTodos(cb),
      git_status: gitStatus(cb),
      env_gaps: envGaps(cb),
      key_files: keyFilesPresent(cb),
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    return { error: err.message, suggestion: 'Check codebase path in config' };
  }
}
