import fs from 'fs';
import path from 'path';

export const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.venv',
  '__pycache__', 'coverage', '.next', '.cache',
]);

export const CODE_EXTS    = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
export const CONTENT_EXTS = new Set([...CODE_EXTS, '.json', '.md']);

/**
 * Recursively collect all files under dirPath whose extension is in exts.
 * SKIP_DIRS and dot-directories are never descended into.
 */
export function getAllFiles(dirPath, exts = CODE_EXTS, out = []) {
  if (!fs.existsSync(dirPath)) return out;
  let entries;
  try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); }
  catch { return out; }

  for (const e of entries) {
    const full = path.join(dirPath, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) getAllFiles(full, exts, out);
    } else if (exts.has(path.extname(e.name))) {
      out.push(full);
    }
  }
  return out;
}

/** Convert absolute path to a forward-slash relative path from basePath. */
export function toRel(fullPath, basePath) {
  return path.relative(basePath, fullPath).replace(/\\/g, '/');
}

/** Read a file safely — returns null if missing, unreadable, or over maxBytes. */
export function readSafe(fullPath, maxBytes = 100 * 1024) {
  try {
    if (fs.statSync(fullPath).size > maxBytes) return null;
    return fs.readFileSync(fullPath, 'utf-8');
  } catch {
    return null;
  }
}
