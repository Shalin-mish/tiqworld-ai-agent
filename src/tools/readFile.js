import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

export const readFileDefinition = {
  name: 'read_file',
  description:
    'Read the full content of a specific file in the TIQ codebase. Automatically parses and reads local imports (1 level deep) so you have full context without extra tool calls.',
  input_schema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description:
          'Relative path to the file inside TIQ codebase, e.g. "backend/src/controllers/auth.controller.js"',
      },
      include_imports: {
        type: 'boolean',
        description:
          'Auto-read locally imported files (1 level deep). Default: true. Set false if you only need this file.',
      },
    },
    required: ['file_path'],
  },
};

function parseLocalImports(content, filePath) {
  const dir = path.dirname(filePath);
  const importRegex = /(?:import|require)\s*(?:.*?\s+from\s+)?['"](\.[^'"]+)['"]/g;
  const imports = [];
  let match;

  while ((match = importRegex.exec(content)) !== null) {
    const importPath = match[1];
    const resolved = path.join(dir, importPath);
    const extensions = ['', '.js', '.jsx', '.ts', '.tsx'];

    for (const ext of extensions) {
      const candidate = (resolved + ext).replace(/\\/g, '/');
      if (fs.existsSync(path.join(config.codebasePath, candidate))) {
        imports.push(candidate);
        break;
      }
    }
  }

  return imports;
}

function readSingleFile(file_path) {
  const fullPath = path.join(config.codebasePath, file_path);

  if (!fs.existsSync(fullPath)) {
    return {
      error: `File not found: ${file_path}`,
      path: file_path,
      suggestion: 'Use list_files to explore the directory structure first',
    };
  }

  const stats = fs.statSync(fullPath);

  if (stats.size > 100 * 1024) {
    return {
      error: `File too large (${Math.round(stats.size / 1024)}KB). Cannot read in full.`,
      path: file_path,
      suggestion: 'Use search_code to find specific sections instead',
    };
  }

  const content = fs.readFileSync(fullPath, 'utf-8');

  return {
    file_path,
    total_lines: content.split('\n').length,
    size_bytes: stats.size,
    content,
  };
}

export function readFile({ file_path, include_imports = true }) {
  try {
    const primary = readSingleFile(file_path);
    if (primary.error) return primary;

    const result = {
      ...primary,
      readAt: new Date().toISOString(),
    };

    if (include_imports) {
      const importPaths = parseLocalImports(primary.content, file_path);
      if (importPaths.length > 0) {
        result.imported_files = importPaths.map((imp) => {
          const imported = readSingleFile(imp);
          return imported.error ? { file_path: imp, error: imported.error } : imported;
        });
      }
    }

    return result;
  } catch (err) {
    return {
      error: err.message,
      path: file_path,
      suggestion: 'Check if the path is correct and the file exists',
    };
  }
}
