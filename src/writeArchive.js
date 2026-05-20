import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT        = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ARCHIVE_DIR = path.join(ROOT, 'logs', 'writes');

fs.mkdirSync(ARCHIVE_DIR, { recursive: true });

export function archiveWrite({ user, filePath, oldContent, newContent, reason }) {
  const ts       = new Date().toISOString().replace(/[:.]/g, '-');
  const safeName = filePath.replace(/[\/\\]/g, '__');
  const fileName = `${ts}__${safeName}.diff`;
  const fullPath = path.join(ARCHIVE_DIR, fileName);

  const content = [
    `File:   ${filePath}`,
    `User:   ${user}`,
    `Reason: ${reason}`,
    `Time:   ${new Date().toISOString()}`,
    '',
    '=== BEFORE ===',
    oldContent || '(new file)',
    '',
    '=== AFTER ===',
    newContent,
  ].join('\n');

  fs.writeFileSync(fullPath, content, 'utf-8');
  return fileName;
}

export function listArchives(limit = 50) {
  const files = fs.readdirSync(ARCHIVE_DIR)
    .filter(f => f.endsWith('.diff'))
    .sort()
    .reverse()
    .slice(0, limit);

  return files.map(f => {
    const lines = fs.readFileSync(path.join(ARCHIVE_DIR, f), 'utf-8').split('\n');
    return {
      filename: f,
      file:     lines[0]?.replace('File:   ', '') ?? '?',
      user:     lines[1]?.replace('User:   ', '') ?? '?',
      reason:   lines[2]?.replace('Reason: ', '') ?? '?',
      time:     lines[3]?.replace('Time:   ', '') ?? '?',
    };
  });
}
