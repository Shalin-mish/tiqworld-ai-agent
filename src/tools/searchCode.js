import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

export const searchCodeDefinition = {
  name: 'search_code',
  description:
    'Search for a keyword or pattern across all files in the TIQ codebase. Returns file paths and matching lines. Use this to find where something is defined or used.',
  input_schema: {
    type: 'object',
    properties: {
      keyword: {
        type: 'string',
        description: 'The word, function name, or pattern to search for',
      },
      directory: {
        type: 'string',
        description:
          'Limit search to this directory, e.g. "backend/src". Use "" to search entire codebase.',
      },
    },
    required: ['keyword'],
  },
};

// Recursively collect all files
function getAllFiles(dirPath, fileList = []) {
  if (!fs.existsSync(dirPath)) return fileList;

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    // Skip node_modules and hidden folders
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
        getAllFiles(fullPath, fileList);
      }
    } else {
      // Only search code files
      const ext = path.extname(entry.name);
      if (['.js', '.jsx', '.ts', '.tsx', '.json', '.md'].includes(ext)) {
        fileList.push(fullPath);
      }
    }
  }
  return fileList;
}

export function searchCode({ keyword, directory = '' }) {
  try {
    const searchPath = path.join(config.codebasePath, directory);
    const allFiles = getAllFiles(searchPath);
    const matches = [];

    for (const filePath of allFiles) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      lines.forEach((line, index) => {
        if (line.toLowerCase().includes(keyword.toLowerCase())) {
          // Get relative path for cleaner output
          const relativePath = path
            .relative(config.codebasePath, filePath)
            .replace(/\\/g, '/');

          matches.push({
            file: relativePath,
            line: index + 1,
            content: line.trim(),
          });
        }
      });
    }

    return {
      keyword,
      total_matches: matches.length,
      matches: matches.slice(0, 50), // limit to 50 results
    };
  } catch (err) {
    return { error: err.message };
  }
}
