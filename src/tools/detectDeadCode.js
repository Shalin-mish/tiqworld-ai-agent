import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { getAllFiles, toRel, CODE_EXTS } from '../utils/fs.js';

export const detectDeadCodeDefinition = {
  name: 'detect_dead_code',
  description:
    'Find files in a directory that are never imported by any other file in the codebase. Surfaces orphaned utilities, unused modules, and dead code. Entry-point files (index/main/server/app/cli) are excluded.',
  input_schema: {
    type: 'object',
    properties: {
      directory: {
        type: 'string',
        description: 'Directory to check e.g. "backend/src/utils". Omit to scan the entire codebase.',
      },
    },
  },
};

// Files matching these names are valid entry points — not expected to be imported.
const ENTRY_RE = /\b(index|main|server|app|cli|seed)\.(js|ts|mjs|cjs)$/i;

const IMPORT_RE = /(?:import|require)\s*(?:.*?\s+from\s+)?['"](\.{1,2}[^'"]+)['"]/g;

function buildImportersMap(allFiles, codebasePath) {
  const importedBy = {};

  for (const filePath of allFiles) {
    let content;
    try { content = fs.readFileSync(filePath, 'utf-8'); } catch { continue; }
    const dir = path.dirname(filePath);
    IMPORT_RE.lastIndex = 0;
    let m;

    while ((m = IMPORT_RE.exec(content)) !== null) {
      const resolved = path.resolve(dir, m[1]);
      const variants = ['', '.js', '.jsx', '.ts', '.tsx', '/index.js', '/index.ts'];

      for (const ext of variants) {
        const candidate = resolved + ext;
        if (fs.existsSync(candidate)) {
          const rel = toRel(candidate, codebasePath);
          if (!importedBy[rel]) importedBy[rel] = [];
          importedBy[rel].push(toRel(filePath, codebasePath));
          break;
        }
      }
    }
  }

  return importedBy;
}

export function detectDeadCode({ directory = '' } = {}) {
  try {
    const targetPath = path.join(config.codebasePath, directory);
    if (!fs.existsSync(targetPath)) {
      return { error: `Directory not found: ${directory}`, suggestion: 'Use list_files to explore' };
    }

    const allCodebaseFiles = getAllFiles(config.codebasePath, CODE_EXTS);
    const importersMap = buildImportersMap(allCodebaseFiles, config.codebasePath);
    const targetFiles = getAllFiles(targetPath, CODE_EXTS);

    const unreferenced = targetFiles
      .filter(f => !importersMap[toRel(f, config.codebasePath)] && !ENTRY_RE.test(path.basename(f)))
      .map(f => toRel(f, config.codebasePath));

    return {
      directory: directory || '(entire codebase)',
      scanned: targetFiles.length,
      unreferenced_count: unreferenced.length,
      note: 'Entry-point files (index/main/server/app/cli/seed) are excluded.',
      unreferenced,
      scannedAt: new Date().toISOString(),
    };
  } catch (err) {
    return { error: err.message, suggestion: 'Check the directory path' };
  }
}
