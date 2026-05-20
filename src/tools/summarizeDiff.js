import { execSync } from 'child_process';
import { config } from '../config.js';

export const summarizeDiffDefinition = {
  name: 'summarize_diff',
  description:
    'Get the current git diff for the TIQ codebase — staged changes, unstaged working-tree changes, or all commits since branching from main. Use before writing commit messages or PR descriptions so the summary is grounded in actual changes.',
  input_schema: {
    type: 'object',
    properties: {
      mode: {
        type: 'string',
        enum: ['staged', 'unstaged', 'branch'],
        description: '"staged" = --cached, "unstaged" = working tree, "branch" = all commits ahead of base_branch. Default: unstaged.',
      },
      base_branch: {
        type: 'string',
        description: 'Branch to compare against when mode is "branch". Default: "main".',
      },
    },
  },
};

const DIFF_CMD = {
  staged:   'git diff --cached --stat && echo "---" && git diff --cached',
  unstaged: 'git diff --stat && echo "---" && git diff',
};

const MAX_CHARS = 12000;

export function summarizeDiff({ mode = 'unstaged', base_branch = 'main' } = {}) {
  try {
    const cwd = config.codebasePath;
    const cmd = mode === 'branch'
      ? `git diff ${base_branch}...HEAD --stat && echo "---" && git diff ${base_branch}...HEAD`
      : (DIFF_CMD[mode] ?? DIFF_CMD.unstaged);

    const raw = execSync(cmd, { cwd, encoding: 'utf-8', maxBuffer: 2 * 1024 * 1024 }).trim();

    if (!raw) return { mode, diff: null, message: 'No changes detected for this diff mode.' };

    const truncated = raw.length > MAX_CHARS;
    return {
      mode,
      ...(mode === 'branch' && { base_branch }),
      diff: truncated ? `${raw.slice(0, MAX_CHARS)}\n\n[...truncated — ${raw.length} total chars]` : raw,
      truncated,
      scannedAt: new Date().toISOString(),
    };
  } catch (err) {
    return { error: err.message, suggestion: 'Ensure the path is a git repo and the base branch exists' };
  }
}
