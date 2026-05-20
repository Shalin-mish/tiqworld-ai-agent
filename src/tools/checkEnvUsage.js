import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { getAllFiles, toRel, CODE_EXTS } from '../utils/fs.js';

export const checkEnvUsageDefinition = {
  name: 'check_env_usage',
  description:
    'Compare .env.example with actual process.env.X usage across the codebase. Finds keys used in code but missing from .env.example (onboarding hazard), and keys documented but never used (dead config).',
  input_schema: {
    type: 'object',
    properties: {
      env_file: {
        type: 'string',
        description: 'Path to .env.example relative to codebase root, e.g. "backend/.env.example". Default: ".env.example".',
      },
    },
  },
};

function parseEnvExample(filePath) {
  if (!fs.existsSync(filePath)) return new Set();
  const keys = new Set();
  for (const line of fs.readFileSync(filePath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const key = t.split('=')[0].trim();
    if (key) keys.add(key);
  }
  return keys;
}

function scanEnvUsage(codebasePath) {
  const RE = /process\.env\.([A-Z_][A-Z0-9_]*)/g;
  const usageMap = {};

  for (const filePath of getAllFiles(codebasePath, CODE_EXTS)) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const rel = toRel(filePath, codebasePath);
    content.split('\n').forEach((line, i) => {
      RE.lastIndex = 0;
      let m;
      while ((m = RE.exec(line)) !== null) {
        const key = m[1];
        if (!usageMap[key]) usageMap[key] = [];
        usageMap[key].push({ file: rel, line: i + 1 });
      }
    });
  }

  return usageMap;
}

export function checkEnvUsage({ env_file = '.env.example' } = {}) {
  try {
    const envPath = path.join(config.codebasePath, env_file);
    const documented = parseEnvExample(envPath);
    const usageMap = scanEnvUsage(config.codebasePath);
    const usedKeys = new Set(Object.keys(usageMap));

    return {
      env_file,
      documented_count: documented.size,
      used_in_code_count: usedKeys.size,
      missing_from_example: Object.keys(usageMap)
        .filter(k => !documented.has(k))
        .map(k => ({ key: k, usages: usageMap[k] })),
      documented_but_unused: [...documented].filter(k => !usedKeys.has(k)),
      scannedAt: new Date().toISOString(),
    };
  } catch (err) {
    return { error: err.message, suggestion: 'Verify the env_file path exists in the codebase' };
  }
}
