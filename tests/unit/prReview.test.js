import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Octokit so tests don't need a real GitHub token
vi.mock('@octokit/rest', () => ({
  Octokit: vi.fn().mockImplementation(() => ({
    issues: {
      createComment: vi.fn().mockResolvedValue({
        data: { html_url: 'https://github.com/test/repo/issues/1#issuecomment-123' },
      }),
    },
  })),
}));

import { postPRReviewComment } from '../../src/prReview.js';

beforeEach(() => {
  process.env.GITHUB_TOKEN = 'test-token-123';
});

describe('postPRReviewComment() — no token', () => {
  it('returns ok:false when GITHUB_TOKEN is not set', async () => {
    delete process.env.GITHUB_TOKEN;
    const result = await postPRReviewComment({
      owner: 'test', repo: 'repo', pull_number: 1, findings: {},
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/token/i);
  });
});

describe('postPRReviewComment() — clean findings', () => {
  it('posts comment and returns ok:true when all checks pass', async () => {
    const result = await postPRReviewComment({
      owner: 'test',
      repo: 'repo',
      pull_number: 42,
      findings: {
        lint_errors:    0,
        critical_todos: 0,
        secrets_found:  0,
        dead_files:     [],
      },
    });
    expect(result.ok).toBe(true);
    expect(result.url).toMatch(/github\.com/);
  });
});

describe('postPRReviewComment() — findings with issues', () => {
  it('includes lint errors section when lint_errors > 0', async () => {
    const { Octokit } = await import('@octokit/rest');
    let capturedBody = '';
    Octokit.mockImplementation(() => ({
      issues: {
        createComment: vi.fn().mockImplementation(({ body }) => {
          capturedBody = body;
          return Promise.resolve({ data: { html_url: 'https://github.com/x' } });
        }),
      },
    }));

    await postPRReviewComment({
      owner: 'o', repo: 'r', pull_number: 1,
      findings: {
        lint_errors:  3,
        lint_details: [
          { file: 'src/app.js', line: 10, message: 'Missing semicolon' },
          { file: 'src/app.js', line: 20, message: 'Unexpected var' },
        ],
        critical_todos: 0,
        secrets_found:  0,
        dead_files:     [],
      },
    });

    expect(capturedBody).toContain('Lint Errors');
    expect(capturedBody).toContain('src/app.js');
  });

  it('includes secrets section when secrets_found > 0', async () => {
    const { Octokit } = await import('@octokit/rest');
    let capturedBody = '';
    Octokit.mockImplementation(() => ({
      issues: {
        createComment: vi.fn().mockImplementation(({ body }) => {
          capturedBody = body;
          return Promise.resolve({ data: { html_url: 'https://github.com/x' } });
        }),
      },
    }));

    await postPRReviewComment({
      owner: 'o', repo: 'r', pull_number: 1,
      findings: { lint_errors: 0, critical_todos: 0, secrets_found: 2, dead_files: [] },
    });

    expect(capturedBody).toContain('Secrets');
  });

  it('includes dead files section when dead_files present', async () => {
    const { Octokit } = await import('@octokit/rest');
    let capturedBody = '';
    Octokit.mockImplementation(() => ({
      issues: {
        createComment: vi.fn().mockImplementation(({ body }) => {
          capturedBody = body;
          return Promise.resolve({ data: { html_url: 'https://github.com/x' } });
        }),
      },
    }));

    await postPRReviewComment({
      owner: 'o', repo: 'r', pull_number: 1,
      findings: { lint_errors: 0, critical_todos: 0, secrets_found: 0, dead_files: ['src/old.js', 'src/unused.ts'] },
    });

    expect(capturedBody).toContain('Dead');
    expect(capturedBody).toContain('src/old.js');
  });

  it('includes critical TODOs section when critical_todos > 0', async () => {
    const { Octokit } = await import('@octokit/rest');
    let capturedBody = '';
    Octokit.mockImplementation(() => ({
      issues: {
        createComment: vi.fn().mockImplementation(({ body }) => {
          capturedBody = body;
          return Promise.resolve({ data: { html_url: 'https://github.com/x' } });
        }),
      },
    }));

    await postPRReviewComment({
      owner: 'o', repo: 'r', pull_number: 1,
      findings: {
        lint_errors: 0, secrets_found: 0, dead_files: [],
        critical_todos: 2,
        todo_details: [
          { file: 'src/auth.js', line: 5, text: 'FIXME: remove hardcoded key', severity: 'critical' },
        ],
      },
    });

    expect(capturedBody).toContain('TODO');
    expect(capturedBody).toContain('src/auth.js');
  });
});

describe('postPRReviewComment() — Octokit error handling', () => {
  it('returns ok:false if Octokit throws', async () => {
    const { Octokit } = await import('@octokit/rest');
    Octokit.mockImplementation(() => ({
      issues: {
        createComment: vi.fn().mockRejectedValue(new Error('GitHub API rate limit')),
      },
    }));

    const result = await postPRReviewComment({
      owner: 'o', repo: 'r', pull_number: 1,
      findings: { lint_errors: 0, critical_todos: 0, secrets_found: 0, dead_files: [] },
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/rate limit/i);
  });
});
