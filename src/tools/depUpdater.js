import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';
import { config } from '../config.js';

export const depUpdaterDefinition = {
  name: 'dep_updater',
  description: 'Check for outdated npm packages. Categorises each as patch (safe to update), minor (review recommended), or major (breaking change likely). Returns safe update command.',
  input_schema: {
    type: 'object',
    properties: {
      directory: { type: 'string', description: 'Package root directory (defaults to TIQ codebase root)' },
    },
    required: [],
  },
};

export async function depUpdater({ directory } = {}) {
  const cwd = directory || config.codebasePath;

  // Read package.json to know which packages are direct deps
  let directDeps = new Set();
  try {
    const pkg = JSON.parse(readFileSync(path.join(cwd, 'package.json'), 'utf-8'));
    directDeps = new Set([
      ...Object.keys(pkg.dependencies    ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ]);
  } catch { /* fallback: treat all as direct */ }

  let raw = '{}';
  try {
    raw = execSync('npm outdated --json', { cwd, encoding: 'utf-8', timeout: 30000 });
  } catch (e) {
    // npm outdated exits non-zero when packages ARE outdated — output is still valid JSON
    raw = e.stdout || '{}';
  }

  let outdated;
  try { outdated = JSON.parse(raw); }
  catch { return { error: 'Could not parse npm outdated output', raw }; }

  const packages = Object.entries(outdated).map(([name, info]) => {
    const current = info.current ?? '0.0.0';
    const latest  = info.latest  ?? current;
    const [cMaj, cMin, cPatch] = current.replace(/[^0-9.]/g, '').split('.').map(Number);
    const [lMaj, lMin, lPatch] = latest.replace(/[^0-9.]/g, '').split('.').map(Number);

    let risk;
    if (lMaj > cMaj)        risk = 'major';  // likely breaking
    else if (lMin > cMin)   risk = 'minor';  // new features
    else                    risk = 'patch';  // bug fixes only — safe

    return {
      name,
      current,
      wanted:  info.wanted ?? current,
      latest,
      risk,
      direct:  directDeps.size === 0 || directDeps.has(name),
    };
  });

  const byRisk = {
    patch: packages.filter(p => p.risk === 'patch'),
    minor: packages.filter(p => p.risk === 'minor'),
    major: packages.filter(p => p.risk === 'major'),
  };

  const safeNames = byRisk.patch.map(p => p.name);

  return {
    ok: true,
    total_outdated: packages.length,
    packages,
    by_risk: byRisk,
    safe_update_command: safeNames.length
      ? 'npm update ' + safeNames.join(' ')
      : null,
    summary: packages.length === 0
      ? 'All packages are up to date.'
      : `${packages.length} outdated — ${byRisk.patch.length} patch (safe), ${byRisk.minor.length} minor (review), ${byRisk.major.length} major (breaking).`,
  };
}
