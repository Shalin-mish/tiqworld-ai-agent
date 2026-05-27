import { describe, it, expect } from 'vitest';
import { classify, getTools, TASK_LABELS } from '../../src/dispatcher.js';

// ---------------------------------------------------------------------------
// classify() — multi-keyword confidence scoring
// ---------------------------------------------------------------------------

describe('classify() — clear single-type inputs', () => {
  it('review: health/scan keywords', () => {
    expect(classify('run a full scan')).toBe('review');
    expect(classify('health check the codebase')).toBe('review');
    expect(classify('find todos in backend')).toBe('review');
    expect(classify('check for dead code')).toBe('review');
    expect(classify('any secrets leaked')).toBe('review');
    expect(classify('are dependencies outdated')).toBe('review');
  });

  it('maintenance: fix/bug keywords', () => {
    expect(classify('fix the login bug')).toBe('maintenance');
    expect(classify('refactor the auth middleware')).toBe('maintenance');
    expect(classify('there is an error in submissions')).toBe('maintenance');
    expect(classify('trace this stack trace')).toBe('maintenance');
  });

  it('feature: add/create keywords', () => {
    expect(classify('add a new route')).toBe('feature');
    expect(classify('create a new component')).toBe('feature');
    expect(classify('implement the export endpoint')).toBe('feature');
    expect(classify('scaffold a new page')).toBe('feature');
  });

  it('query: explain/what/where keywords only', () => {
    expect(classify('what does this function do')).toBe('query');
    expect(classify('where is the auth middleware')).toBe('query');
    expect(classify('explain the auth flow')).toBe('query');
    expect(classify('describe the Track model')).toBe('query');
  });

  it('defaults to query for unrecognised input', () => {
    expect(classify('hello world')).toBe('query');
    expect(classify('')).toBe('query');
    expect(classify('   ')).toBe('query');
  });
});

describe('classify() — ambiguous inputs (tie-break by TYPE_PRIORITY)', () => {
  // "explain how to fix" — explain=1 (query), fix=1 (maintenance) → tie
  // TYPE_PRIORITY: maintenance(2) > query(0) → maintenance wins
  it('tie between query and maintenance → maintenance wins', () => {
    expect(classify('explain how to fix this error')).toBe('maintenance');
  });

  // "explain the scan results" — explain=1 (query), scan=1 (review) → tie
  // TYPE_PRIORITY: review(1) > query(0) → review wins
  it('tie between query and review → review wins', () => {
    expect(classify('explain the scan results')).toBe('review');
  });

  // Pure query — no other keyword → query
  it('pure explain sentence → query', () => {
    expect(classify('explain the certificate flow')).toBe('query');
  });
});

describe('classify() — multi-keyword scoring (higher count wins)', () => {
  // "scan for bugs and fix errors" → review:1, maintenance:2 → maintenance
  it('maintenance beats review when fix-words outnumber scan-words', () => {
    const result = classify('fix the bug and trace the error');
    expect(result).toBe('maintenance');
  });

  // "review security and scan for secrets" → review:3 → review
  it('review wins with multiple review-type keywords', () => {
    const result = classify('review security and scan for secrets and dead code');
    expect(result).toBe('review');
  });

  // "add new route and create new endpoint" → feature:2 → feature
  it('feature wins with stacked feature keywords', () => {
    const result = classify('add a new route and create a new endpoint');
    expect(result).toBe('feature');
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
