import { execSync } from 'child_process';
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { config } from '../config.js';

// Patterns written as regex literals so escaping stays in one place
const PATTERNS = [
  { name: 'AWS Access Key',        re: /AKIA[0-9A-Z]{16}/ },
  { name: 'Private Key Header',    re: /-----BEGIN (?:RSA|EC|OPENSSH|DSA) PRIVATE KEY/ },
  { name: 'JWT Token',             re: /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/ },
  { name: 'DB Connection String',  re: /(?:mongodb|postgresql|mysql|redis):\/\/[^:\s]+:[^@\s]+@/ },
  { name: 'Slack Token',           re: /xox[baprs]-[0-9a-zA-Z\-]{20,}/ },
  { name: 'GitHub Token',          re: /ghp_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9_]{50,}/ },
  { name: 'Generic API Key',       re: /(?:api[_-]?key|apikey)\s*[=:]\s*["'][\w\-]{20,}["']/ },
  { name: 'Hardcoded Password',    re: /(?:password|passwd|pwd)\s*[=:]\s*["'][^"'\s]{8,}["']/ },
  { name: 'Bearer Token',          re: /Bearer\s+[a-zA-Z0-9_\-\.]{30,}/ },
];

const SKIP_EXTS = new Set(['.jpg','.jpeg','.png','.gif','.svg','.ico',
  '.woff','.woff2','.ttf','.eot','.bin','.lock','.map','.zip','.gz']);
const SKIP_DIRS = ['node_modules','.git','dist','build','logs','.claude'];

export const secretScannerDefinition = {
  name: 'secret_scanner',
  description: 'Scan the codebase for accidentally committed secrets — API keys, tokens, passwords, private keys. Only scans git-tracked files.',
  input_schema: {
    type: 'object',
    properties: {
      directory: { type: 'string', description: 'Root directory to scan (defaults to codebase root)' },
    },
    required: [],
  },
};

export async function secretScanner({ directory } = {}) {
  const root = directory || config.codebasePath;
  const findings = [];
  let scannedFiles = 0;
  let skippedFiles = 0;

  // prefer git ls-files to only check tracked files
  let files = [];
  try {
    const out = execSync('git ls-files', { cwd: root, encoding: 'utf-8', timeout: 15000 });
    files = out.trim().split('\n').filter(Boolean);
  } catch {
    files = walkDir(root);
  }

  for (const rel of files) {
    const ext = path.extname(rel).toLowerCase();
    if (SKIP_EXTS.has(ext)) { skippedFiles++; continue; }
    const parts = rel.replace(/\\/g, '/').split('/');
    if (parts.some(p => SKIP_DIRS.includes(p))) { skippedFiles++; continue; }
    // .env itself is expected to have secrets
    if (rel === '.env' || rel.endsWith('/.env')) { skippedFiles++; continue; }

    let content;
    try { content = readFileSync(path.join(root, rel), 'utf-8'); }
    catch { continue; }

    scannedFiles++;
    const lines = content.split('\n');

    for (const { name, re } of PATTERNS) {
      const gRe = new RegExp(re.source, re.flags.includes('i') ? 'gi' : 'g');
      let m;
      while ((m = gRe.exec(content)) !== null) {
        const lineNum = content.slice(0, m.index).split('\n').length;
        findings.push({
          type:    name,
          file:    rel,
          line:    lineNum,
          snippet: lines[lineNum - 1]?.trim().slice(0, 120) ?? '',
        });
        if (findings.length >= 100) break;
      }
      if (findings.length >= 100) break;
    }
    if (findings.length >= 100) break;
  }

  const fileSet = new Set(findings.map(f => f.file));
  return {
    ok: true,
    scanned_files:  scannedFiles,
    skipped_files:  skippedFiles,
    findings_count: findings.length,
    affected_files: fileSet.size,
    findings,
    summary: findings.length === 0
      ? 'No secrets detected — codebase is clean.'
      : `WARNING: ${findings.length} potential secret(s) found in ${fileSet.size} file(s). Review immediately.`,
  };
}

const MAX_WALK_FILES = 50_000;
const MAX_WALK_DEPTH = 12;

function walkDir(dir, rel = '', _depth = 0, _out = []) {
  if (_out.length >= MAX_WALK_FILES || _depth > MAX_WALK_DEPTH) return _out;
  try {
    for (const name of readdirSync(dir)) {
      if (_out.length >= MAX_WALK_FILES) break;
      if (SKIP_DIRS.includes(name)) continue;
      const full = path.join(dir, name);
      const r    = rel ? rel + '/' + name : name;
      try {
        if (statSync(full).isDirectory()) walkDir(full, r, _depth + 1, _out);
        else _out.push(r);
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return _out;
}
