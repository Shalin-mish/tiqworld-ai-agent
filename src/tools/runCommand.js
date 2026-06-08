import { execSync } from 'child_process';
import path from 'path';
import { config } from '../config.js';

// Generic safe-command allowlist — works for any codebase structure.
// "npm --prefix <any-path> <safe-cmd>" covers all monorepo layouts.
const ALLOWED_PATTERNS = [
  // Generic monorepo: npm --prefix <any-relative-path> <safe-verb>
  /^npm --prefix [\w./-]+ (test|run (build|test|lint|type-check|typecheck))$/,
  /^npm --prefix [\w./-]+ list --depth=0$/,
  // Root-level npm commands
  /^npm test$/,
  /^npm run test$/,
  /^npm run test:.+$/,
  /^npm run build$/,
  /^npm run lint.*$/,
  /^npm install$/,
  // JS test runners
  /^npx vitest run.*$/,
  /^npx jest.*$/,
  // Python test runners
  /^pytest.*$/,
  /^python -m pytest.*$/,
  // Go
  /^go test \.\/\.\.\.$/,
  /^go build \.\/\.\.\.$/,
  // Rust
  /^cargo test$/,
  /^cargo build$/,
  // Java / Gradle / Maven
  /^\.\/gradlew test$/,
  /^\.\/gradlew build$/,
  /^mvn test$/,
  /^mvn package.*$/,
  // Ruby
  /^bundle exec rspec.*$/,
  // TypeScript type check
  /^npx tsc --noEmit.*$/,
  // Lint
  /^npx eslint .+$/,
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

export function isAllowed(command) {
  return ALLOWED_PATTERNS.some((pattern) => pattern.test(command.trim()));
}

export const runCommandDefinition = {
  name: 'run_command',
  description:
    'Run a safe, whitelisted shell command in the target codebase directory. ' +
    'Works for any language or structure: npm, pytest, go test, cargo test, mvn, gradlew, rspec. ' +
    'For monorepos use "npm --prefix <service-path> test". ' +
    'All commands are read-only or verify-only — no deploys, no publishes.',
  input_schema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description:
          'Command to run. Examples: "npm test", "npm --prefix backend/auth-service test", ' +
          '"npx eslint src/", "pytest", "go test ./...", "cargo test", "./gradlew test", "git status"',
      },
      directory: {
        type: 'string',
        description:
          'Subdirectory of the codebase to run the command in, e.g. "backend" or "packages/api". Omit for codebase root.',
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
        'npm test',
        'npm run build',
        'npm run lint',
        'npm --prefix <service-path> test',
        'npx eslint <path>',
        'npx tsc --noEmit',
        'pytest',
        'go test ./...',
        'cargo test',
        './gradlew test',
        'git status',
        'git diff',
      ],
      suggestion: 'Use one of the allowed patterns above. For monorepo services: "npm --prefix <relative-path> test".',
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
      timeout: 300000,
      encoding: 'utf-8',
      stdio: 'pipe',
    });

    return {
      command,
      directory: directory || '(root)',
      exit_code: 0,
      stdout:    output.trim(),
      output:    output.trim(),
      ranAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      command,
      directory: directory || '(root)',
      exit_code: err.status || 1,
      stdout:    err.stdout ? err.stdout.trim() : '',
      output:    err.stdout ? err.stdout.trim() : '',
      error:     err.stderr ? err.stderr.trim() : err.message,
      suggestion: 'Check the error output above for details',
    };
  }
}
