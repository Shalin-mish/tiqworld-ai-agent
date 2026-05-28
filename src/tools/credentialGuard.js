/**
 * credential_guard — Static analysis tool that detects credential / secret leaks
 * in proposed file content BEFORE any write happens.
 *
 * Used in two ways:
 *   A. As an explicit agent tool: agent calls it to audit a file path or snippet.
 *   B. As a write-gate: writeFile imports `guardCheck` and calls it pre-write —
 *      if HIGH-severity findings exist the write is blocked and the agent is told why.
 *
 * Detects:
 *   - Hardcoded passwords, API keys, tokens, secrets
 *   - Private keys (PEM blocks)
 *   - Connection strings with embedded credentials
 *   - AWS / GCP / Azure key patterns
 *   - JWT secrets written as literals
 *   - .env-style KEY=value pairs with suspicious names
 *   - Common secret variable names assigned to non-env string literals
 */

// ---------------------------------------------------------------------------
// Rule table — { name, pattern, severity, suggestion }
// severity: 'HIGH' | 'MEDIUM' | 'LOW'
// ---------------------------------------------------------------------------
const RULES = [
  // Private keys
  {
    name: 'PEM private key',
    pattern: /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/i,
    severity: 'HIGH',
    suggestion: 'Never hardcode private keys. Store in a secrets manager or env var and load at runtime.',
  },
  // AWS
  {
    name: 'AWS Access Key ID',
    pattern: /\bAKIA[0-9A-Z]{16}\b/,
    severity: 'HIGH',
    suggestion: 'Use IAM roles or load from AWS_ACCESS_KEY_ID env var.',
  },
  {
    name: 'AWS Secret Access Key',
    pattern: /aws[_\-]?(secret|access)[_\-]?(key|token)['":\s=]+[A-Za-z0-9/+=]{20,}/i,
    severity: 'HIGH',
    suggestion: 'Rotate this key immediately if committed. Load from env var instead.',
  },
  // Generic high-entropy secrets
  {
    name: 'Generic API key / token literal',
    pattern: /\b(api[_\-]?key|apikey|auth[_\-]?token|access[_\-]?token|bearer[_\-]?token)\s*[:=]\s*['"`][A-Za-z0-9\-_.~+/]{20,}['"`]/i,
    severity: 'HIGH',
    suggestion: 'Move to environment variable. Never hardcode tokens in source.',
  },
  // Passwords
  {
    name: 'Hardcoded password assignment',
    pattern: /\b(password|passwd|pwd|secret|db_pass|db_password)\s*[:=]\s*['"`][^'"`${}]{4,}['"`]/i,
    severity: 'HIGH',
    suggestion: 'Load passwords from env vars (process.env.DB_PASSWORD) or a vault.',
  },
  // Database connection strings
  {
    name: 'Connection string with credentials',
    pattern: /(postgres|mysql|mongodb|redis):\/\/[^:@\s]{1,}:[^@\s]{4,}@/i,
    severity: 'HIGH',
    suggestion: 'Use DB_URL env var. Connection strings with passwords must never be hardcoded.',
  },
  // JWT
  {
    name: 'JWT secret literal',
    pattern: /\b(jwt[_\-]?secret|token[_\-]?secret|signing[_\-]?key)\s*[:=]\s*['"`][^'"`${}]{8,}['"`]/i,
    severity: 'HIGH',
    suggestion: 'JWT secrets must come from env vars, not source code.',
  },
  // GCP / Azure
  {
    name: 'GCP service account key JSON',
    pattern: /"private_key"\s*:\s*"-----BEGIN/i,
    severity: 'HIGH',
    suggestion: 'GCP service account keys must never be committed. Use Workload Identity or Secret Manager.',
  },
  {
    name: 'Azure connection string',
    pattern: /AccountKey=[A-Za-z0-9+/]{43}={0,2}/,
    severity: 'HIGH',
    suggestion: 'Azure storage keys must be rotated and stored in Key Vault / env vars.',
  },
  // Slack / Discord / Telegram webhooks
  {
    name: 'Slack webhook URL',
    pattern: /https:\/\/hooks\.slack\.com\/services\/[A-Z0-9]+\/[A-Z0-9]+\/[A-Za-z0-9]+/,
    severity: 'MEDIUM',
    suggestion: 'Webhook URLs are credentials. Store in NOTIFICATION_WEBHOOK_URL env var.',
  },
  {
    name: 'Discord webhook URL',
    pattern: /https:\/\/discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_\-]+/,
    severity: 'MEDIUM',
    suggestion: 'Discord webhook URLs are credentials. Store in env var.',
  },
  // Generic .env-style literals in code
  {
    name: 'ENV-style secret literal in code',
    pattern: /\b(SECRET|TOKEN|KEY|PASSWORD|CREDENTIAL|PRIVATE)\s*=\s*['"`][^'"`$\s]{8,}['"`]/,
    severity: 'MEDIUM',
    suggestion: 'Looks like a secret value hardcoded in source. Use process.env instead.',
  },
  // SSH keys
  {
    name: 'SSH private key content',
    pattern: /-----BEGIN OPENSSH PRIVATE KEY-----/i,
    severity: 'HIGH',
    suggestion: 'SSH private keys must never be embedded in source files.',
  },
];

// Files that MUST always be blocked from agent writes (no exceptions)
const ALWAYS_BLOCKED_PATHS = [
  '.env',
  '.env.local',
  '.env.production',
  '.env.staging',
  '.env.test',
  'secrets.json',
  'service-account.json',
  'credentials.json',
  'keystore',
  'private.key',
  'id_rsa',
  'id_ed25519',
];

// Paths that are extra-sensitive — writes require explicit HIGH-confidence reason
const SENSITIVE_PATH_PATTERNS = [
  '/config/database',
  '/config/auth',
  '/config/secrets',
  'auth.config',
  'db.config',
  'secrets.config',
  'jwt.config',
  '.env.example',    // even example files — editing them might expose real values
];

// ---------------------------------------------------------------------------
// Core scan function (exported for use by writeFile gate)
// ---------------------------------------------------------------------------

/**
 * Scan `content` for credential patterns.
 * @param {string} content  - File content to scan
 * @param {string} filePath - Relative file path (for path-based rules)
 * @returns {{ findings: Finding[], blocked: boolean, reason: string|null }}
 */
export function guardCheck(content, filePath = '') {
  const findings = [];
  const lines    = content.split('\n');
  const fpLower  = filePath.toLowerCase().replace(/\\/g, '/');

  // 1. Check always-blocked filenames
  const basename = fpLower.split('/').pop() ?? '';
  if (ALWAYS_BLOCKED_PATHS.some(b => basename === b || fpLower.endsWith('/' + b))) {
    return {
      findings: [{
        rule:       'Protected file',
        severity:   'HIGH',
        line:       null,
        match:      filePath,
        suggestion: `"${filePath}" is in the protected file list. The agent must never write to this file.`,
      }],
      blocked: true,
      reason:  `File "${filePath}" is a protected credential file and cannot be written by the agent.`,
    };
  }

  // 2. Pattern scan — line by line
  lines.forEach((line, i) => {
    for (const rule of RULES) {
      if (rule.pattern.test(line)) {
        // Skip if it looks like a comment
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*')) continue;
        // Skip if it's referencing process.env (that's correct usage)
        if (/process\.env\.|getenv\(|os\.environ|ENV\[/.test(line)) continue;

        findings.push({
          rule:       rule.name,
          severity:   rule.severity,
          line:       i + 1,
          match:      line.trim().slice(0, 120),
          suggestion: rule.suggestion,
        });
      }
    }
  });

  // 3. Sensitive path warning
  const isSensitivePath = SENSITIVE_PATH_PATTERNS.some(p => fpLower.includes(p));
  if (isSensitivePath && findings.length === 0) {
    findings.push({
      rule:       'Sensitive file path',
      severity:   'LOW',
      line:       null,
      match:      filePath,
      suggestion: 'This is a sensitive config file. Verify no credentials are being introduced.',
    });
  }

  const highFindings = findings.filter(f => f.severity === 'HIGH');
  const blocked      = highFindings.length > 0;
  const reason       = blocked
    ? `Credential guard blocked write to "${filePath}": ${highFindings.map(f => f.rule).join(', ')}`
    : null;

  return { findings, blocked, reason };
}

// ---------------------------------------------------------------------------
// Tool definition & executor (agent-facing)
// ---------------------------------------------------------------------------
export const credentialGuardDefinition = {
  name: 'credential_guard',
  description:
    'Scan a file path or raw content snippet for hardcoded credentials, API keys, passwords, ' +
    'private keys, connection strings, and other secrets BEFORE a write. ' +
    'Returns a list of findings with line numbers, severity (HIGH/MEDIUM/LOW), and fix suggestions. ' +
    'HIGH-severity findings block the write entirely. ' +
    'Call this before every write_file when the file touches config, auth, or environment setup.',
  input_schema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Relative file path to audit (used for path-based rules + display).',
      },
      content: {
        type: 'string',
        description: 'File content to scan. If omitted, the current file at file_path is read.',
      },
    },
    required: ['file_path'],
  },
};

import fs   from 'fs';
import path from 'path';
import { config } from '../config.js';

export async function credentialGuard({ file_path, content }) {
  let source = content;
  if (!source) {
    const full = path.join(config.codebasePath, file_path);
    if (!fs.existsSync(full)) return { error: `File not found: ${file_path}` };
    source = fs.readFileSync(full, 'utf-8');
  }

  const result = guardCheck(source, file_path);
  const counts = result.findings.reduce((acc, f) => {
    acc[f.severity] = (acc[f.severity] ?? 0) + 1; return acc;
  }, {});

  return {
    file_path,
    blocked:       result.blocked,
    block_reason:  result.reason,
    finding_count: result.findings.length,
    by_severity:   counts,
    findings:      result.findings,
    verdict:       result.blocked
      ? '🚫 WRITE BLOCKED — hardcoded credentials detected'
      : (result.findings.length === 0
          ? '✅ CLEAN — no credential patterns found'
          : '⚠️  WARNING — review these findings before proceeding'),
  };
}
