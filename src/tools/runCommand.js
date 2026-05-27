import { execSync } from 'child_process';
import path from 'path';
import { config } from '../config.js';

// tiq_workplace services — each is run via npm --prefix backend/<service>
const TIQ_SERVICES = [
  'auth-service', 'training-service', 'assessment-service',
  'inference-service', 'notification-service', 'job-posting-service',
  'payment-service', 'shared',
].join('|');

const ALLOWED_PATTERNS = [
  // tiq_workplace microservice commands
  new RegExp(`^npm --prefix backend/(${TIQ_SERVICES}) (test|run (build|test|lint|type-check|typecheck))$`),
  new RegExp(`^npm --prefix backend/(${TIQ_SERVICES}) list --depth=0$`),
  // Frontend apps
  /^npm --prefix (consumer-app|admin-app) (test|run (build|test|lint|type-check))$/,
  /^npm --prefix (consumer-app|admin-app) list --depth=0$/,
  // Generic test runners (agent repo + fallback)
  /^npm test$/,
  /^npm run test$/,
  /^npm run test:.+$/,
  /^npx vitest run.*$/,
  /^npx jest.*$/,
  // TypeScript type check
  /^npx tsc --noEmit.*$/,
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
    'tiq_workplace is a microservices repo — each service has its own test/build. ' +
    'Use "npm --prefix backend/<service> test" to run tests, ' +
    '"npm --prefix backend/<service> run build" to verify TypeScript compiles. ' +
    'Services: auth-service, training-service, assessment-service, inference-service, ' +
    'notification-service, job-posting-service, payment-service. ' +
    'Frontend: consumer-app, admin-app.',
  input_schema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description:
          'Command to run. Examples: ' +
          '"npm --prefix backend/auth-service test", ' +
          '"npm --prefix backend/training-service run build", ' +
          '"npm --prefix consumer-app test", ' +
          '"npx eslint backend/auth-service/src", ' +
          '"git status"',
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
        'npm --prefix backend/auth-service test',
        'npm --prefix backend/training-service run build',
        'npm --prefix backend/auth-service run lint',
        'npm --prefix consumer-app test',
        'npx tsc --noEmit',
        'npx eslint backend/auth-service/src',
        'git status',
        'git diff',
        'node --version',
      ],
      suggestion: 'tiq_workplace is microservices — use "npm --prefix backend/<service-name> test" to run tests per service.',
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
