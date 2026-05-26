import { describe, it, expect } from 'vitest';
import { classify, getTools, TASK_LABELS } from '../../src/dispatcher.js';

describe('classify()', () => {
  it('returns review for health/scan keywords', () => {
    expect(classify('run a full scan')).toBe('review');
    expect(classify('health check the codebase')).toBe('review');
    expect(classify('find todos')).toBe('review');
  });

  it('returns maintenance for fix/bug keywords', () => {
    expect(classify('fix the login bug')).toBe('maintenance');
    expect(classify('refactor the auth middleware')).toBe('maintenance');
  });

  it('returns feature for add/create keywords', () => {
    expect(classify('add a new route')).toBe('feature');
    expect(classify('create a new component')).toBe('feature');
  });

  it('returns query for explain/what keywords', () => {
    expect(classify('what does this function do')).toBe('query');
    expect(classify('explain the auth flow')).toBe('query');
  });

  it('defaults to query for unrecognised input', () => {
    expect(classify('hello world')).toBe('query');
    expect(classify('')).toBe('query');
  });
});

describe('getTools()', () => {
  it('returns tool set for each task type', () => {
    for (const type of ['query', 'review', 'maintenance', 'feature']) {
      const tools = getTools(type);
      expect(tools).toHaveProperty('definitions');
      expect(tools).toHaveProperty('executors');
      expect(tools.definitions.length).toBeGreaterThan(0);
    }
  });

  it('query scope excludes write_file', () => {
    const { definitions } = getTools('query');
    const names = definitions.map(d => d.name);
    expect(names).not.toContain('write_file');
    expect(names).not.toContain('run_command');
  });

  it('maintenance scope includes write_file and run_command', () => {
    const { definitions } = getTools('maintenance');
    const names = definitions.map(d => d.name);
    expect(names).toContain('write_file');
    expect(names).toContain('run_command');
  });

  it('falls back to query for unknown task type', () => {
    const fallback  = getTools('unknown_type');
    const querySet  = getTools('query');
    expect(fallback.definitions.length).toBe(querySet.definitions.length);
  });
});

describe('TASK_LABELS', () => {
  it('has a label for every known task type', () => {
    for (const type of ['query', 'review', 'maintenance', 'feature']) {
      expect(TASK_LABELS[type]).toBeTruthy();
    }
  });
});
