import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

export const listFilesDefinition = {
  name: 'list_files',
  description:
    'List all files and folders inside a directory of the TIQ codebase. Use this to explore the project structure before reading specific files.',
  input_schema: {
    type: 'object',
    properties: {
      directory: {
        type: 'string',
        description:
          'Relative path inside TIQ codebase, e.g. "backend/src/controllers" or "frontend/src". Use empty string "" for root.',
      },
    },
    required: ['directory'],
  },
};

export function listFiles({ directory }) {
  try {
    const targetPath = path.join(config.codebasePath, directory);

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
