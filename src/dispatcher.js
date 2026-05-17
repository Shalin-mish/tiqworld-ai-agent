import { listFilesDefinition, listFiles } from './tools/listFiles.js';
import { readFileDefinition, readFile } from './tools/readFile.js';
import { searchCodeDefinition, searchCode } from './tools/searchCode.js';
import { writeFileDefinition, writeFile } from './tools/writeFile.js';
import { runCommandDefinition, runCommand } from './tools/runCommand.js';
import { showDiffDefinition, showDiff } from './tools/showDiff.js';
import { gitBackupDefinition, gitBackup } from './tools/gitBackup.js';

// Classification keyword patterns — evaluated in order, first match wins.
const PATTERNS = [
  {
    type: 'review',
    pattern: /\b(review|audit|check quality|inspect|analyze|code smell|security check)\b/i,
  },
  {
    type: 'maintenance',
    pattern: /\b(fix|bug|revert|update dependency|refactor|clean up|rename|remove|delete|patch|migrate|deprecat)\b/i,
  },
  {
    type: 'feature',
    pattern: /\b(add|create|build|implement|new route|new component|new endpoint|new page|new feature|scaffold)\b/i,
  },
  {
    type: 'query',
    pattern: /\b(why|explain|what does|how does|describe|what is|where is|show me|walk me|tell me)\b/i,
  },
];

export function classify(input) {
  for (const { type, pattern } of PATTERNS) {
    if (pattern.test(input)) return type;
  }
  return 'query'; // safe read-only default for anything unrecognised
}

// Tool sets per task type — enforces write access only where needed.
const TOOL_SETS = {
  query: {
    definitions: [listFilesDefinition, readFileDefinition, searchCodeDefinition],
    executors: {
      list_files: listFiles,
      read_file: readFile,
      search_code: searchCode,
    },
  },
  review: {
    definitions: [listFilesDefinition, readFileDefinition, searchCodeDefinition, showDiffDefinition],
    executors: {
      list_files: listFiles,
      read_file: readFile,
      search_code: searchCode,
      show_diff: showDiff,
    },
  },
  maintenance: {
    definitions: [
      listFilesDefinition,
      readFileDefinition,
      searchCodeDefinition,
      showDiffDefinition,
      gitBackupDefinition,
      writeFileDefinition,
      runCommandDefinition,
    ],
    executors: {
      list_files: listFiles,
      read_file: readFile,
      search_code: searchCode,
      show_diff: showDiff,
      git_backup: gitBackup,
      write_file: writeFile,
      run_command: runCommand,
    },
  },
  feature: {
    definitions: [
      listFilesDefinition,
      readFileDefinition,
      searchCodeDefinition,
      showDiffDefinition,
      gitBackupDefinition,
      writeFileDefinition,
      runCommandDefinition,
    ],
    executors: {
      list_files: listFiles,
      read_file: readFile,
      search_code: searchCode,
      show_diff: showDiff,
      git_backup: gitBackup,
      write_file: writeFile,
      run_command: runCommand,
    },
  },
};

export function getTools(taskType) {
  return TOOL_SETS[taskType] ?? TOOL_SETS.query;
}

export const TASK_LABELS = {
  query: 'Query',
  maintenance: 'Maintenance',
  feature: 'Feature',
  review: 'Review',
};
