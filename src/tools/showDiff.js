import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

export const showDiffDefinition = {
  name: 'show_diff',
  description:
    'Show a diff between the current file content and proposed new content, without writing anything. Use this to review a change before deciding to apply it.',
  input_schema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Relative path to the file inside the codebase',
      },
      proposed_content: {
        type: 'string',
        description: 'The new content you want to compare against the current file',
      },
    },
    required: ['file_path', 'proposed_content'],
  },
};

export function showDiff({ file_path, proposed_content }) {
  try {
    const fullPath = path.join(config.codebasePath, file_path);

    if (!fs.existsSync(fullPath)) {
      return {
        error: `File not found: ${file_path}`,
        path: file_path,
        suggestion: 'Check the path with list_files',
      };
    }

    const oldContent = fs.readFileSync(fullPath, 'utf-8');
    const oldLines = oldContent.split('\n');
    const newLines = proposed_content.split('\n');
    const maxLen = Math.max(oldLines.length, newLines.length);
    const diff = [];

    for (let i = 0; i < maxLen; i++) {
      const oldLine = oldLines[i];
      const newLine = newLines[i];
      if (oldLine === undefined)      diff.push(`+ ${newLine}`);
      else if (newLine === undefined) diff.push(`- ${oldLine}`);
      else if (oldLine !== newLine) {
        diff.push(`- ${oldLine}`);
        diff.push(`+ ${newLine}`);
      }
    }

    if (diff.length === 0) {
      return {
        file_path,
        status: 'no_changes',
        message: 'Proposed content is identical to current file.',
      };
    }

    return {
      file_path,
      total_changes: diff.filter((l) => l.startsWith('+') || l.startsWith('-')).length,
      diff: diff.join('\n'),
    };
  } catch (err) {
    return {
      error: err.message,
      path: file_path,
      suggestion: 'Check if the file path is correct and readable',
    };
  }
}
