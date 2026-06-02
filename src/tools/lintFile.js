import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { config } from '../config.js';

// Walk from startPath up to codebase root looking for node_modules/.bin/eslint
function findEslintBin(startPath) {
  let dir = fs.statSync(startPath).isDirectory() ? startPath : path.dirname(startPath);
  const root = config.codebasePath;
  // Traverse up until we reach or pass the codebase root
  while (dir.length >= root.length) {
    const bin = path.join(dir, 'node_modules', '.bin', 'eslint');
    if (fs.existsSync(bin)) return bin;
    const parent = path.dirname(dir);
    if (parent === dir) break; // filesystem root
    dir = parent;
  }
  return null;
}

export const lintFileDefinition = {
  name: 'lint_file',
  description:
    'Run ESLint on a specific file or directory and return structured results grouped by severity (error / warning). Use before refactoring or after writing a fix to catch lint issues. Requires ESLint to be installed in the target project.',
  input_schema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Relative path to lint, e.g. "src/controllers/auth.js" or "backend/src".',
      },
    },
    required: ['file_path'],
  },
};

export function lintFile({ file_path = '' } = {}) {
  // Empty string → lint codebase root
  const fullPath = path.join(config.codebasePath, file_path);
  if (!fs.existsSync(fullPath)) {
    return {
      error: `Path not found: ${file_path}`,
      suggestion: 'Use list_files to verify the path exists',
    };
  }

  // Walk up from the target path to find the nearest package.json with an eslint binary.
  // This works for any structure: monorepo, flat, nested services.
  const eslintBin = findEslintBin(fullPath);
  const projectRoot = eslintBin ? path.dirname(path.dirname(path.dirname(eslintBin))) : config.codebasePath;

  if (!eslintBin) {
    return {
      error: 'ESLint binary not found',
      searched: fullPath,
      suggestion: 'Run npm install in the project root or relevant service directory first',
    };
  }

  try {
    const cmd = `"${eslintBin}" --format json "${fullPath}"`;
    const raw = execSync(cmd, { encoding: 'utf-8', cwd: projectRoot, maxBuffer: 2 * 1024 * 1024 });
    const results = JSON.parse(raw);
    return formatResults(results, file_path);
  } catch (err) {
    // ESLint exits with code 1 when there are lint errors — stderr contains the JSON.
    const output = err.stdout || err.output?.filter(Boolean).join('') || '';
    try {
      const results = JSON.parse(output);
      return formatResults(results, file_path);
    } catch {
      return { error: err.message, suggestion: 'Check that the file is valid JS/TS and ESLint config exists' };
    }
  }
}

function formatResults(results, originalPath) {
  let errors = 0, warnings = 0;
  const files = [];

  for (const r of results) {
    if (!r.messages.length) continue;
    const rel = r.filePath.replace(config.codebasePath.replace(/\\/g, '/'), '').replace(/^\//, '');
    const issues = r.messages.map(m => ({
      line: m.line,
      col: m.column,
      severity: m.severity === 2 ? 'error' : 'warning',
      rule: m.ruleId ?? 'no-rule',
      message: m.message,
    }));
    errors   += r.errorCount;
    warnings += r.warningCount;
    files.push({ file: rel, error_count: r.errorCount, warning_count: r.warningCount, issues });
  }

  return {
    path: originalPath,
    total_errors: errors,
    total_warnings: warnings,
    files_checked: results.length,
    clean: errors === 0 && warnings === 0,
    files,
    lintedAt: new Date().toISOString(),
  };
}
