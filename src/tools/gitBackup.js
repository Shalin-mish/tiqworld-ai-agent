import fs   from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { config } from '../config.js';

// Persist backup branch name to disk so restore() survives server restarts.
const BACKUP_STATE_FILE = path.join(process.cwd(), 'logs', '.last-backup-branch');

function loadBackupBranch() {
  try { return fs.readFileSync(BACKUP_STATE_FILE, 'utf-8').trim() || null; } catch { return null; }
}
function saveBackupBranch(name) {
  try {
    fs.mkdirSync(path.dirname(BACKUP_STATE_FILE), { recursive: true });
    fs.writeFileSync(BACKUP_STATE_FILE, name, 'utf-8');
  } catch { /* best-effort */ }
}

let _lastBackupBranch = loadBackupBranch();

export const gitBackupDefinition = {
  name: 'git_backup',
  description:
    'Create a named git backup branch before any file change (action=backup, default), OR restore the ' +
    'working tree to the last backup (action=restore). Always call backup before write_file. ' +
    'Call restore immediately if tests fail after a write.',
  input_schema: {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        description: 'Required for action=backup. Short label used in branch name, e.g. "fix-auth-middleware".',
      },
      action: {
        type: 'string',
        enum: ['backup', 'restore'],
        description: '"backup" (default) creates a checkpoint branch. "restore" resets to the last checkpoint.',
      },
    },
  },
};

export function gitBackup({ reason = 'manual', action = 'backup' } = {}) {
  const cwd = config.codebasePath;

  // ── RESTORE ──────────────────────────────────────────────────────────────
  if (action === 'restore') {
    if (!_lastBackupBranch) {
      return {
        status:     'error',
        error:      'No backup branch recorded in this session — nothing to restore.',
        suggestion: 'Call git_backup with action=backup before making any writes.',
      };
    }
    try {
      execSync(`git checkout "${_lastBackupBranch}" -- .`, { cwd, stdio: 'pipe', timeout: 30000 });
      return {
        status:  'restored',
        branch:  _lastBackupBranch,
        message: `Working tree restored from backup branch: ${_lastBackupBranch}`,
      };
    } catch (err) {
      return {
        status:     'error',
        error:      err.stderr ? err.stderr.toString().trim() : err.message,
        suggestion: `Run manually: git checkout "${_lastBackupBranch}" -- .  inside ${cwd}`,
      };
    }
  }

  // ── BACKUP ───────────────────────────────────────────────────────────────
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const slug = String(reason)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30);
  const branchName = `backup/maint-${timestamp}-${slug}`;

  try {
    execSync(`git checkout -b "${branchName}"`, { cwd, stdio: 'pipe', timeout: 30000 });
    execSync('git checkout -', { cwd, stdio: 'pipe', timeout: 30000 });
    _lastBackupBranch = branchName;
    saveBackupBranch(branchName);
    return {
      status:          'success',
      branch:          branchName,
      message:         `Backup branch created: ${branchName}`,
      restore_command: `git checkout "${branchName}" -- .`,
    };
  } catch (err) {
    return {
      status:     'error',
      error:      err.stderr ? err.stderr.toString().trim() : err.message,
      suggestion: 'Ensure TIQ_CODEBASE_PATH is a git repository with at least one commit.',
    };
  }
}
