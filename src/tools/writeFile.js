import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { execSync } from 'child_process';
import { config } from '../config.js';
import { archiveWrite } from '../writeArchive.js';
import { logEvent } from '../activityLog.js';

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
  const maxLen = Math.max(oldLines.length, newLines.length);
  const diff = [];

  for (let i = 0; i < maxLen; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];
    if (oldLine === undefined) {
      diff.push(`+ ${newLine}`);
    } else if (newLine === undefined) {
      diff.push(`- ${oldLine}`);
    } else if (oldLine !== newLine) {
      diff.push(`- ${oldLine}`);
      diff.push(`+ ${newLine}`);
    }
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
export async function writeFile({ file_path, new_content, reason, _user = 'unknown', _approvalFn = null }) {
  try {
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
