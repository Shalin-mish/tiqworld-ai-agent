import { describe, it, expect } from 'vitest';
import { isHighRisk } from '../../src/scheduler.js';

describe('isHighRisk() — safety gate', () => {
  // ── test files must ALWAYS be blocked — agent must not be its own judge ─────
  it('blocks files inside tests/ directory', () => {
    expect(isHighRisk('tests/unit/dispatcher.test.js')).toBe(true);
    expect(isHighRisk('tests/e2e/ui.test.js')).toBe(true);
    expect(isHighRisk('backend/auth-service/src/tests/auth.test.ts')).toBe(true);
  });

  it('blocks files inside __tests__/ directory (vitest convention)', () => {
    expect(isHighRisk('backend/auth-service/src/__tests__/auth.spec.ts')).toBe(true);
    expect(isHighRisk('consumer-app/src/__tests__/Login.test.tsx')).toBe(true);
  });

  it('blocks files with .test. in the name', () => {
    expect(isHighRisk('src/utils/truncate.test.js')).toBe(true);
    expect(isHighRisk('some/deep/myModule.test.ts')).toBe(true);
  });

  it('blocks files with .spec. in the name', () => {
    expect(isHighRisk('src/agent.spec.js')).toBe(true);
    expect(isHighRisk('backend/auth-service/src/__tests__/auth.spec.ts')).toBe(true);
  });

  // ── critical infra files must be blocked ─────────────────────────────────
  it('blocks route files', () => {
    expect(isHighRisk('backend/src/routes/auth.js')).toBe(true);
  });

  it('blocks model files', () => {
    expect(isHighRisk('backend/src/models/User.js')).toBe(true);
  });

  it('blocks middleware files', () => {
    expect(isHighRisk('backend/src/middleware/auth.js')).toBe(true);
  });

  it('blocks server/app/index entry points', () => {
    expect(isHighRisk('backend/src/server.js')).toBe(true);
    expect(isHighRisk('backend/auth-service/src/server.ts')).toBe(true);
    expect(isHighRisk('backend/auth-service/src/app.ts')).toBe(true);
    expect(isHighRisk('backend/src/config.js')).toBe(true);
    expect(isHighRisk('backend/auth-service/src/config/env.ts')).toBe(true);
  });

  it('blocks auth-service core auth module (tiq_workplace)', () => {
    expect(isHighRisk('backend/auth-service/src/modules/auth/auth.handler.ts')).toBe(true);
    expect(isHighRisk('backend/auth-service/src/config/database.config.ts')).toBe(true);
  });

  // ── safe files must be ALLOWED ────────────────────────────────────────────
  it('allows utility / helper files', () => {
    expect(isHighRisk('backend/src/utils/format.js')).toBe(false);
    expect(isHighRisk('backend/auth-service/src/shared/utils/logger.ts')).toBe(false);
  });

  it('allows service business logic files (non-auth)', () => {
    expect(isHighRisk('backend/training-service/src/modules/tracks/tracks.service.ts')).toBe(false);
    expect(isHighRisk('backend/assessment-service/src/modules/score/score.handler.ts')).toBe(false);
  });

  it('allows non-auth microservice modules', () => {
    expect(isHighRisk('backend/training-service/src/modules/tasks/tasks.handler.ts')).toBe(false);
    expect(isHighRisk('backend/notification-service/src/modules/email/email.service.ts')).toBe(false);
  });
});
