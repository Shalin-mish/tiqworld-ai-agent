import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

export const traceErrorDefinition = {
  name: 'trace_error',
  description:
    'Given a Node.js/Express error message or stack trace, finds all relevant files involved and returns their content for debugging. Extracts file paths and function names from the stack trace, then reads those files automatically.',
  input_schema: {
    type: 'object',
    properties: {
      error_text: {
        type: 'string',
        description: 'The full error message and/or stack trace to trace. Paste the complete output from the terminal.',
      },
      extra_keywords: {
        type: 'string',
        description: 'Optional: extra keywords to search for (e.g. function name, variable, route path). Comma-separated.',
      },
    },
    required: ['error_text'],
  },
};

const EXCLUDE_DIRS = ['node_modules', '.git', 'dist', 'build', '.vite'];
const CODE_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'];

function getAllSourceFiles(dirPath, fileList = []) {
  if (!fs.existsSync(dirPath)) return fileList;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDE_DIRS.includes(entry.name) && !entry.name.startsWith('.')) {
        getAllSourceFiles(fullPath, fileList);
      }
    } else if (CODE_EXTENSIONS.includes(path.extname(entry.name))) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

// Extract file paths from stack trace lines like "at Object.<anonymous> (C:\...\file.js:42:7)"
function extractStackPaths(errorText) {
  const stackLineRegex = /\((.+?):(\d+):\d+\)|at\s+(.+?):(\d+):\d+/g;
  const found = [];
  let match;

  while ((match = stackLineRegex.exec(errorText)) !== null) {
    const filePath = match[1] || match[3];
    const lineNum = parseInt(match[2] || match[4], 10);
    if (filePath && !filePath.includes('node_modules') && !filePath.includes('node:')) {
      found.push({ filePath: filePath.replace(/\\/g, '/'), lineNum });
    }
  }
  return found;
}

// Extract identifiers from error: function names, class names, route paths
function extractKeywords(errorText) {
  const keywords = new Set();

  // Route paths like /api/auth/login
  const routeRegex = /\/api\/[\w/:-]+/g;
  let m;
  while ((m = routeRegex.exec(errorText)) !== null) keywords.add(m[0]);

  // Capitalized identifiers (class names, controller names)
  const identRegex = /\b([A-Z][a-zA-Z0-9]+(?:Controller|Service|Model|Router|Middleware|Handler))\b/g;
  while ((m = identRegex.exec(errorText)) !== null) keywords.add(m[1]);

  // camelCase function names from "at functionName "
  const fnRegex = /at\s+([a-zA-Z_$][\w$]*)\s/g;
  while ((m = fnRegex.exec(errorText)) !== null) {
    if (!['Object', 'Module', 'Function', 'async', 'process', 'new'].includes(m[1])) {
      keywords.add(m[1]);
    }
  }

  return [...keywords];
}

function readFileSnippet(fullPath, targetLine, contextLines = 8) {
  try {
    const content = fs.readFileSync(fullPath, 'utf-8');
    const lines = content.split('\n');
    const start = Math.max(0, targetLine - contextLines - 1);
    const end = Math.min(lines.length, targetLine + contextLines);
    return {
      snippet: lines.slice(start, end).map((l, i) => `${start + i + 1}: ${l}`).join('\n'),
      total_lines: lines.length,
    };
  } catch {
    return null;
  }
}

function searchKeywordInFiles(keyword, files, codebasePath) {
  const matches = [];
  for (const filePath of files) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        if (line.toLowerCase().includes(keyword.toLowerCase())) {
          matches.push({
            file: path.relative(codebasePath, filePath).replace(/\\/g, '/'),
            line: idx + 1,
            content: line.trim(),
          });
        }
      });
    } catch { /* skip unreadable files */ }
  }
  return matches;
}

export function traceError({ error_text, extra_keywords = '' }) {
  try {
    const codebasePath = config.codebasePath;
    const allFiles = getAllSourceFiles(codebasePath);

    // 1. Parse stack trace for direct file references
    const stackRefs = extractStackPaths(error_text);

    // 2. Read stack-referenced files with context around the error line
    const stackFileResults = stackRefs.map(({ filePath, lineNum }) => {
      // Try exact path first, then as relative to codebase
      let fullPath = filePath;
      if (!fs.existsSync(fullPath)) {
        fullPath = path.join(codebasePath, filePath);
      }
      if (!fs.existsSync(fullPath)) return null;

      const relativePath = path.relative(codebasePath, fullPath).replace(/\\/g, '/');
      const snippet = readFileSnippet(fullPath, lineNum);
      if (!snippet) return null;

      return { file: relativePath, error_line: lineNum, ...snippet };
    }).filter(Boolean);

    // 3. Extract keywords and search across codebase
    const autoKeywords = extractKeywords(error_text);
    const manualKeywords = extra_keywords
      ? extra_keywords.split(',').map((k) => k.trim()).filter(Boolean)
      : [];
    const allKeywords = [...new Set([...autoKeywords, ...manualKeywords])].slice(0, 6);

    const keywordResults = {};
    for (const kw of allKeywords) {
      const hits = searchKeywordInFiles(kw, allFiles, codebasePath);
      if (hits.length > 0) {
        keywordResults[kw] = hits.slice(0, 10);
      }
    }

    // 4. Extract error type and message from first line
    const firstLine = error_text.split('\n')[0].trim();

    return {
      error_summary: firstLine,
      stack_files_found: stackFileResults.length,
      stack_trace_files: stackFileResults,
      keywords_extracted: allKeywords,
      keyword_matches: keywordResults,
      total_files_searched: allFiles.length,
      tip: 'Check stack_trace_files for the exact error location, and keyword_matches for related code',
    };
  } catch (err) {
    return {
      error: err.message,
      suggestion: 'Paste the full error text including the stack trace lines',
    };
  }
}
