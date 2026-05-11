import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { execSync } from 'child_process';
import { config } from '../config.js';

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

function gitBackup(fullPath) {
  try {
    const relPath = path.relative(config.codebasePath, fullPath).replace(/\\/g, '/');
    execSync(
      `git add "${relPath}" && git commit -m "backup: before AI write to ${path.basename(fullPath)}"`,
      { cwd: config.codebasePath, stdio: 'pipe' }
    );
    return { success: true, method: 'git' };
  } catch {
    try {
      const backupPath = fullPath + '.bak';
      fs.copyFileSync(fullPath, backupPath);
      return { success: true, method: 'file_copy', backup_path: backupPath + '.bak' };
    } catch {
      return { success: false };
    }
  }
}

export async function writeFile({ file_path, new_content, reason }) {
  try {
    const fullPath = path.join(config.codebasePath, file_path);
    const isNewFile = !fs.existsSync(fullPath);
    const oldContent = isNewFile ? '' : fs.readFileSync(fullPath, 'utf-8');

    console.log('\n' + '═'.repeat(60));
    console.log(`📝 WRITE REQUEST: ${file_path}`);
    console.log(`   Reason: ${reason}`);
    console.log('─'.repeat(60));

    if (isNewFile) {
      console.log('📄 NEW FILE — content preview:');
      console.log(
        new_content.slice(0, 500) + (new_content.length > 500 ? '\n... (truncated)' : '')
      );
    } else {
      const diff = showDiff(oldContent, new_content);
      if (!diff) {
        return { status: 'skipped', reason: 'No changes detected — file already matches.' };
      }
      console.log('DIFF (- removed  + added):');
      console.log(diff.slice(0, 1200) + (diff.length > 1200 ? '\n... (truncated)' : ''));
    }

    console.log('═'.repeat(60));

    const answer = await askApproval('\n⚠️  Apply this change? (yes/no): ');

    if (answer !== 'yes' && answer !== 'y') {
      return {
        status: 'rejected',
        file_path,
        message: 'User rejected the change. No file was modified.',
      };
    }

    let backup = { success: false };
    if (!isNewFile) {
      backup = gitBackup(fullPath);
    }

    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, new_content, 'utf-8');

    return {
      status: 'success',
      file_path,
      is_new_file: isNewFile,
      backup,
      message: `File written successfully: ${file_path}`,
    };
  } catch (err) {
    return {
      error: err.message,
      suggestion: 'Check if the path is valid and you have write permissions',
    };
  }
}
