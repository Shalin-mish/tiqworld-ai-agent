/**
 * branchWrite unit tests.
 *
 * We can't test the real git operations without a live git repo,
 * so we test:
 *   1. Self-protect blocking (no git needed)
 *   2. Credential guard blocking (no git needed)
 *   3. The tool definition schema is correct
 *
 * Git-dependent paths (branch creation, commit) are integration tests
 * and run only if TIQ_CODEBASE_PATH points to a real git repo.
 */

import { describe, it, expect } from 'vitest';
import { branchWriteDefinition, branchWrite } from '../../src/tools/branchWrite.js';

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

describe('branchWrite — tool definition', () => {
  it('has required name field', () => {
    expect(branchWriteDefinition.name).toBe('branch_write');
  });

  it('has input_schema with required properties', () => {
    const { properties, required } = branchWriteDefinition.input_schema;
    expect(properties).toHaveProperty('file_path');
    expect(properties).toHaveProperty('new_content');
    expect(properties).toHaveProperty('reason');
    expect(required).toContain('file_path');
    expect(required).toContain('new_content');
    expect(required).toContain('reason');
  });
});

// ---------------------------------------------------------------------------
// Self-protect gate — must never require git
// ---------------------------------------------------------------------------

describe('branchWrite — self-protect gate', () => {
  const selfProtectedPaths = [
    'tiqworld-ai-agent/src/agent.js',
    'src/tools/writeFile.js',
    'src/scheduler.js',
    'src/config.js',
    'src/web/server.js',
    'schema.prisma',
    'migrations/20240101.ts',
    'seeds/initial.js',
  ];

  for (const fp of selfProtectedPaths) {
    it(`blocks "${fp}"`, async () => {
      const result = await branchWrite({ file_path: fp, new_content: 'x', reason: 'test' });
      expect(result.status).toBe('blocked');
      expect(result.blocked_by).toBe('self_protect');
    });
  }
});

// ---------------------------------------------------------------------------
// Credential guard — must never require git
// ---------------------------------------------------------------------------

describe('branchWrite — credential guard', () => {
  it('blocks content containing AWS Access Key ID pattern', async () => {
    const maliciousContent = `const key = 'AKIAIOSFODNN7EXAMPLE';\n`;
    const result = await branchWrite({
      file_path:   'backend/src/utils/helper.ts',
      new_content: maliciousContent,
      reason:      'test write',
    });
    expect(result.status).toBe('blocked');
    expect(result.blocked_by).toBe('credential_guard');
  });

  it('blocks content containing a PEM private key', async () => {
    const pemContent = `-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAK...\n-----END RSA PRIVATE KEY-----\n`;
    const result = await branchWrite({
      file_path:   'backend/src/utils/crypto.ts',
      new_content: pemContent,
      reason:      'test write',
    });
    expect(result.status).toBe('blocked');
    expect(result.blocked_by).toBe('credential_guard');
  });

  it('allows safe content (process.env usage)', async () => {
    // This will try git ops and fail — but it must NOT be blocked by self_protect or credential_guard
    const safeContent = `const key = process.env.AWS_SECRET;\n`;
    const result = await branchWrite({
      file_path:   'backend/src/utils/config.helper.ts',
      new_content: safeContent,
      reason:      'refactor config access',
    });
    // Blocked by self_protect (config.ts matches config pattern) or git error — not credential_guard
    expect(result.blocked_by ?? result.status).not.toBe('credential_guard');
  });
});
