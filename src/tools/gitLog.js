import { execSync } from 'child_process';
import { config } from '../config.js';

export const gitLogDefinition = {
  name: 'git_log',
  description:
    'Get recent git commit history for the TIQ codebase. Returns commits with short hash, author, date, and message. Filter by file path or date. Use before writing commit messages or PR descriptions to understand what changed.',
  input_schema: {
    type: 'object',
    properties: {
      count: {
        type: 'number',
        description: 'Number of commits to return. Default: 10. Max: 50.',
      },
      file_path: {
        type: 'string',
        description: 'Limit to commits that touched this file, e.g. "backend/src/controllers/auth.controller.js".',
      },
      since: {
        type: 'string',
        description: 'Only show commits after this date, e.g. "2026-05-01" or "1 week ago".',
      },
    },
  },
};

export function gitLog({ count = 10, file_path = '', since = '' } = {}) {
  try {
    const n     = Math.min(Math.max(1, Number(count) || 10), 50);
    const since_ = since     ? `--since="${since}"` : '';
    const path_  = file_path ? `-- "${file_path}"`  : '';
    const fmt    = '%H|%an|%ad|%s';

    const cmd = `git log --format="${fmt}" --date=short -${n} ${since_} ${path_}`.replace(/\s+/g, ' ').trim();
    const raw = execSync(cmd, { cwd: config.codebasePath, encoding: 'utf-8' }).trim();

    if (!raw) return { commits: [], message: 'No commits match the given filters.' };

    const commits = raw.split('\n').map((line) => {
      const [hash, author, date, ...rest] = line.split('|');
      return { hash: hash.slice(0, 8), author, date, message: rest.join('|') };
    });

    return {
      count: commits.length,
      ...(file_path && { file_path }),
      ...(since && { since }),
      commits,
      fetchedAt: new Date().toISOString(),
    };
  } catch (err) {
    return { error: err.message, suggestion: 'Ensure the codebase path is a git repository' };
  }
}
