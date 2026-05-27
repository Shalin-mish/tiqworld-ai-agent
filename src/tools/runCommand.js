import { execSync } from 'child_process';
import path from 'path';
import { config } from '../config.js';

const ALLOWED_PATTERNS = [
  // Generic test runners
  /^npm test$/,
  /^npm run test$/,
  /^npm run test:.+$/,
  /^npx vitest run.*$/,
  /^npx jest.*$/,
  // TIQ-specific: prefix-scoped commands (no test script in TIQ — use build/start check)
  /^npm --prefix (backend|frontend) run (dev|build|start|lint)$/,
  /^npm --prefix (backend|frontend) list --depth=0$/,
  // Lint
  /^npx eslint .+$/,
  /^npm run lint.*$/,
  // Git read-only
  /^git status$/,
  /^git log --oneline(-\d+)?$/,
  /^git diff$/,
  /^git diff --stat$/,
  // Version / info
  /^node --version$/,
  /^npm --version$/,
  /^npm list --depth=0$/,
];

function isAllowed(command) {
  return ALLOWED_PATTERNS.some((pattern) => pattern.test(command.trim()));
}

export const runCommandDefinition = {
  name: 'run_command',
  description:
    'Run a safe, whitelisted shell command in the TIQ codebase directory. ' +
    'TIQ has no top-level npm test — use "npm --prefix backend run build" or "npx eslint backend/src" to verify changes. ' +
    'For test suites use "npx vitest run" (agent repo) or "npx jest" (if configured).',
  input_schema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description:
          'Command to run. Examples: "npm --prefix backend run build", "npx eslint backend/src", ' +
          '"git status", "node --version", "npm --prefix backend list --depth=0"',
      },
      directory: {
        type: 'string',
        description:
          'Subdirectory of the codebase to run the command in, e.g. "backend" or "frontend". Omit for codebase root.',
      },
    },
    required: ['command'],
  },
};

export async function runCommand({ command, directory = '', _commandApprovalFn = null }) {
  if (!isAllowed(command)) {
    return {
      error: `Command not allowed: "${command}"`,
      allowed_commands: [
        'npm --prefix backend run build',
        'npm --prefix frontend run build',
        'npx eslint backend/src',
        'npm run lint',
        'git status',
        'git diff',
        'node --version',
        'npm list --depth=0',
      ],
      suggestion: 'Only whitelisted commands can run for safety. TIQ has no top-level npm test — use build or lint to verify.',
    };
  }

  if (_commandApprovalFn) {
    const answer = await _commandApprovalFn(command, directory);
    if (answer !== 'yes' && answer !== 'y') {
      return { status: 'rejected', command, message: 'User rejected the command. Nothing was run.' };
    }
  }

  try {
    const cwd = directory
      ? path.join(config.codebasePath, directory)
      : config.codebasePath;

    const output = execSync(command, {
      cwd,
      timeout: 60000,
      encoding: 'utf-8',
      stdio: 'pipe',
    });

    return {
      command,
      directory: directory || '(root)',
      exit_code: 0,
      output: output.trim(),
      ranAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      command,
      directory: directory || '(root)',
      exit_code: err.status || 1,
      output: err.stdout ? err.stdout.trim() : '',
      error: err.stderr ? err.stderr.trim() : err.message,
      suggestion: 'Check the error output above for details',
    };
  }
}
