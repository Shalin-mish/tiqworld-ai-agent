import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

/**
 * fix_error: end-to-end pipeline
 *   trace_error → read context → compute confidence → expose fix steps
 *
 * This is a meta-tool — it does NOT call other tools directly (no circular
 * imports). Instead it reads files itself and returns a structured payload
 * that Claude uses to drive the git_backup → show_diff → write_file sequence.
 */

export const fixErrorDefinition = {
  name: 'fix_error',
  description:
    'End-to-end error diagnosis pipeline. Given an error message or stack trace, ' +
    'locates every involved file, reads context around the error line, scores fix confidence ' +
    '(0-100), and returns a structured diagnosis with suggested fix steps. ' +
    'Always use this instead of manually chaining trace_error + read_file when the goal is to fix a bug.',
  input_schema: {
    type: 'object',
    properties: {
      error_text: {
        type: 'string',
        description: 'Full error message + stack trace. Paste exactly as it appears in the terminal.',
      },
      fix_hint: {
        type: 'string',
        description: 'Optional: short description of what you think the fix is. Helps score confidence.',
      },
      codebase_path: {
        type: 'string',
        description: 'Override codebase root. Defaults to config.codebasePath.',
      },
    },
    required: ['error_text'],
  },
};

const EXCLUDE_DIRS = ['node_modules', '.git', 'dist', 'build', '.vite', 'logs'];
const CODE_EXTS    = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'];
const CONTEXT_LINES = 10;

// ─── file helpers ────────────────────────────────────────────────────────────

function getAllSourceFiles(dirPath, out = []) {
  if (!fs.existsSync(dirPath)) return out;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDE_DIRS.includes(entry.name) && !entry.name.startsWith('.')) {
        getAllSourceFiles(full, out);
      }
    } else if (CODE_EXTS.includes(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

function readSnippet(fullPath, targetLine) {
  try {
    const lines  = fs.readFileSync(fullPath, 'utf-8').split('\n');
    const start  = Math.max(0, targetLine - CONTEXT_LINES - 1);
    const end    = Math.min(lines.length, targetLine + CONTEXT_LINES);
    const snippet = lines
      .slice(start, end)
      .map((l, i) => {
        const ln  = start + i + 1;
        const marker = ln === targetLine ? '>>>' : '   ';
        return `${marker} ${String(ln).padStart(4)}: ${l}`;
      })
      .join('\n');
    return { snippet, total_lines: lines.length, start_line: start + 1, end_line: end };
  } catch {
    return null;
  }
}

function readFullFile(fullPath) {
  try {
    const content = fs.readFileSync(fullPath, 'utf-8');
    return { content, lines: content.split('\n').length };
  } catch {
    return null;
  }
}

// ─── parsing ─────────────────────────────────────────────────────────────────

function parseStackRefs(errorText) {
  // Matches: (C:\path\file.js:42:7) or at file.js:42:7
  const re = /(?:\(|at\s+)([^()\s]+\.(?:js|jsx|ts|tsx|mjs|cjs)):(\d+):\d+/g;
  const found = [];
  let m;
  while ((m = re.exec(errorText)) !== null) {
    const filePath = m[1].replace(/\\/g, '/');
    if (!filePath.includes('node_modules') && !filePath.includes('node:')) {
      found.push({ filePath, lineNum: parseInt(m[2], 10) });
    }
  }
  return found;
}

function extractKeywords(errorText) {
  const kw = new Set();
  let m;

  // Route paths
  const routeRe = /\/api\/[\w/:-]+/g;
  while ((m = routeRe.exec(errorText)) !== null) kw.add(m[0]);

  // Named identifiers in stack frames (at functionName)
  const fnRe = /at\s+([a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)*)/g;
  const skip = new Set(['Object', 'Module', 'Function', 'async', 'process', 'Promise', 'new', 'next']);
  while ((m = fnRe.exec(errorText)) !== null) {
    const name = m[1].split('.').pop();
    if (!skip.has(name) && name.length > 2) kw.add(name);
  }

  // Known class suffixes
  const classRe = /\b([A-Z][a-zA-Z0-9]+(?:Controller|Service|Model|Router|Middleware|Handler|Resolver))\b/g;
  while ((m = classRe.exec(errorText)) !== null) kw.add(m[1]);

  return [...kw].slice(0, 8);
}

// ─── confidence scoring ───────────────────────────────────────────────────────

/**
 * Scores 0-100 based on how much evidence was gathered.
 * Factors:
 *   +30  stack trace pointed to ≥1 file that exists in codebase
 *   +20  that file was read successfully
 *   +15  error line is in a small function (≤ 30 lines context)
 *   +15  keyword matches found in related files
 *   +10  fix_hint was provided
 *   +10  only 1 primary error file (not spread across many)
 */
function scoreConfidence({ stackFilesFound, filesRead, keywordHits, hasFixHint, primaryFileCount }) {
  let score = 0;
  if (stackFilesFound > 0)   score += 30;
  if (filesRead > 0)         score += 20;
  if (keywordHits > 0)       score += 15;
  if (filesRead > 0)         score += 15; // bonus: file was readable
  if (hasFixHint)            score += 10;
  if (primaryFileCount === 1) score += 10;
  return Math.min(score, 100);
}

function confidenceLabel(score) {
  if (score >= 80) return 'HIGH — likely a targeted fix';
  if (score >= 55) return 'MEDIUM — fix probable but verify with tests';
  return 'LOW — error context incomplete, manual investigation needed';
}

// ─── keyword search ───────────────────────────────────────────────────────────

function searchKeyword(kw, files, codebasePath) {
  const hits = [];
  for (const f of files) {
    try {
      const lines = fs.readFileSync(f, 'utf-8').split('\n');
      lines.forEach((line, i) => {
        if (line.toLowerCase().includes(kw.toLowerCase())) {
          hits.push({
            file: path.relative(codebasePath, f).replace(/\\/g, '/'),
            line: i + 1,
            content: line.trim().slice(0, 120),
          });
        }
      });
    } catch { /* skip */ }
  }
  return hits.slice(0, 8);
}

// ─── imports extractor ────────────────────────────────────────────────────────

function parseImports(content, filePath) {
  const dir = path.dirname(filePath);
  const re  = /(?:import|require)\s*(?:.*?\s+from\s+)?['"](\.{1,2}[^'"]+)['"]/g;
  const out = [];
  let m;
  while ((m = re.exec(content)) !== null) {
    const resolved = path.join(dir, m[1]);
    for (const ext of ['', '.js', '.jsx', '.ts', '.tsx']) {
      const candidate = resolved + ext;
      if (fs.existsSync(candidate)) { out.push(candidate); break; }
    }
  }
  return out;
}

// ─── main export ─────────────────────────────────────────────────────────────

export function fixError({ error_text, fix_hint = '', codebase_path = null }) {
  try {
    const codebase = codebase_path ?? config.codebasePath;
    const allFiles = getAllSourceFiles(codebase);

    // 1. Parse stack trace
    const stackRefs = parseStackRefs(error_text);

    // 2. Read stack-referenced files
    const primaryFiles = [];
    for (const { filePath, lineNum } of stackRefs) {
      let full = filePath;
      if (!fs.existsSync(full)) full = path.join(codebase, filePath);
      if (!fs.existsSync(full)) {
        // search by basename
        const base = path.basename(filePath);
        full = allFiles.find(f => f.endsWith(base)) ?? null;
      }
      if (!full || !fs.existsSync(full)) continue;

      const rel     = path.relative(codebase, full).replace(/\\/g, '/');
      const snippet = readSnippet(full, lineNum);
      const file    = readFullFile(full);
      if (!snippet || !file) continue;

      // Read 1 level of imports for deeper context
      const importPaths = parseImports(file.content, full);
      const importContext = importPaths.slice(0, 4).map(imp => {
        const impRel  = path.relative(codebase, imp).replace(/\\/g, '/');
        const impFull = readFullFile(imp);
        return impFull ? { file: impRel, lines: impFull.lines, content: impFull.content.slice(0, 2000) } : null;
      }).filter(Boolean);

      primaryFiles.push({
        file:           rel,
        error_line:     lineNum,
        total_lines:    file.lines,
        snippet,
        import_context: importContext,
      });
    }

    // 3. Extract keywords + search
    const keywords    = extractKeywords(error_text);
    const kwMatches   = {};
    let   totalKwHits = 0;
    for (const kw of keywords) {
      const hits = searchKeyword(kw, allFiles, codebase);
      if (hits.length) { kwMatches[kw] = hits; totalKwHits += hits.length; }
    }

    // 4. Confidence score
    const confidence = scoreConfidence({
      stackFilesFound:  stackRefs.length,
      filesRead:        primaryFiles.length,
      keywordHits:      totalKwHits,
      hasFixHint:       fix_hint.trim().length > 0,
      primaryFileCount: primaryFiles.length,
    });

    // 5. Suggested pipeline steps
    const pipeline = primaryFiles.length > 0
      ? [
          '1. git_backup            — checkpoint before any change',
          `2. show_diff             — preview fix in ${primaryFiles[0].file}`,
          '3. write_file            — apply fix (requires your approval)',
          '4. run_command           — npm test / node script to verify',
        ]
      : [
          '1. search_code           — narrow down the file manually',
          '2. read_file             — read the identified file',
          '3. git_backup + write_file + run_command when ready',
        ];

    return {
      error_summary:       error_text.split('\n')[0].trim(),
      confidence_score:    confidence,
      confidence_label:    confidenceLabel(confidence),
      fix_hint:            fix_hint || null,
      primary_error_files: primaryFiles,
      keywords_found:      keywords,
      keyword_matches:     kwMatches,
      suggested_pipeline:  pipeline,
      total_files_scanned: allFiles.length,
      next_step: primaryFiles.length > 0
        ? `Read ${primaryFiles[0].file}:${primaryFiles[0].error_line} — snippet already included above`
        : 'Run search_code with one of the keywords above to locate the source',
    };
  } catch (err) {
    return {
      error:      err.message,
      suggestion: 'Paste the full error text including the stack trace',
    };
  }
}
