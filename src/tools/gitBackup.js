import { execSync } from 'child_process';
import { config } from '../config.js';

export const gitBackupDefinition = {
  name: 'git_backup',
  description:
    'Create a named git backup branch before making any file changes. Always call this before write_file on an existing file so the change is reversible. Returns the backup branch name.',
  input_schema: {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        description:
          'Short description of what is about to change, e.g. "fix-auth-middleware" or "update-task-schema". Used in the branch name.',
      },
    },
    required: ['reason'],
  },
};

export function gitBackup({ reason }) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const slug = reason
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30);
  const branchName = `backup/maint-${timestamp}-${slug}`;

  try {
    execSync(`git checkout -b "${branchName}"`, {
      cwd: config.codebasePath,
      stdio: 'pipe',
    });
    execSync(`git checkout -`, {
      cwd: config.codebasePath,
      stdio: 'pipe',
    });

    return {
      status: 'success',
      branch: branchName,
      message: `Backup branch created: ${branchName}`,
      restore_command: `git checkout ${branchName}`,
    };
  } catch (err) {
    return {
      status: 'error',
      error: err.stderr ? err.stderr.toString().trim() : err.message,
      suggestion: 'Ensure TIQ_CODEBASE_PATH is a git repository. Run git init if needed.',
    };
  }
}
