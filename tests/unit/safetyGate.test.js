import { describe, it, expect } from 'vitest';
import { isHighRisk } from '../../src/scheduler.js';

describe('isHighRisk() — safety gate', () => {
  // ── test files must ALWAYS be blocked ──────────────────────────────────────
  it('blocks files inside tests/ directory', () => {
    expect(isHighRisk('tests/unit/dispatcher.test.js')).toBe(true);
    expect(isHighRisk('tests/e2e/ui.test.js')).toBe(true);
    expect(isHighRisk('tests/unit/session.test.js')).toBe(true);
  });

  it('blocks files with .test. in the name', () => {
    expect(isHighRisk('src/utils/truncate.test.js')).toBe(true);
    expect(isHighRisk('some/deep/path/myModule.test.ts')).toBe(true);
  });

  it('blocks files with .spec. in the name', () => {
    expect(isHighRisk('src/agent.spec.js')).toBe(true);
  });

  // ── critical src files must be blocked ────────────────────────────────────
  it('blocks route files', () => {
    expect(isHighRisk('backend/src/routes/auth.js')).toBe(true);
    expect(isHighRisk('backend/src/routes/tracks.js')).toBe(true);
  });

  it('blocks model files', () => {
    expect(isHighRisk('backend/src/models/User.js')).toBe(true);
  });

  it('blocks middleware files', () => {
    expect(isHighRisk('backend/src/middleware/auth.js')).toBe(true);
  });

  it('blocks auth-related files', () => {
    expect(isHighRisk('backend/src/services/authService.js')).toBe(true);
  });

  it('blocks config, index, server, app files', () => {
    expect(isHighRisk('backend/src/config.js')).toBe(true);
    expect(isHighRisk('backend/src/index.js')).toBe(true);
    expect(isHighRisk('backend/src/server.js')).toBe(true);
    expect(isHighRisk('backend/src/app.js')).toBe(true);
  });

  // ── safe files must be ALLOWED ────────────────────────────────────────────
  it('allows utility files', () => {
    expect(isHighRisk('backend/src/utils/format.js')).toBe(false);
    expect(isHighRisk('backend/src/helpers/date.js')).toBe(false);
  });

  it('allows controller files', () => {
    expect(isHighRisk('backend/src/controllers/submissions.js')).toBe(false);
  });

  it('allows service files that are not auth-related', () => {
    expect(isHighRisk('backend/src/services/roadmap.js')).toBe(false);
    expect(isHighRisk('backend/src/services/assessment.js')).toBe(false);
  });
});
