import fs from 'fs';
import path from 'path';

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.vite', 'coverage', 'logs',
  '.next', '__pycache__', 'target', 'vendor', '.nyc_output', '.cache',
  '.turbo', '.vercel', 'out', '.output',
]);

// Detect language, framework, test commands from any codebase root
export function discoverProject(codebasePath) {
  if (!codebasePath || typeof codebasePath !== 'string') {
    throw new Error('CODEBASE_PATH is not set. Add TIQ_CODEBASE_PATH to your .env file.');
  }
  if (!fs.existsSync(codebasePath)) {
    throw new Error(`CODEBASE_PATH does not exist: "${codebasePath}". Check your .env file.`);
  }
  const stat = fs.statSync(codebasePath);
  if (!stat.isDirectory()) {
    throw new Error(`CODEBASE_PATH is not a directory: "${codebasePath}".`);
  }

  const info = {
    name: path.basename(codebasePath),
    description: '',
    language: 'unknown',
    framework: 'unknown',
    isMonorepo: false,
    monorepoDirs: [],
    topLevelStructure: '',
    scripts: {},
    testCmd: null,
    buildCmd: null,
    lintCmd: null,
  };

  const has = (file) => fs.existsSync(path.join(codebasePath, file));

  // README — try root first, then common subdirs
  const README_CANDIDATES = ['README.md', 'backend/README.md', 'docs/README.md'];
  for (const rp of README_CANDIDATES) {
    try {
      const readme = fs.readFileSync(path.join(codebasePath, rp), 'utf-8');
      const desc = readme.split('\n').filter(l => l.trim()).slice(0, 20).join('\n');
      info.description = desc.length > 1500 ? desc.slice(0, 1500) + '…' : desc;
      break;
    } catch { /* try next */ }
  }

  // --- Node.js / TypeScript ---
  // Look for package.json at root, then 1 and 2 levels deep (handles repos like
  // tiq_workplace where services live at backend/<service>/package.json)
  const PKG_CANDIDATES = [
    'package.json',
    ...['backend', 'frontend', 'packages', 'apps', 'services'].flatMap(d => [
      `${d}/package.json`,
      ...(fs.existsSync(path.join(codebasePath, d)) ? (() => {
        try {
          return fs.readdirSync(path.join(codebasePath, d), { withFileTypes: true })
            .filter(e => e.isDirectory())
            .map(e => `${d}/${e.name}/package.json`);
        } catch { return []; }
      })() : []),
    ]),
  ];

  for (const pkgRel of PKG_CANDIDATES) {
    if (!has(pkgRel)) continue;
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(codebasePath, pkgRel), 'utf-8'));
      // Only use name/description from root package.json
      if (pkgRel === 'package.json') {
        if (pkg.name) info.name = pkg.name;
        if (!info.description && pkg.description) info.description = pkg.description;
        info.scripts = pkg.scripts || {};
        if (pkg.workspaces) {
          info.isMonorepo = true;
          const ws = Array.isArray(pkg.workspaces) ? pkg.workspaces : (pkg.workspaces.packages || []);
          info.monorepoDirs = ws.map(d => d.replace(/\/\*$/, '')).slice(0, 20);
        }
      }

      info.language = 'JavaScript/Node.js';
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

      if (allDeps.typescript || has('tsconfig.json') ||
          has(`${path.dirname(pkgRel)}/tsconfig.json`)) {
        info.language = 'TypeScript';
      }

      const FW_MAP = {
        fastify: 'Fastify', express: 'Express', '@hapi/hapi': 'Hapi', koa: 'Koa',
        '@nestjs/core': 'NestJS', next: 'Next.js', nuxt: 'Nuxt.js', remix: 'Remix',
        react: 'React', vue: 'Vue', svelte: 'Svelte', '@angular/core': 'Angular',
      };
      if (info.framework === 'unknown') {
        for (const [dep, name] of Object.entries(FW_MAP)) {
          if (allDeps[dep]) { info.framework = name; break; }
        }
      }

      if (!info.testCmd  && pkg.scripts?.test)  info.testCmd  = `npm --prefix ${path.dirname(pkgRel) || '.'} test`;
      if (!info.buildCmd && pkg.scripts?.build) info.buildCmd = `npm --prefix ${path.dirname(pkgRel) || '.'} run build`;
      if (!info.lintCmd  && pkg.scripts?.lint)  info.lintCmd  = `npm --prefix ${path.dirname(pkgRel) || '.'} run lint`;

      // Stop after first hit — we just need enough to detect language/framework
      if (info.language !== 'unknown') break;
    } catch { /* malformed JSON */ }
  }

  // --- Python ---
  if (has('requirements.txt') || has('pyproject.toml') || has('setup.py')) {
    info.language = 'Python';
    info.framework = 'Python';
    info.testCmd = 'pytest';
    if (has('manage.py')) { info.framework = 'Django'; }
    try {
      const content = has('pyproject.toml')
        ? fs.readFileSync(path.join(codebasePath, 'pyproject.toml'), 'utf-8')
        : '';
      if (content.includes('fastapi'))  info.framework = 'FastAPI';
      else if (content.includes('flask'))   info.framework = 'Flask';
      else if (content.includes('django'))  info.framework = 'Django';
    } catch {}
  }

  // --- Go ---
  if (has('go.mod')) {
    info.language = 'Go';
    info.framework = 'Go';
    info.testCmd = 'go test ./...';
    try {
      const gomod = fs.readFileSync(path.join(codebasePath, 'go.mod'), 'utf-8');
      const match = gomod.match(/^module (.+)/m);
      if (match) info.name = path.basename(match[1].trim());
      if (gomod.includes('gin-gonic/gin'))   info.framework = 'Gin';
      else if (gomod.includes('labstack/echo'))  info.framework = 'Echo';
      else if (gomod.includes('gofiber/fiber'))  info.framework = 'Fiber';
    } catch {}
  }

  // --- Rust ---
  if (has('Cargo.toml')) {
    info.language = 'Rust';
    info.framework = 'Rust';
    info.testCmd = 'cargo test';
    try {
      const cargo = fs.readFileSync(path.join(codebasePath, 'Cargo.toml'), 'utf-8');
      const match = cargo.match(/^name\s*=\s*"(.+)"/m);
      if (match) info.name = match[1];
    } catch {}
  }

  // --- Java / Kotlin ---
  if (has('pom.xml')) {
    info.language = 'Java';
    info.framework = 'Maven';
    info.testCmd = 'mvn test';
  } else if (has('build.gradle') || has('build.gradle.kts')) {
    info.language = 'Java/Kotlin';
    info.framework = 'Gradle';
    info.testCmd = './gradlew test';
  }

  // --- Ruby ---
  if (has('Gemfile')) {
    info.language = 'Ruby';
    info.framework = 'Ruby';
    info.testCmd = 'bundle exec rspec';
    if (has('config/routes.rb')) info.framework = 'Rails';
  }

  // --- PHP ---
  if (has('composer.json')) {
    info.language = 'PHP';
    info.framework = 'PHP';
    info.testCmd = './vendor/bin/phpunit';
    try {
      const composer = JSON.parse(fs.readFileSync(path.join(codebasePath, 'composer.json'), 'utf-8'));
      if (composer.require?.['laravel/framework']) info.framework = 'Laravel';
      if (composer.require?.['symfony/symfony'])   info.framework = 'Symfony';
    } catch {}
  }

  // --- Monorepo detection: scan 1 and 2 levels deep for package.json ---
  if (!info.isMonorepo) {
    try {
      const collected = [];
      const level1 = fs.readdirSync(codebasePath, { withFileTypes: true })
        .filter(e => e.isDirectory() && !IGNORE_DIRS.has(e.name) && !e.name.startsWith('.'));

      for (const d1 of level1) {
        if (fs.existsSync(path.join(codebasePath, d1.name, 'package.json'))) {
          collected.push(d1.name);
        } else {
          // One level deeper
          try {
            const level2 = fs.readdirSync(path.join(codebasePath, d1.name), { withFileTypes: true })
              .filter(e => e.isDirectory() && !IGNORE_DIRS.has(e.name) && !e.name.startsWith('.'));
            for (const d2 of level2) {
              if (fs.existsSync(path.join(codebasePath, d1.name, d2.name, 'package.json'))) {
                collected.push(`${d1.name}/${d2.name}`);
              }
            }
          } catch {}
        }
      }

      if (collected.length >= 2) {
        info.isMonorepo = true;
        info.monorepoDirs = collected.slice(0, 25);
      }
    } catch {}
  }

  // --- Top-level structure (2 levels deep, capped to keep system prompt small) ---
  try {
    const entries = fs.readdirSync(codebasePath, { withFileTypes: true });
    const dirs  = entries.filter(e => e.isDirectory() && !IGNORE_DIRS.has(e.name) && !e.name.startsWith('.')).map(e => e.name).sort().slice(0, 30);
    const files = entries.filter(e => !e.isDirectory() && !e.name.startsWith('.')).map(e => e.name).sort().slice(0, 20);
    const lines = [];
    for (const d of dirs) {
      lines.push(`  ${d}/`);
      try {
        const children = fs.readdirSync(path.join(codebasePath, d), { withFileTypes: true })
          .filter(e => !IGNORE_DIRS.has(e.name) && !e.name.startsWith('.'))
          .slice(0, 8)
          .map(e => `    ${e.name}${e.isDirectory() ? '/' : ''}`);
        lines.push(...children);
        const total = fs.readdirSync(path.join(codebasePath, d)).length;
        if (total > 8) lines.push(`    … (${total - 8} more)`);
      } catch {}
    }
    for (const f of files) lines.push(`  ${f}`);
    const raw = lines.join('\n');
    // Hard cap: keep system prompt manageable even on massive repos
    info.topLevelStructure = raw.length > 3000 ? raw.slice(0, 3000) + '\n  … (truncated)' : raw;
  } catch {}

  return info;
}

// Build a fully dynamic system prompt from discovered project info
export function buildSystemPrompt(info, { agentBranchWrites = false } = {}) {
  const keyScripts = ['start', 'dev', 'test', 'build', 'lint']
    .filter(k => info.scripts[k])
    .map(k => `  ${k}: ${info.scripts[k]}`)
    .join('\n') || '  (no scripts detected — check package.json or equivalent)';

  const verifyBlock = [
    info.testCmd  ? `- Test:  \`${info.testCmd}\`` : null,
    info.buildCmd ? `- Build: \`${info.buildCmd}\`` : null,
    info.lintCmd  ? `- Lint:  \`${info.lintCmd}\`` : null,
  ].filter(Boolean).join('\n') || '- Check project config for the correct verify commands';

  const monorepoBlock = info.isMonorepo
    ? `\n### Monorepo packages / services\n${info.monorepoDirs.map(d => `- ${d}/`).join('\n')}\nPer-service commands: \`npm --prefix <service> test\` / \`npm --prefix <service> run build\``
    : '';

  return `You are an expert AI developer agent. You have tool access to read, analyse, and safely modify the codebase you are pointed at. The project was auto-detected on startup.

## Target project
Name:      ${info.name}
Language:  ${info.language}
Framework: ${info.framework}${info.isMonorepo ? '\nType:      Monorepo' : ''}

## Project description
${info.description || '(No README found — start with list_files("") to explore)'}

## Directory structure (top 2 levels)
\`\`\`
${info.topLevelStructure || '(run list_files with directory="" to see structure)'}
\`\`\`
${monorepoBlock}

## Key scripts
\`\`\`
${keyScripts}
\`\`\`

## Verify commands
${verifyBlock}

---

## Tool groups

### Exploration
- list_files       — directory tree (pass "" for root)
- read_file        — file contents with auto-import resolution (depth 2)
- search_code      — regex keyword search across entire codebase
- recall_session   — files read + changes made this session

### Analysis — read-only, safe at any time
- health_check     — quick codebase snapshot
- full_scan        — runs ALL maintenance checks in parallel
- trace_error      — paste a stack trace → reads every file in the trace
- fix_error        — PREFERRED for fixing bugs. Returns confidence score + pipeline steps.
- map_dependencies — outgoing + incoming import graph for any file
- explain_route    — route path → traces router → middleware → controller → service
- find_todos       — TODO/FIXME/HACK/BUG scan with severity classification
- check_env_usage  — .env.example vs process.env calls diff
- detect_dead_code — files with zero importers
- schema_to_api    — CRUD completeness check for any model
- summarize_diff   — git diff (staged / unstaged / branch comparison)
- git_log          — commit history with filters
- lint_file        — ESLint structured results
- db_query         — read-only queries (SSM tunnel required)
- secret_scanner   — scan for accidentally committed API keys, tokens, passwords
- dep_updater      — check outdated npm packages, categorise by risk (patch/minor/major)

### Write + verification — always follow this exact sequence
1. git_backup    — checkpoint first, every time
2. show_diff     — preview the change
3. ${agentBranchWrites ? 'branch_write  — write to a feature branch (AGENT_BRANCH_WRITES=true). Returns branch name; push it and open a PR for human review.' : 'write_file   — write with human approval gate'}
4. run_command   — verify with the appropriate test/lint command
${agentBranchWrites ? '\n⚠️  AGENT_BRANCH_WRITES is ON — always use branch_write instead of write_file. Never push to main directly.' : ''}
## Decision trees

**"Fix X" / error / stack trace**
→ fix_error(error_text) → if confidence ≥ 55: git_backup → show_diff → ${agentBranchWrites ? 'branch_write' : 'write_file'} → run_command
→ If run_command exit_code ≠ 0: IMMEDIATELY call git_backup with action=restore to rollback.

**"Any secrets leaked?" / security audit**
→ secret_scanner → report findings with file:line citations

**"Check dependencies" / "any outdated packages"**
→ dep_updater → show by risk, give safe_update_command for patches

**"Explain X" / "How does Y work"**
→ read_file(Y) → map_dependencies(Y) if cross-file

**"What's wrong" / maintenance report**
→ full_scan

## Confidence score (from fix_error)
Always show: Confidence: 87/100 — HIGH — likely a targeted fix
If < 55, ask user to confirm before git_backup.

## Tool budget
Maximum 8 tool calls per user query. If you need more, stop and ask the user to narrow scope.

## What NOT to do
- User asks "full scan" → DO NOT call individual tools. Call full_scan once.
- User pastes a stack trace → Pick fix_error OR trace_error. Never both.
- write_file without git_backup + show_diff first → NEVER.
- Re-read a file mid-conversation → Check recall_session first.
- run_command fails after write_file → NEVER leave codebase in broken state. Rollback immediately.
- Structure is unknown → start with list_files("") before reading specific files.

## Behaviour rules
- Never guess at code — read the file first. Always cite path:lineNumber.
- For any write: git_backup → show_diff → write_file. Never skip.
- Prefer minimal targeted edits over large rewrites.
- db_query is for schema inspection only.

## Response format
- Lead with the answer.
- Cite every code reference as path/to/file:lineNumber.
- Use fenced code blocks with language tag.
- After write_file: state exactly what changed, suggest run_command to verify.`;
}
