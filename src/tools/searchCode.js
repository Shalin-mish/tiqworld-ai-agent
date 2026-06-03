import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

export const searchCodeDefinition = {
  name: 'search_code',
  description:
    'Search for a keyword or regex pattern across all files in the target codebase. ' +
    'Returns file paths and matching lines with line numbers. ' +
    'Supports regex (e.g. "^export function", "require\\(.+\\)"). ' +
    'Use directory to narrow scope. Searches .env, .yaml, .sh files too.',
  input_schema: {
    type: 'object',
    properties: {
      keyword: {
        type: 'string',
        description: 'The word, function name, or regex pattern to search for.',
      },
      directory: {
        type: 'string',
        description: 'Limit search to this subdirectory, e.g. "src" or "backend/auth-service". Leave empty for entire codebase.',
      },
      is_regex: {
        type: 'boolean',
        description: 'Set true to treat keyword as a regex pattern. Default: false (plain text search).',
      },
      max_results: {
        type: 'number',
        description: 'Max matches to return. Default 100, max 300.',
      },
    },
    required: ['keyword'],
  },
};

const EXCLUDED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.vite', 'coverage', 'logs']);
const CODE_EXTS     = new Set(['.js', '.jsx', '.ts', '.tsx', '.json', '.md', '.yaml', '.yml', '.sh']);

function getAllFiles(dirPath, fileList = []) {
  if (!fs.existsSync(dirPath)) return fileList;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
        getAllFiles(full, fileList);
      }
    } else if (CODE_EXTS.has(path.extname(entry.name)) || entry.name.startsWith('.env')) {
      fileList.push(full);
    }
  }
  return fileList;
}

export function searchCode({ keyword, directory = '', is_regex = false, max_results = 100 }) {
  const cap = Math.min(max_results, 300);

  let pattern;
  try {
    pattern = is_regex ? new RegExp(keyword, 'i') : null;
  } catch (e) {
    return { error: `Invalid regex: ${e.message}`, suggestion: 'Set is_regex=false to use plain text search.' };
  }

  try {
    const searchPath = path.join(config.codebasePath, directory);
    const base = path.resolve(config.codebasePath);
    const resolvedSearch = path.resolve(searchPath);
    if (!resolvedSearch.startsWith(base + path.sep) && resolvedSearch !== base) {
      return {
        error: `Access denied: path "${directory}" is outside the codebase boundary`,
        suggestion: 'Leave directory empty to search the full codebase',
      };
    }
    if (!fs.existsSync(searchPath)) {
      return {
        error:      `Directory not found: ${directory || '(root)'}`,
        suggestion: 'Use list_files with directory="" to find valid paths',
      };
    }

    const allFiles = getAllFiles(searchPath);
    const matches  = [];

    for (const filePath of allFiles) {
      if (matches.length >= cap) break;
      let content;
      try { content = fs.readFileSync(filePath, 'utf-8'); } catch { continue; }

      const lines = content.split('\n');
      for (let i = 0; i < lines.length && matches.length < cap; i++) {
        const line = lines[i];
        const hit  = pattern ? pattern.test(line) : line.toLowerCase().includes(keyword.toLowerCase());
        if (hit) {
          matches.push({
            file:    path.relative(config.codebasePath, filePath).replace(/\\/g, '/'),
            line:    i + 1,
            content: line.trim().slice(0, 200),
          });
        }
      }
    }

    return {
      keyword,
      is_regex,
      searched_files: allFiles.length,
      total_matches:  matches.length,
      capped_at:      matches.length >= cap ? cap : null,
      searchedAt:     new Date().toISOString(),
      matches,
    };
  } catch (err) {
    return {
      error:      err.message,
      suggestion: 'Check if the keyword is valid and the directory exists',
    };
  }
}
