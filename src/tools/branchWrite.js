/**
 * PR-based write flow.
 *
 * Instead of writing directly to the working tree, the agent:
 *   1. Creates a feature branch  agent/fix-<slug>-<timestamp>
 *   2. Writes + commits the file on that branch
 *   3. Returns branch name + diff so a human can open a PR
 *
 * This is the safe alternative to write_file for production use.
 * write_file still exists for dev/staging (working-tree) writes;
 * branch_write is used when AGENT_BRANCH_WRITES=true in .env.
 */

import fs          from 'fs';
import path        from 'path';
import { execSync } from 'child_process';
import { config }   from '../config.js';
import { guardCheck } from './credentialGuard.js';
import { logEvent }   from '../activityLog.js';

export const branchWriteDefinition = {
  name: 'branch_write',
  description:
    'Safe alternative to write_file: creates a feature branch, writes the file there, and commits — ' +
    'without touching the working branch. Returns branch name so a human can open a PR. ' +
    'Use this instead of write_file when changes should go through code review.',
  input_schema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Relative path inside the TIQ codebase, e.g. "backend/src/utils/format.ts"',
      },
      new_content: {
        type: 'string',
        description: 'Complete new content for the file',
      },
      reason: {
        type: 'string',
        description: 'Brief description of the change — used in branch name and commit message',
      },
    },
    required: ['file_path', 'new_content', 'reason'],
  },
};

const SELF_PROTECT_PATTERNS = [
  'tiqworld-ai-agent/src/', 'src/tools/', 'src/agent.js', 'src/scheduler.js',
  'src/config.js', 'src/web/', 'ecosystem.config',
  'migrations/', 'migration.', 'schema.prisma', 'prisma/schema', 'seeds/', 'seeders/',
];

function isSelfProtected(fp) {
  const n = fp.toLowerCase().replace(/\\/g, '/');
  return SELF_PROTECT_PATTERNS.some(p => n.includes(p));
}

function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30).replace(/-$/, '');
}

export async function branchWrite({ file_path, new_content, reason, _user = 'agent' }) {
  try {
    // ── Gate 1: self-protect ──────────────────────────────────────────────────
    if (isSelfProtected(file_path)) {
      return {
        status: 'blocked',
        blocked_by: 'self_protect',
        message: `"${file_path}" is in the self-protect list — cannot be written autonomously.`,
      };
    }

    // ── Gate 2: credential guard ──────────────────────────────────────────────
    const guard = guardCheck(new_content, file_path);
    if (guard.blocked) {
      return {
        status: 'blocked',
        blocked_by: 'credential_guard',
        reason: guard.reason,
        findings: guard.findings,
      };
    }

    const cwd    = config.codebasePath;
    const branch = `agent/fix-${slug(reason)}-${Date.now()}`;

    // ── Verify git repo ───────────────────────────────────────────────────────
    try {
      execSync('git rev-parse --is-inside-work-tree', { cwd, stdio: 'pipe' });
    } catch {
      return { status: 'error', error: 'Not a git repository — cannot create branch.' };
    }

    // ── Get current branch to restore later ──────────────────────────────────
    let originalBranch;
    try {
      originalBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd, stdio: 'pipe' }).toString().trim();
    } catch {
      originalBranch = 'main';
    }

    // ── Create + switch to feature branch ────────────────────────────────────
    execSync(`git checkout -b "${branch}"`, { cwd, stdio: 'pipe' });

    let committed = false;
    try {
      const fullPath = path.join(cwd, file_path);
      const isNew    = !fs.existsSync(fullPath);
      const oldContent = isNew ? '' : fs.readFileSync(fullPath, 'utf-8');

      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, new_content, 'utf-8');

      const rel = path.relative(cwd, fullPath).replace(/\\/g, '/');
      execSync(`git add "${rel}"`, { cwd, stdio: 'pipe' });
      execSync(`git commit -m "agent: ${reason}"`, { cwd, stdio: 'pipe' });
      committed = true;

      logEvent({ user: _user, action: 'branch_write', detail: { file: file_path, branch, reason } });

      // Build a minimal diff for the return value
      let diff = '';
      try {
        diff = execSync(`git diff HEAD~1 HEAD -- "${rel}"`, { cwd, stdio: 'pipe' }).toString().slice(0, 2000);
      } catch { /* diff is optional */ }

      return {
        status:      'success',
        branch,
        file_path,
        is_new_file: isNew,
        commit:      execSync('git rev-parse --short HEAD', { cwd, stdio: 'pipe' }).toString().trim(),
        diff:        diff || '(diff unavailable)',
        next_steps: [
          `git push origin "${branch}"`,
          `Then open a PR: "${branch}" → main`,
          'A human reviewer merges it — agent never pushes to main directly.',
        ],
        message: `Committed to branch "${branch}". Push and open a PR for review.`,
      };
    } finally {
      // Always switch back to original branch, whether we committed or not
      try {
        execSync(`git checkout "${originalBranch}"`, { cwd, stdio: 'pipe' });
        // If write failed mid-way (not committed), clean up the branch
        if (!committed) {
          execSync(`git branch -D "${branch}"`, { cwd, stdio: 'pipe' });
        }
      } catch { /* best-effort cleanup */ }
    }
  } catch (err) {
    return {
      status: 'error',
      error:  err.message,
      suggestion: 'Check git state: git status / git stash',
    };
  }
}
