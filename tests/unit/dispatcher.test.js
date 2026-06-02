import { describe, it, expect } from 'vitest';
import { classify, getTools, TASK_LABELS } from '../../src/dispatcher.js';

// ---------------------------------------------------------------------------
// classify() — multi-keyword confidence scoring
// ---------------------------------------------------------------------------

// classify() returns { type, confidence, scores } — we check .type
const t = (input) => classify(input).type;

describe('classify() — clear single-type inputs', () => {
  it('review: health/scan keywords', () => {
    expect(t('run a full scan')).toBe('review');
    expect(t('health check the codebase')).toBe('review');
    expect(t('find todos in backend')).toBe('review');
    expect(t('check for dead code')).toBe('review');
    expect(t('any secrets leaked')).toBe('review');
    expect(t('are dependencies outdated')).toBe('review');
  });

  it('maintenance: fix/bug keywords', () => {
    expect(t('fix the login bug')).toBe('maintenance');
    expect(t('refactor the auth middleware')).toBe('maintenance');
    expect(t('there is an error in submissions')).toBe('maintenance');
    expect(t('trace this stack trace')).toBe('maintenance');
  });

  it('feature: add/create keywords', () => {
    expect(t('add a new route')).toBe('feature');
    expect(t('create a new component')).toBe('feature');
    expect(t('implement the export endpoint')).toBe('feature');
    expect(t('scaffold a new page')).toBe('feature');
  });

  it('query: explain/what/where keywords only', () => {
    expect(t('what does this function do')).toBe('query');
    expect(t('where is the auth middleware')).toBe('query');
    expect(t('explain the auth flow')).toBe('query');
    expect(t('describe the Track model')).toBe('query');
  });

  it('defaults to query for unrecognised input', () => {
    expect(t('hello world')).toBe('query');
    expect(t('')).toBe('query');
    expect(t('   ')).toBe('query');
  });
});

describe('classify() — ambiguous inputs (tie-break by TYPE_PRIORITY)', () => {
  // "explain how to fix" — explain=1 (query), fix=1 (maintenance) → tie
  // TYPE_PRIORITY: maintenance(2) > query(0) → maintenance wins
  it('tie between query and maintenance → maintenance wins', () => {
    expect(t('explain how to fix this error')).toBe('maintenance');
  });

  // "explain the scan results" — explain=1 (query), scan=1 (review) → tie
  // TYPE_PRIORITY: review(1) > query(0) → review wins
  it('tie between query and review → review wins', () => {
    expect(t('explain the scan results')).toBe('review');
  });

  // Pure query — no other keyword → query
  it('pure explain sentence → query', () => {
    expect(t('explain the certificate flow')).toBe('query');
  });
});

describe('classify() — multi-keyword scoring (higher count wins)', () => {
  // "scan for bugs and fix errors" → review:1, maintenance:2 → maintenance
  it('maintenance beats review when fix-words outnumber scan-words', () => {
    expect(t('fix the bug and trace the error')).toBe('maintenance');
  });

  // "review security and scan for secrets" → review:3 → review
  it('review wins with multiple review-type keywords', () => {
    expect(t('review security and scan for secrets and dead code')).toBe('review');
  });

  // "add new route and create new endpoint" → feature:2 → feature
  it('feature wins with stacked feature keywords', () => {
    expect(t('add a new route and create a new endpoint')).toBe('feature');
  });
});

// ---------------------------------------------------------------------------
// getTools()
// ---------------------------------------------------------------------------

describe('getTools()', () => {
  it('returns definitions and executors for every task type', () => {
    for (const type of ['query', 'review', 'maintenance', 'feature']) {
      const tools = getTools(type);
      expect(tools).toHaveProperty('definitions');
      expect(tools).toHaveProperty('executors');
      expect(tools.definitions.length).toBeGreaterThan(0);
    }
  });

  it('query scope excludes all write tools', () => {
    const { definitions } = getTools('query');
    const names = definitions.map(d => d.name);
    expect(names).not.toContain('write_file');
    expect(names).not.toContain('run_command');
    expect(names).not.toContain('git_backup');
  });

  it('review scope has fix_error and show_diff but not write_file', () => {
    const { definitions } = getTools('review');
    const names = definitions.map(d => d.name);
    expect(names).toContain('fix_error');
    expect(names).toContain('show_diff');
    expect(names).not.toContain('write_file');
    expect(names).not.toContain('git_backup');
  });

  it('maintenance scope includes full write pipeline', () => {
    const { definitions } = getTools('maintenance');
    const names = definitions.map(d => d.name);
    expect(names).toContain('write_file');
    expect(names).toContain('run_command');
    expect(names).toContain('git_backup');
    expect(names).toContain('show_diff');
  });

  it('feature and maintenance share identical tool sets', () => {
    const maintenance = getTools('maintenance');
    const feature     = getTools('feature');
    expect(maintenance).toBe(feature); // same object reference — no duplication
  });

  it('falls back to query for unknown task type', () => {
    const fallback = getTools('unknown_type');
    const query    = getTools('query');
    expect(fallback.definitions.length).toBe(query.definitions.length);
  });

  it('executors keys match definition names', () => {
    for (const type of ['query', 'review', 'maintenance']) {
      const { definitions, executors } = getTools(type);
      for (const def of definitions) {
        expect(executors).toHaveProperty(def.name);
        expect(typeof executors[def.name]).toBe('function');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// TASK_LABELS
// ---------------------------------------------------------------------------

describe('TASK_LABELS', () => {
  it('has a non-empty label for every known task type', () => {
    for (const type of ['query', 'review', 'maintenance', 'feature']) {
      expect(TASK_LABELS[type]).toBeTruthy();
      expect(typeof TASK_LABELS[type]).toBe('string');
    }
  });
});
