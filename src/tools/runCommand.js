import { execSync } from 'child_process';
import path from 'path';
import { config } from '../config.js';

const ALLOWED_PATTERNS = [
  /^npm test$/,
  /^npm run test$/,
  /^npm run test:.+$/,
  /^git status$/,
  /^git log --oneline(-\d+)?$/,
  /^git diff$/,
  /^git diff --stat$/,
  /^git push origin .+$/,
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
    'Run a safe, whitelisted shell command in the TIQ codebase directory. Use to verify a fix works (npm test), check git state, or inspect installed packages.',
  input_schema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description:
          'Command to run. Allowed: npm test, npm run test, git status, git log --oneline, git diff, node --version, npm --version, npm list --depth=0',
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

export function runCommand({ command, directory = '' }) {
  if (!isAllowed(command)) {
    return {
      error: `Command not allowed: "${command}"`,
      allowed_commands: [
        'npm test',
        'npm run test',
        'git status',
        'git log --oneline',
        'git diff',
        'git push origin <branch>',
        'node --version',
        'npm --version',
        'npm list --depth=0',
      ],
      suggestion: 'Only whitelisted commands can run for safety reasons',
    };
  }

  try {
    const cwd = directory
      ? path.join(config.codebasePath, directory)
      : config.codebasePath;

    const output = execSync(command, {
      cwd,
      timeout: 30000,
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
