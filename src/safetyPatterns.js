// Single source of truth for file-path safety gates.
// Imported by writeFile.js, branchWrite.js, and scheduler.js.
// Keeping this in one place means a new dangerous path only needs adding once.

export const SELF_PROTECT_PATTERNS = [
  'tiqworld-ai-agent/src/',
  'src/tools/', 'src/agent.js', 'src/scheduler.js',
  'src/config.js', 'src/web/server.js', 'src/web/router.js',
  'ecosystem.config',
  'migrations/', 'migration.', '.migration.ts', '.migration.js',
  'schema.prisma', 'prisma/schema', 'seeds/', 'seeders/',
];

export function isSelfProtected(filePath) {
  const fp = filePath.toLowerCase().replace(/\\/g, '/');
  return SELF_PROTECT_PATTERNS.some(p => fp.includes(p));
}

// Scheduler high-risk patterns — superset of self-protect; covers all auto-write risks.
export const HIGH_RISK_PATTERNS = [
  // Agent self-protection
  'tiqworld-ai-agent/src/',
  '/src/tools/', '/src/agent.js', '/src/scheduler.js',
  '/src/config.js', '/src/web/server.js', '/src/web/router.js',
  'ecosystem.config',

  // DB migrations
  'migrations/', 'migration.',
  '.migration.ts', '.migration.js',
  'schema.prisma', 'prisma/schema',
  'seeds/', 'seeders/',
  'knexfile', 'typeorm-config',
  'alembic/', 'db/migrate/',

  // Payment + certificates
  'payment', 'billing', 'subscription', 'certificate', 'cert-service',
  'stripe', 'paypal', 'webhook',

  // Core auth
  '/modules/auth/',

  // Entry/routing/model/middleware
  '/routes/', '/models/', '/middleware/',
  'config.js', 'config.ts', 'config.py',
  'settings.py', 'settings.js',
  'index.js', 'server.js', 'app.js', 'main.py', 'main.go', 'main.rs',
  'server.ts', 'app.ts',
  '/config/', 'database.config', 'env.ts', 'env.js', 'env.py',
  '/.env',

  // Test files — agent must never be its own judge
  'tests/', '__tests__/', '.test.', '.spec.', '_test.go', '_test.py',
];

export function isHighRisk(filePath) {
  const fp = filePath.toLowerCase();
  return HIGH_RISK_PATTERNS.some(p => fp.includes(p));
}
