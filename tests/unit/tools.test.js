import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { listFiles } from '../../src/tools/listFiles.js';
import { searchCode } from '../../src/tools/searchCode.js';
import { runCommand } from '../../src/tools/runCommand.js';

// Point tool config at a real temp directory so tests are self-contained
import { config } from '../../src/config.js';

let tmpDir;
beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tiq-test-'));
  fs.writeFileSync(path.join(tmpDir, 'hello.js'), 'export const greeting = "hello";\n');
  fs.mkdirSync(path.join(tmpDir, 'sub'));
  fs.writeFileSync(path.join(tmpDir, 'sub', 'world.ts'), 'export const world = "world";\n');
  config.codebasePath = tmpDir;
});

// ── list_files ──────────────────────────────────────────────────────────────
describe('listFiles()', () => {
  it('returns entries for a valid directory', () => {
    const result = listFiles({ directory: '' });
    expect(result.error).toBeUndefined();
    expect(result.entries.length).toBeGreaterThan(0);
    expect(result.total).toBe(result.entries.length);
  });

  it('returns a folder entry', () => {
    const result = listFiles({ directory: '' });
    const folder = result.entries.find(e => e.type === 'folder');
    expect(folder).toBeTruthy();
    expect(folder.name).toBe('sub');
  });

  it('returns error for non-existent directory', () => {
    const result = listFiles({ directory: 'does/not/exist' });
    expect(result.error).toMatch(/not found/i);
  });

  it('lists nested directory', () => {
    const result = listFiles({ directory: 'sub' });
    expect(result.error).toBeUndefined();
    expect(result.entries[0].name).toBe('world.ts');
  });
});

// ── search_code ─────────────────────────────────────────────────────────────
describe('searchCode()', () => {
  it('finds a keyword that exists', () => {
    const result = searchCode({ keyword: 'greeting' });
    expect(result.error).toBeUndefined();
    expect(result.total_matches).toBeGreaterThan(0);
    expect(result.matches[0].file).toContain('hello.js');
  });

  it('returns zero matches for unknown keyword', () => {
    const result = searchCode({ keyword: 'xyzzy_no_such_token' });
    expect(result.total_matches).toBe(0);
  });

  it('reports searched_files count', () => {
    const result = searchCode({ keyword: 'world' });
    expect(result.searched_files).toBeGreaterThan(0);
  });

  it('is case-insensitive', () => {
    const lower = searchCode({ keyword: 'greeting' });
    const upper = searchCode({ keyword: 'GREETING' });
    expect(lower.total_matches).toBe(upper.total_matches);
  });

  it('limits scope to a subdirectory', () => {
    const root = searchCode({ keyword: 'world', directory: '' });
    const sub  = searchCode({ keyword: 'world', directory: 'sub' });
    expect(sub.total_matches).toBeLessThanOrEqual(root.total_matches);
  });

  it('returns error for non-existent directory', () => {
    const result = searchCode({ keyword: 'x', directory: 'no/such/dir' });
    expect(result.error).toBeTruthy();
  });
});

// ── run_command (whitelist) ──────────────────────────────────────────────────
describe('runCommand() — whitelist enforcement', () => {
  it('rejects a command not on the allowlist', async () => {
    const result = await runCommand({ command: 'rm -rf /' });
    expect(result.error).toMatch(/not allowed/i);
    expect(result.allowed_commands).toBeTruthy();
  });

  it('rejects empty string', async () => {
    const result = await runCommand({ command: '' });
    expect(result.error).toMatch(/not allowed/i);
  });

  it('rejects shell injection attempt', async () => {
    const result = await runCommand({ command: 'npm test && rm -rf /' });
    expect(result.error).toMatch(/not allowed/i);
  });

  it('rejects if commandApprovalFn returns no', async () => {
    const result = await runCommand({
      command: 'node --version',
      _commandApprovalFn: async () => 'no',
    });
    expect(result.status).toBe('rejected');
  });

  it('runs node --version when approved', async () => {
    const result = await runCommand({
      command: 'node --version',
      _commandApprovalFn: async () => 'yes',
    });
    expect(result.exit_code).toBe(0);
    expect(result.output).toMatch(/v\d+/);
  });
});
