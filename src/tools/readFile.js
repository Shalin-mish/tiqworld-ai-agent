import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

export const readFileDefinition = {
  name: 'read_file',
  description:
    'Read the full content of a specific file in the TIQ codebase. Use this to understand code logic, find bugs, or review implementations.',
  input_schema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description:
          'Relative path to the file inside TIQ codebase, e.g. "backend/src/controllers/auth.controller.js"',
      },
    },
    required: ['file_path'],
  },
};

export function readFile({ file_path }) {
  try {
    const fullPath = path.join(config.codebasePath, file_path);

    if (!fs.existsSync(fullPath)) {
      return { error: `File not found: ${file_path}` };
    }

    const stats = fs.statSync(fullPath);

    // Skip very large files (>100KB) to stay within context limits
    if (stats.size > 100 * 1024) {
      return {
        error: `File too large (${Math.round(stats.size / 1024)}KB). Use search_code to find specific sections instead.`,
      };
    }

    const content = fs.readFileSync(fullPath, 'utf-8');
    const lines = content.split('\n');

    return {
      file_path,
      total_lines: lines.length,
      content,
    };
  } catch (err) {
    return { error: err.message };
  }
}
