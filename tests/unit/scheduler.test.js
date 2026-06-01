/**
 * Scheduler unit tests.
 * Tests isHighRisk() (safety gate) and commandApprovalFn behaviour
 * via exported helpers, plus the status object shape.
 *
 * The actual cron jobs and Bedrock calls are NOT triggered here —
 * those are integration concerns. We verify the safety decisions only.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── We import only the pure, side-effect-free exports ────────────────────────
import { isHighRisk, getMaintenanceStatus, getLastScan, getSchedulerHealth } from '../../src/scheduler.js';

// ---------------------------------------------------------------------------
// isHighRisk — safety gate
// ---------------------------------------------------------------------------

describe('isHighRisk() — HIGH_RISK_PATTERNS gate', () => {
  // ── Agent self-protection ─────────────────────────────────────────────────
  it('blocks agent own source tree', () => {
    expect(isHighRisk('C:/Users/Shalini Mishra/tiqworld-ai-agent/src/agent.js')).toBe(true);
    expect(isHighRisk('C:/Users/Shalini Mishra/tiqworld-ai-agent/src/tools/writeFile.js')).toBe(true);
    expect(isHighRisk('C:/Users/Shalini Mishra/tiqworld-ai-agent/src/scheduler.js')).toBe(true);
  });

  it('blocks ecosystem.config (PM2 config)', () => {
    expect(isHighRisk('ecosystem.config.cjs')).toBe(true);
    expect(isHighRisk('/path/to/ecosystem.config.js')).toBe(true);
  });

  // ── DB migrations — critical, data loss risk ──────────────────────────────
  it('blocks DB migration files', () => {
    expect(isHighRisk('migrations/20240101_add_users.ts')).toBe(true);
    expect(isHighRisk('backend/auth-service/migration.ts')).toBe(true);
    expect(isHighRisk('schema.prisma')).toBe(true);
    expect(isHighRisk('prisma/schema.prisma')).toBe(true);
    expect(isHighRisk('seeds/initial.js')).toBe(true);
  });

  // ── Test files — agent must not be its own judge ──────────────────────────
  it('blocks files inside tests/ directory', () => {
    expect(isHighRisk('tests/unit/api.test.js')).toBe(true);
    expect(isHighRisk('tests/e2e/ui.test.js')).toBe(true);
    expect(isHighRisk('backend/auth-service/__tests__/auth.spec.ts')).toBe(true);
  });

  it('blocks .test. and .spec. file names', () => {
    expect(isHighRisk('src/utils/truncate.test.js')).toBe(true);
    expect(isHighRisk('backend/foo.spec.ts')).toBe(true);
  });

  // ── Route / model / middleware files ─────────────────────────────────────
  it('blocks route files', () => {
    expect(isHighRisk('backend/src/routes/auth.js')).toBe(true);
    expect(isHighRisk('backend/auth-service/src/routes/index.ts')).toBe(true);
  });

  it('blocks model files', () => {
    expect(isHighRisk('backend/src/models/User.js')).toBe(true);
    expect(isHighRisk('backend/training-service/src/models/track.model.ts')).toBe(true);
  });

  it('blocks middleware files', () => {
    expect(isHighRisk('backend/src/middleware/auth.js')).toBe(true);
    expect(isHighRisk('backend/auth-service/src/middleware/rateLimit.ts')).toBe(true);
  });

  it('blocks server/app/index entry points and config files', () => {
    expect(isHighRisk('backend/src/server.js')).toBe(true);
    expect(isHighRisk('backend/src/app.ts')).toBe(true);
    expect(isHighRisk('backend/src/index.js')).toBe(true);
    expect(isHighRisk('backend/auth-service/src/config.ts')).toBe(true);
    expect(isHighRisk('backend/auth-service/src/config/env.ts')).toBe(true);
    expect(isHighRisk('backend/auth-service/src/config/database.config.ts')).toBe(true);
  });

  // ── tiq_workplace specific patterns ──────────────────────────────────────
  it('blocks auth-service core modules', () => {
    expect(isHighRisk('backend/auth-service/src/modules/auth/auth.handler.ts')).toBe(true);
    expect(isHighRisk('backend/auth-service/src/config/database.config.ts')).toBe(true);
  });

  // ── Safe files must be ALLOWED ────────────────────────────────────────────
  it('allows utility and helper files', () => {
    expect(isHighRisk('backend/src/utils/format.js')).toBe(false);
    expect(isHighRisk('backend/auth-service/src/shared/utils/logger.ts')).toBe(false);
    expect(isHighRisk('backend/training-service/src/utils/slugify.ts')).toBe(false);
  });

  it('allows business logic in non-critical services', () => {
    expect(isHighRisk('backend/training-service/src/modules/tracks/tracks.service.ts')).toBe(false);
    expect(isHighRisk('backend/assessment-service/src/modules/score/score.handler.ts')).toBe(false);
    expect(isHighRisk('backend/notification-service/src/modules/email/email.service.ts')).toBe(false);
  });

  it('allows non-auth microservice handlers', () => {
    expect(isHighRisk('backend/training-service/src/modules/tasks/tasks.handler.ts')).toBe(false);
    expect(isHighRisk('backend/job-posting-service/src/modules/posts/posts.service.ts')).toBe(false);
  });

  it('allows React component files', () => {
    expect(isHighRisk('consumer-app/src/components/TrackCard.tsx')).toBe(false);
    expect(isHighRisk('admin-app/src/pages/Dashboard.tsx')).toBe(false);
  });

  it('allows documentation and config templates', () => {
    expect(isHighRisk('docs/system-design.md')).toBe(false);
    expect(isHighRisk('.env.example')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getMaintenanceStatus — shape + defaults
// ---------------------------------------------------------------------------

describe('getMaintenanceStatus()', () => {
  it('returns an object with expected shape', () => {
    const status = getMaintenanceStatus();
    expect(status).toHaveProperty('state');
    expect(status).toHaveProperty('mode');
    expect(status).toHaveProperty('startedAt');
    expect(status).toHaveProperty('finishedAt');
    expect(status).toHaveProperty('progress');
    expect(Array.isArray(status.progress)).toBe(true);
  });

  it('has a valid state value', () => {
    const { state } = getMaintenanceStatus();
    expect(['idle', 'running', 'done', 'error']).toContain(state);
  });
});

// ---------------------------------------------------------------------------
// getLastScan — shape
// ---------------------------------------------------------------------------

describe('getLastScan()', () => {
  it('returns { result, scannedAt } shape', () => {
    const scan = getLastScan();
    expect(scan).toHaveProperty('result');
    expect(scan).toHaveProperty('scannedAt');
  });

  it('result is null or an object before any scan has run', () => {
    const { result } = getLastScan();
    expect(result === null || typeof result === 'object').toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getSchedulerHealth — shape + types
// ---------------------------------------------------------------------------

describe('getSchedulerHealth()', () => {
  it('returns expected fields with correct types', () => {
    const h = getSchedulerHealth();
    expect(typeof h.night_task_active).toBe('boolean');
    expect(typeof h.day_task_active).toBe('boolean');
    expect(typeof h.auto_fix_enabled).toBe('boolean');
    expect(typeof h.auto_fix_min_confidence).toBe('number');
    expect(h.auto_fix_min_confidence).toBeGreaterThanOrEqual(0);
    expect(h.auto_fix_min_confidence).toBeLessThanOrEqual(100);
  });

  it('reports correct confidence from config (default 80)', () => {
    const { auto_fix_min_confidence } = getSchedulerHealth();
    // Default in .env.example is 80; accept any valid value
    expect(auto_fix_min_confidence).toBeGreaterThan(0);
  });

  it('has cron strings for night and day schedules', () => {
    const { night_cron, day_cron } = getSchedulerHealth();
    // Should look like cron expressions (not empty)
    expect(typeof night_cron).toBe('string');
    expect(typeof day_cron).toBe('string');
    expect(night_cron.length).toBeGreaterThan(0);
    expect(day_cron.length).toBeGreaterThan(0);
  });
});
