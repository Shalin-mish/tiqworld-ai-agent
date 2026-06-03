import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

export const listFilesDefinition = {
  name: 'list_files',
  description:
    'List all files and folders inside a directory of the target codebase. Use this to explore the project structure before reading specific files.',
  input_schema: {
    type: 'object',
    properties: {
      directory: {
        type: 'string',
        description:
          'Relative path inside the codebase, e.g. "src/controllers" or "backend". Use empty string "" for root.',
      },
    },
    required: ['directory'],
  },
};

function isWithinCodebase(fullPath) {
  const base = path.resolve(config.codebasePath);
  const resolved = path.resolve(fullPath);
  return resolved.startsWith(base + path.sep) || resolved === base;
}

export function listFiles({ directory }) {
  try {
    const targetPath = path.join(config.codebasePath, directory);

    if (!isWithinCodebase(targetPath)) {
      return {
        error: `Access denied: path "${directory}" is outside the codebase boundary`,
        suggestion: 'Use list_files with directory="" to see the root structure first',
      };
    }

    if (!fs.existsSync(targetPath)) {
      return {
        error: `Directory not found: ${directory}`,
        suggestion: 'Use list_files with directory="" to see the root structure first',
      };
    }

    const entries = fs.readdirSync(targetPath, { withFileTypes: true });

    const result = entries.map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? 'folder' : 'file',
      path: path.join(directory, entry.name).replace(/\\/g, '/'),
    }));

    return {
      directory,
      total: result.length,
      scannedAt: new Date().toISOString(),
      entries: result,
    };
  } catch (err) {
    return {
      error: err.message,
      suggestion: 'Check if the directory path is correct',
    };
  }
}
