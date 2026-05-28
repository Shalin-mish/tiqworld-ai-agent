import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { execSync } from 'child_process';
import { config } from '../config.js';
import { archiveWrite } from '../writeArchive.js';
import { logEvent } from '../activityLog.js';
import { guardCheck } from './credentialGuard.js';

export const writeFileDefinition = {
  name: 'write_file',
  description:
    'Write or update a file in the TIQ codebase. Shows a diff first and requires user approval before making any changes. Creates a git backup automatically before every write.',
  input_schema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description:
          'Relative path to the file inside TIQ codebase, e.g. "backend/src/controllers/auth.controller.js"',
      },
      new_content: {
        type: 'string',
        description: 'The complete new content to write to the file',
      },
      reason: {
        type: 'string',
        description: 'Brief explanation of what is being changed and why',
      },
    },
    required: ['file_path', 'new_content', 'reason'],
  },
};

function showDiff(oldContent, newContent) {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  const diff = [];

  // Context-aware diff: group consecutive changes with surrounding context lines
  const CONTEXT = 3;
  const changes = new Set();
  const maxLen  = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < maxLen; i++) {
    if (oldLines[i] !== newLines[i]) changes.add(i);
  }

  if (changes.size === 0) return '';

  let lastPrinted = -1;
  for (const idx of [...changes].sort((a, b) => a - b)) {
    const from = Math.max(0, idx - CONTEXT);
    if (from > lastPrinted + 1) diff.push(`@@ line ${from + 1} @@`);
    for (let i = Math.max(lastPrinted + 1, from); i < idx; i++) {
      diff.push(`  ${oldLines[i] ?? ''}`);
    }
    if (oldLines[idx] !== undefined) diff.push(`- ${oldLines[idx]}`);
    if (newLines[idx] !== undefined) diff.push(`+ ${newLines[idx]}`);
    const to = Math.min(maxLen - 1, idx + CONTEXT);
    for (let i = idx + 1; i <= to && !changes.has(i); i++) {
      diff.push(`  ${oldLines[i] ?? ''}`);
      lastPrinted = i;
    }
    lastPrinted = Math.max(lastPrinted, idx);
  }

  return diff.join('\n');
}

function askApproval(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

function gitCommit(fullPath, reason) {
  try {
    const relPath = path.relative(config.codebasePath, fullPath).replace(/\\/g, '/');
    execSync(
      `git add "${relPath}" && git commit -m "agent: ${reason}"`,
      { cwd: config.codebasePath, stdio: 'pipe' }
    );
    return { success: true, method: 'git' };
  } catch {
    try {
      const backupPath = fullPath + '.bak';
      fs.copyFileSync(fullPath, backupPath);
      return { success: true, method: 'file_copy', backup_path: backupPath };
    } catch {
      return { success: false };
    }
  }
}

// _approvalFn: optional async (filePath, diff, reason, isNew) => 'yes'|'no'
// Injected by web server; CLI falls back to readline.
// Paths the agent must never write to — regardless of who calls write_file.
// This is a hard block at the tool level, independent of scheduler safety gates.
// Patterns checked with includes() after normalising to lowercase forward-slashes.
// Deliberately no leading slash so both "src/tools/x" and "/src/tools/x" match.
const SELF_PROTECT_PATTERNS = [
  'tiqworld-ai-agent/src/',
  'src/tools/', 'src/agent.js', 'src/scheduler.js',
  'src/config.js', 'src/web/server.js', 'src/web/router.js',
  'ecosystem.config',
  'migrations/', 'migration.', '.migration.ts', '.migration.js',
  'schema.prisma', 'prisma/schema', 'seeds/', 'seeders/',
];

function isSelfProtected(filePath) {
  const fp = filePath.toLowerCase().replace(/\\/g, '/');
  return SELF_PROTECT_PATTERNS.some(p => fp.includes(p));
}

export async function writeFile({ file_path, new_content, reason, _user = 'unknown', _approvalFn = null }) {
  try {
    // ── Self-protection gate — highest priority ────────────────────────────
    if (isSelfProtected(file_path)) {
      logEvent({ user: _user, action: 'write_blocked_self_protect', detail: { file: file_path } });
      console.error(`\n🔒 SELF-PROTECT: Write blocked for "${file_path}" — agent source and DB migrations are immutable.`);
      return {
        status:     'blocked',
        file_path,
        blocked_by: 'self_protect',
        message:    `Write BLOCKED. "${file_path}" is in the agent self-protection list. Agent source files and DB migrations cannot be modified autonomously.`,
      };
    }

    // ── Credential Guard — block before anything else ──────────────────────
    const guard = guardCheck(new_content, file_path);
    if (guard.blocked) {
      logEvent({ user: _user, action: 'write_blocked_credential_guard', detail: { file: file_path, reason: guard.reason } });
      console.error(`\n🚫 CREDENTIAL GUARD: Write blocked for "${file_path}"\n   ${guard.reason}`);
      return {
        status:       'blocked',
        file_path,
        blocked_by:   'credential_guard',
        reason:       guard.reason,
        findings:     guard.findings,
        message:      `Write BLOCKED. Hardcoded credentials detected in "${file_path}". Fix them before retrying.`,
      };
    }
    if (guard.findings.length > 0) {
      console.warn(`\n⚠️  Credential Guard warning for "${file_path}": ${guard.findings.length} finding(s) — proceeding with caution.`);
    }
    // ── End credential guard ───────────────────────────────────────────────

    const fullPath = path.join(config.codebasePath, file_path);
    const isNewFile = !fs.existsSync(fullPath);
    const oldContent = isNewFile ? '' : fs.readFileSync(fullPath, 'utf-8');

    console.log('\n' + '═'.repeat(60));
    console.log(`📝 WRITE REQUEST: ${file_path}`);
    console.log(`   Reason: ${reason}`);
    console.log('─'.repeat(60));

    let diffText = '';
    if (isNewFile) {
      console.log('📄 NEW FILE — content preview:');
      console.log(new_content.slice(0, 500) + (new_content.length > 500 ? '\n... (truncated)' : ''));
      diffText = new_content;
    } else {
      diffText = showDiff(oldContent, new_content);
      if (!diffText) {
        return { status: 'skipped', reason: 'No changes detected — file already matches.' };
      }
      console.log('DIFF (- removed  + added):');
      console.log(diffText.slice(0, 1200) + (diffText.length > 1200 ? '\n... (truncated)' : ''));
    }

    console.log('═'.repeat(60));

    let answer;
    if (_approvalFn) {
      answer = await _approvalFn(file_path, diffText, reason, isNewFile, oldContent, new_content);
    } else {
      answer = await askApproval('\n⚠️  Apply this change? (yes/no): ');
    }

    if (answer !== 'yes' && answer !== 'y') {
      return {
        status: 'rejected',
        file_path,
        message: 'User rejected the change. No file was modified.',
      };
    }

    let backup = { success: false };
    if (!isNewFile) {
      backup = gitCommit(fullPath, reason);
    }

    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, new_content, 'utf-8');

    // Archive the before/after diff and log the action
    const archiveFile = archiveWrite({ user: _user, filePath: file_path, oldContent, newContent: new_content, reason });
    logEvent({ user: _user, action: 'write_file', detail: { file: file_path, reason, archive: archiveFile } });

    return {
      status: 'success',
      file_path,
      is_new_file: isNewFile,
      backup,
      archive: archiveFile,
      message: `File written successfully: ${file_path}`,
    };
  } catch (err) {
    return {
      error: err.message,
      suggestion: 'Check if the path is valid and you have write permissions',
    };
  }
}
