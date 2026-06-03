import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We control the mock createComment fn so tests can inspect what body was posted
let mockCreateComment = vi.fn();

vi.mock('@octokit/rest', () => {
  return {
    Octokit: function MockOctokit() {
      this.issues = { createComment: mockCreateComment };
    },
  };
});

const { postPRReviewComment } = await import('../../src/prReview.js');

const BASE_FINDINGS = {
  lint_errors: 0, lint_details: [],
  critical_todos: 0, todo_details: [],
  secrets_found: 0,
  dead_files: [],
};

describe('postPRReviewComment', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, GITHUB_TOKEN: 'test-token' };
    mockCreateComment = vi.fn().mockResolvedValue({
      data: { html_url: 'https://github.com/owner/repo/issues/1#issuecomment-123' },
    });
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  it('returns ok:false when GITHUB_TOKEN is missing', async () => {
    delete process.env.GITHUB_TOKEN;
    const result = await postPRReviewComment({ owner: 'o', repo: 'r', pull_number: 1, findings: BASE_FINDINGS });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/GITHUB_TOKEN/i);
  });

  it('posts comment and returns ok:true on all-clear findings', async () => {
    const result = await postPRReviewComment({ owner: 'o', repo: 'r', pull_number: 1, findings: BASE_FINDINGS });
    expect(result.ok).toBe(true);
    expect(result.url).toContain('github.com');
    expect(mockCreateComment).toHaveBeenCalledOnce();
  });

  it('includes lint error section when lint_errors > 0', async () => {
    await postPRReviewComment({
      owner: 'o', repo: 'r', pull_number: 1,
      findings: { ...BASE_FINDINGS, lint_errors: 2, lint_details: [{ file: 'a.js', line: 5, message: 'no-undef' }] },
    });
    const { body } = mockCreateComment.mock.calls[0][0];
    expect(body).toContain('Lint Errors');
    expect(body).toContain('a.js');
  });

  it('includes secrets section when secrets_found > 0', async () => {
    await postPRReviewComment({ owner: 'o', repo: 'r', pull_number: 1, findings: { ...BASE_FINDINGS, secrets_found: 1 } });
    const { body } = mockCreateComment.mock.calls[0][0];
    expect(body).toContain('Secrets');
  });

  it('includes dead files section when dead_files is non-empty', async () => {
    await postPRReviewComment({ owner: 'o', repo: 'r', pull_number: 1, findings: { ...BASE_FINDINGS, dead_files: ['src/old.js'] } });
    const { body } = mockCreateComment.mock.calls[0][0];
    expect(body).toContain('Dead');
    expect(body).toContain('src/old.js');
  });

  it('includes critical todos section when critical_todos > 0', async () => {
    await postPRReviewComment({
      owner: 'o', repo: 'r', pull_number: 1,
      findings: { ...BASE_FINDINGS, critical_todos: 1, todo_details: [{ file: 'b.js', line: 10, text: 'FIXME: auth bypass', severity: 'critical' }] },
    });
    const { body } = mockCreateComment.mock.calls[0][0];
    expect(body).toContain('TODO');
    expect(body).toContain('FIXME: auth bypass');
  });

  it('returns ok:false when Octokit throws', async () => {
    mockCreateComment.mockRejectedValueOnce(new Error('API rate limit'));
    const result = await postPRReviewComment({ owner: 'o', repo: 'r', pull_number: 1, findings: BASE_FINDINGS });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('rate limit');
  });

  it('body always ends with agent disclaimer', async () => {
    await postPRReviewComment({ owner: 'o', repo: 'r', pull_number: 1, findings: BASE_FINDINGS });
    const { body } = mockCreateComment.mock.calls[0][0];
    expect(body).toContain('TIQ AI Agent');
    expect(body).toContain('verify before merging');
  });
});
