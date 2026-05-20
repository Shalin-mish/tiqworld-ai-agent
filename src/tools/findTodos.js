import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { getAllFiles, toRel, CODE_EXTS } from '../utils/fs.js';

export const findTodosDefinition = {
  name: 'find_todos',
  description:
    'Scan the TIQ codebase for TODO, FIXME, HACK, DEPRECATED, BUG, and OPTIMIZE comments. Returns results grouped by file with line numbers and severity (critical / warning / info). Essential for surfacing technical debt.',
  input_schema: {
    type: 'object',
    properties: {
      directory: {
        type: 'string',
        description: 'Limit scan to this subdirectory e.g. "backend/src". Omit to scan everything.',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Filter to specific tags e.g. ["FIXME", "BUG"]. Omit for all tags.',
      },
    },
  },
};

const TAG_SEVERITY = {
  FIXME: 'critical', BUG: 'critical',
  HACK: 'warning',   DEPRECATED: 'warning',
  TODO: 'info',      OPTIMIZE: 'info', XXX: 'info', NOTE: 'info',
};

const TODO_RE = /\b(TODO|FIXME|HACK|DEPRECATED|BUG|OPTIMIZE|XXX|NOTE)\b[:\s]*(.*)/i;

export function findTodos({ directory = '', tags = [] } = {}) {
  try {
    const searchPath = path.join(config.codebasePath, directory);
    if (!fs.existsSync(searchPath)) {
      return { error: `Directory not found: ${directory}`, suggestion: 'Use list_files to explore' };
    }

    const filterSet = new Set(tags.map(t => t.toUpperCase()));
    const allFiles = getAllFiles(searchPath, new Set([...CODE_EXTS, '.md']));
    const byFile = {};
    const bySeverity = { critical: 0, warning: 0, info: 0 };
    let total = 0;

    for (const filePath of allFiles) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const rel = toRel(filePath, config.codebasePath);
      const hits = [];

      content.split('\n').forEach((line, i) => {
        const m = TODO_RE.exec(line);
        if (!m) return;
        const tag = m[1].toUpperCase();
        if (filterSet.size && !filterSet.has(tag)) return;
        const severity = TAG_SEVERITY[tag] ?? 'info';
        hits.push({ line: i + 1, tag, severity, text: (m[2] || line).trim() });
        bySeverity[severity]++;
        total++;
      });

      if (hits.length) byFile[rel] = hits;
    }

    return {
      total,
      files_affected: Object.keys(byFile).length,
      by_severity: bySeverity,
      scannedAt: new Date().toISOString(),
      results: byFile,
    };
  } catch (err) {
    return { error: err.message, suggestion: 'Check directory path' };
  }
}
