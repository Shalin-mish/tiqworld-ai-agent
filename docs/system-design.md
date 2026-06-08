# TIQ World AI Agent — System Design & Documentation

**Version:** 5.0 (v1.0.0 — All gaps closed + architectural hardening)
**Last Updated:** June 8, 2026
**Purpose:** Claude-powered AI agent for autonomous codebase maintenance, code review, and monitoring — integrated with the TIQ World development workflow.

---

## 1. What Is This?

A **Claude-powered AI agent** (AWS Bedrock) that functions as a senior software engineer on the TIQ World team.

Rather than a developer manually reviewing code, writing documentation, checking git history, querying the database, or monitoring for production issues — this agent does it automatically on demand or on a scheduled basis.

---

## 2. Architecture (Current — v5.0)

```
┌─────────────────────────────────────────────────────────────┐
│                    User (Web UI / CLI)                       │
│                  http://localhost:3001                       │
└────────────────────────┬────────────────────────────────────┘
                         │ query / chat (SSE)
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              Express Web Server (src/web/server.js)          │
│   SSE streaming │ session management │ OAuth │ rate limiting │
│   Chat timeout (AbortController, 10 min default)             │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│               Dispatcher (src/dispatcher.js)                 │
│   classify query → task type (query/review/maintenance)      │
│   → restrict tool set for this task type                     │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│            Agent Core (src/agent.js)                         │
│   runAgent() → Bedrock ConverseCommand loop                  │
│   Claude decides which tools to call                         │
│   Tool budget: 8 (user queries), 20 (maintenance)           │
│   Result truncation: 3000 chars per tool result              │
│   Prompt caching: system prompt cached on Bedrock            │
│   Token usage: in/out/cacheRead/cacheWrite tracked + emitted │
└────────┬──────────┬──────────┬──────────┬───────────────────┘
         │          │          │          │
         ▼          ▼          ▼          ▼
   ┌──────────┐ ┌────────┐ ┌──────┐ ┌──────────┐
   │ 27 Tools │ │ Write  │ │  DB  │ │ Monitor  │
   │(read-only│ │ Gates  │ │Query │ │  Tools   │
   │ + write) │ │        │ │      │ │          │
   └──────────┘ └────────┘ └──────┘ └──────────┘
                     │
          ┌──────────┴──────────┐
          │   FOUR-LAYER GATE   │
          │ 1. self_protect     │  ← src/safetyPatterns.js
          │ 2. credential_guard │    (single source of truth)
          │ 3. high_risk check  │
          │ 4. human approval   │
          └─────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│           Scheduler (src/scheduler.js)                       │
│   Night 2am IST: deep scan + auto-fix (confidence ≥ 80)     │
│   Day 9am IST: light scan + health monitor + notify          │
│   2h hard timeout via AbortController                        │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. All 27 Tools

### Exploration (4)
| Tool | What it does |
|------|-------------|
| `list_files` | List directory contents by glob pattern |
| `read_file` | Read file with import resolution |
| `search_code` | Regex or text search across codebase |
| `recall_session` | This session's files read, tool calls, writes |

### Analysis (14)
| Tool | What it does |
|------|-------------|
| `health_check` | File counts, TODOs, git status, env gaps — one call |
| `full_scan` | All checks in parallel — the "opening move" |
| `trace_error` | Parse stack trace → read all files in trace |
| `fix_error` | Confidence-scored bug fix pipeline (0–100) |
| `map_dependencies` | Import graph: who imports what |
| `explain_route` | Route → middleware → controller → service chain |
| `find_todos` | TODO/FIXME/BUG scan with severity |
| `check_env_usage` | `.env.example` vs `process.env` diff |
| `detect_dead_code` | Files with zero importers |
| `schema_to_api` | Model → CRUD completeness check |
| `summarize_diff` | Git diff summarization |
| `git_log` | Commit history, scoped to file or date |
| `lint_file` | ESLint structured output (file:line:rule) |
| `db_query` | Read-only PostgreSQL SELECT via SSM tunnel |

### Security + Deps (3)
| Tool | What it does |
|------|-------------|
| `secret_scanner` | Scan for leaked API keys, passwords, private keys |
| `dep_updater` | npm outdated by risk: patch/minor/major |
| `credential_guard` | Scan file content for hardcoded credentials before write |

### Monitoring (1)
| Tool | What it does |
|------|-------------|
| `health_monitor` | HTTP probes + log anomaly scan + process vitals |

### Write + Verify (5)
| Tool | What it does |
|------|-------------|
| `git_backup` | Create/restore checkpoint branch |
| `show_diff` | Display context-aware diff before writing |
| `write_file` | Write with approval gate + four safety layers (dev/staging) |
| `branch_write` | PR-based write: commits to feature branch, never touches main (production-safe) |
| `run_command` | Execute from exact-match allowlist only; `_timeoutMs` configurable |

---

## 4. Safety Architecture

### Safety Patterns — Single Source of Truth (`src/safetyPatterns.js`)

`SELF_PROTECT_PATTERNS` and `HIGH_RISK_PATTERNS` were previously duplicated across three files and had already drifted apart. Consolidated into `src/safetyPatterns.js` — imported by `writeFile.js`, `branchWrite.js`, and `scheduler.js`. Adding a new protected path requires one edit in one place.

### Agent-Side (Tool Gates)

Every write goes through **four sequential gates**:

```
write_file / branch_write called
      │
      ▼
[Gate 1] self_protect  (src/safetyPatterns.js → isSelfProtected)
      Is this agent source / migration / schema.prisma?
      YES → BLOCKED immediately, logged
      │
      ▼
[Gate 2] credential_guard
      Does content contain hardcoded secrets?
      HIGH severity → BLOCKED, agent told why
      MEDIUM/LOW → warning logged, proceed
      │
      ▼
[Gate 3] HIGH_RISK_PATTERNS (scheduler only)
      Is this a high-risk file (routes, models, auth, config)?
      YES → skipped by safety gate, logged
      │
      ▼
[Gate 4] human approval (web UI) / readline (CLI)
      User sees diff → approves or rejects
      5-minute timeout → auto-reject
```

### Claude Code Guardrails (External — settings.json Hooks)

An additional safety layer runs **outside the agent process** at the Claude Code session level:

| Hook | What it blocks |
|------|---------------|
| `Bash` — main push guard | `git push origin main/master/production` |
| `Bash` — destructive guard | `git reset --hard`, `git push --force` |
| `mcp__postgres-tiqworld-dev__query` | UPDATE, DELETE, INSERT, DROP, TRUNCATE, ALTER |
| `mcp__github__push_files` | Direct push to main/master/production branches |
| `mcp__github__create_or_update_file` | Direct commit to main/master/production branches |

### Self-Protect List (Gate 1 — absolute, from `src/safetyPatterns.js`)
- `src/tools/`, `src/agent.js`, `src/scheduler.js`, `src/config.js`
- `src/web/server.js`, `src/web/router.js`, `ecosystem.config`
- `migrations/`, `migration.*`, `schema.prisma`, `prisma/schema`
- `seeds/`, `seeders/`

### Credential Guard Rules (Gate 2)
Blocks writes containing: AWS Access Key ID, PEM/SSH private keys, hardcoded password assignments, DB connection strings with credentials, JWT secret literals, GCP service account JSON, Azure storage keys, Slack/Discord webhook URLs in source, generic API key/token hardcoded values.

Smart exclusions: `process.env.X` usage, comment lines, test mock values.

### Command Approval (run_command)
Exact allowlist — prefix match is insufficient:
```
Allowed: npm test | npm run test:* | npx vitest | npx jest | npx eslint
Monorepo: npm --prefix <service> test
Python: pytest | python -m pytest
Go: go test ./...   Rust: cargo test   Java: ./gradlew test | mvn test
Git read-only: git status | git log | git diff
Everything else: BLOCKED
```

Per-call timeout configurable via `_timeoutMs` (default 300s, scheduler's `runTests()` capped at 120s).

---

## 5. Autonomy Model

Agent is **semi-autonomous** — two distinct modes:

### Fully Automated (no human needed)
- Routine maintenance: lint fixes, dead code cleanup, env gap detection, TODO tracking
- Small safe improvements: code quality, formatting, missing null checks
- Scheduled: night deep scan (2am) + light check (9am daily)
- Auto-fix only if `confidence ≥ 80` AND change is isolated (single file, low risk)

### Human-Instructed Only (dev team must trigger)
- Feature addition — never autonomous
- Any change that touches multiple files
- Any change to routes, models, auth, or core business logic
- Database schema changes
- Any push to main/production branch

---

## 6. Maintenance Scheduler

### Cron Schedule (Asia/Kolkata timezone)

| Schedule | Default | Task |
|----------|---------|------|
| `0 2 * * *` | 2:00 AM IST | Night deep maintenance |
| `0 9 * * *` | 9:00 AM IST | Day light scan (healthCheck + healthMonitor only) |
| `0 9 * * 1` | Monday 9:00 AM IST | Weekly Slack report |

### Timing Safety Relationships

```
Night (2:00 AM) + 2h hard abort → ends by 4:00 AM
Day scan (9:00 AM) ──────────────── 5h safe gap ✓
runTests() cap: 120s × 3 = 6 min max ✓
runCommand via agent: 300s × 20 budget = 100 min (within 2h) ✓
fileLock TTL: 10 min < maintenance 120 min ✓
Bedrock per-call: 180s × 3 retries + backoff ≈ 554s worst case ✓
Approval auto-reject: 5 min ✓
```

### Night Deep Maintenance Flow

```
fullScan() — parallel: lint + todos + env + dead code + git log + secrets + deps
    │
    ▼
runTests('npm run test:unit') — pre-fix baseline [120s cap]
    If failing → skip auto-fix (don't compound broken state)
    │
    ▼
For each issue where confidence ≥ 80:
    git_backup → show_diff → write_file → run_command (verify)
    If tests fail after write → git_backup restore → stop
    │
    ▼
saveMaintenanceReport() → logs/maintenance-{ISO}.json
notify() → in-app + Slack/Discord webhook
```

### Maintenance Timeout (AbortController chain)
1. `setTimeout` fires at `MAINTENANCE_TIMEOUT_MS` (default 2h)
2. Calls `controller.abort()` on the maintenance `AbortController`
3. Linked into every Bedrock call — the in-flight call is immediately cancelled
4. `runAgent()` throws `"Maintenance run aborted by timeout"`
5. Scheduler catches, marks run done, releases all file locks

---

## 7. Health Monitor

Three signal layers:

1. **HTTP Synthetic Probes** — GET each URL in `HEALTH_MONITOR_URLS`, check status code + response time (>3s = warn)
2. **Log Anomaly Scan** — scans `logs/activity.jsonl` for ERROR lines in the last N minutes
3. **Process Vitals** — Node heap used/total, RSS, uptime, event-loop lag

**Scoring:** 0–100. HEALTHY = 100. DEGRADED = warnings (70–90). UNHEALTHY = any fail (≤75).

---

## 8. Web UI

Single-page app at `http://localhost:3001`. No build step — one HTML file.

### Layout (3-column)
```
┌─────────────────┬───────────────────────┬──────────────────┐
│  Left Sidebar   │     Chat Area         │  Right Sidebar   │
│                 │                       │  (collapsed      │
│  Quick Actions  │  Message stream       │   by default)    │
│  ⚡ Maintenance │  + thinking animation │                  │
│  🔍 Full Scan   │  + tool call chips    │  Tabs:           │
│  📊 Admin       │  + copy buttons       │  ✅ Approve      │
│  ⌘ Palette     │                       │  ✏️ Writes        │
│  🗑 Clear       │  Input (SSE stream)   │  🔧 Tools        │
│                 │  SSE timeout: 10 min  │  ⚡ Maint        │
│  Session Stats  │                       │  📊 Admin        │
│  Token usage    │  ← bilateral ‹/›      │                  │
│  Memory         │    toggle arrows →    │  Platform Health │
└─────────────────┴───────────────────────┴──────────────────┘
```

### Token Tracking (right sidebar)
Per-session: `in`, `out`, `cacheRead`, `cacheWrite` — accumulated across all turns. Forwarded to UI via `token_usage` SSE events from `agent.js`.

---

## 9. Data Persistence

All logs are files in `logs/` (gitignored):

| File | Content |
|------|---------| 
| `logs/activity.jsonl` | All events — 64KB tail-read (not full file load) |
| `logs/maintenance-{ISO}.json` | Per-run maintenance reports |
| `logs/notifications.json` | In-app notifications (with read state) |
| `logs/sessions/{id}.json` | Session snapshots — 24h TTL |
| `logs/archives/{ISO}___{path}.diff` | Before/after for every file write |

---

## 10. Configuration (`.env`)

| Variable | Default | What |
|----------|---------|------|
| `AWS_REGION` | `us-east-2` | Bedrock region |
| `AWS_ACCESS_KEY_ID` | — | Required |
| `AWS_SECRET_ACCESS_KEY` | — | Required |
| `CODEBASE_PATH` | `process.cwd()` | Target codebase |
| `DB_URL` | — | PostgreSQL via SSM tunnel |
| `WEB_PORT` | `3001` | Web server port |
| `ENABLE_PROMPT_CACHE` | `true` | Bedrock prompt caching (~90% token reduction on system prompt) |
| `BEDROCK_TIMEOUT_MS` | `180000` | Per-call timeout (3 min) |
| `CHAT_TIMEOUT_MS` | `600000` | Overall SSE connection timeout (10 min) |
| `MAINTENANCE_TIMEOUT_MS` | `7200000` | 2h hard ceiling for night maintenance |
| `NIGHT_MAINTENANCE_CRON` | `0 2 * * *` | 2am IST daily |
| `DAY_LIGHT_SCAN_CRON` | `0 9 * * *` | 9am IST daily (healthCheck + healthMonitor only) |
| `AUTO_FIX_ENABLED` | `true` | Enable autonomous fixes |
| `AUTO_FIX_MIN_CONFIDENCE` | `80` | Minimum confidence for auto-fix |
| `AGENT_BRANCH_WRITES` | `false` | When true: agent uses branch_write (PR flow) instead of write_file |
| `NOTIFICATION_WEBHOOK_URL` | — | Slack or Discord webhook |
| `HEALTH_MONITOR_URLS` | — | Comma-separated URLs to probe |
| `GITHUB_CLIENT_ID` | — | Optional GitHub OAuth |
| `GITHUB_CLIENT_SECRET` | — | Optional GitHub OAuth |
| `SESSION_SECRET` | `change-me` | Express session secret |

---

## 11. What the Agent Does NOT Do (Hard Limits)

| Out of Scope | Why |
|---|---|
| Modify its own source code | Self-protect gate — absolute block |
| Touch DB migrations / schema.prisma | Migration guard — absolute block |
| Write hardcoded credentials to any file | Credential guard — absolute block |
| Auto-push to remote git | Human must always push |
| Push directly to main/master/production | Claude Code hook — blocked before tool runs |
| Run deploys or build:prod | Not in exact command allowlist |
| Auto-fix when pre-existing tests fail | Don't compound a broken state |
| Auto-fix with confidence < 80% | Too risky for production code |
| Run UPDATE/DELETE/INSERT on database | DB query hook — SELECT only |
| Run in cluster mode (PM2 instances > 1) | fileLock and activeSseSessions are in-memory |

---

## 12. All Issues Fixed (v5.0 — June 8, 2026)

### From audit (C=Critical, H=High, M=Medium, L=Low)

| Issue | Fix | File |
|-------|-----|------|
| C1: Night maintenance perpetual failure (pytest detection) | Hardcode `npm run test:unit` in scheduler | `scheduler.js` |
| C2: `token_usage` events never emitted to UI | Added `onEvent?.()` call in `agent.js` | `agent.js` |
| C3: `result.stdout` always undefined in scheduler | Added `stdout` alias in `runCommand` returns | `runCommand.js` |
| C4: `activityLog` full file read (memory risk) | 64KB tail-read with fallback | `activityLog.js` |
| H1: Double notifications on day scan | Removed `notify()` from `healthMonitor.js` | `healthMonitor.js` |
| H2: Session GC evicts live SSE sessions | `activeSseSessions` Set + GC guard | `router.js` |
| H3: Stale file locks from crashed runs | 10-min auto-expiry in `acquireLock` | `fileLock.js` |
| H4: Dispatcher `/g` flag `lastIndex` bleed | Fresh regex per `classify()` call | `dispatcher.js` |
| H5: `branchWrite` dirty tree on commit failure | try/catch + rollback on failure | `branchWrite.js` |
| M1: `ENABLE_PROMPT_CACHE` default false | Fixed to `true` in `.env.example` | `.env.example` |
| M2: Duplicate notification routes | Removed duplicates from `server.js` | `server.js` |
| M3: `runCommand` timeout too loose for maintenance | `_timeoutMs` param + 120s cap | `runCommand.js`, `scheduler.js` |
| M4: Safety patterns duplicated across 3 files | `src/safetyPatterns.js` single source | `safetyPatterns.js` (new) |
| M5: `cacheWrite` missing from token struct | Added to struct + accumulation | `router.js`, `sessionPersistence.js` |
| M6: No SSE timeout | `chatAbort` + `CHAT_TIMEOUT_MS` | `router.js`, `config.js` |
| M7: `prReview.js` lintFile without src/ check | Check exists before call | `prReview.js` |
| L1: Dispatcher property name `re` unclear | Renamed to `keywords` | `dispatcher.js` |
| L2: `"update the config"` scored as query | Added `update` to maintenance keywords | `dispatcher.js` |
| Arch: PM2 instances not enforced | `instances: 1, exec_mode: 'fork'` | `ecosystem.config.cjs` |
| Arch: `AGENT_BRANCH_WRITES` flag dead | Wired end-to-end | `config.js`, `agent.js`, `projectDiscovery.js` |

---

## 13. Technology Stack

| Component | Technology |
|-----------|-----------| 
| AI Model | Claude Sonnet 4.5 (AWS Bedrock, `us-east-2`) |
| Runtime | Node.js 18+ (ES modules) |
| Web server | Express 4 + SSE |
| Frontend | Single HTML file (no build) |
| DB | PostgreSQL read-only via SSM tunnel (localhost:5433) |
| Scheduling | `node-cron` (Asia/Kolkata timezone) |
| Session persistence | JSONL snapshots in `logs/sessions/` — 24h TTL |
| Testing | Vitest (unit, 158 tests) + Playwright (e2e, 28 tests) |
| CI | GitHub Actions (independent test judge) |
| Process manager | PM2 — fork mode only (`instances: 1`) |
| Dev environment guardrails | Claude Code hooks (settings.json) |

---

## 14. Running the Agent

```bash
npm install
cp .env.example .env
# Fill in AWS credentials and CODEBASE_PATH

# Web UI (recommended)
npm run web
# → http://localhost:3001

# Development (auto-reload)
npm run web:dev

# CLI (interactive terminal)
npm run start

# Run tests
npm run test:unit       # 158 unit tests (no server needed)
npx playwright test     # 28 e2e tests (requires server on port 3001)

# Always-on with PM2 (fork mode enforced)
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup
```

---

## 15. Deployment Checklist (Before Pointing at Production Codebase)

- [ ] `CODEBASE_PATH` set to real tiq_workplace path
- [ ] `DB_URL` set to production read-only DB user
- [ ] `AUTO_FIX_ENABLED=false` for first week (observe-only mode)
- [ ] `NOTIFICATION_WEBHOOK_URL` set to team Slack channel
- [ ] `HEALTH_MONITOR_URLS` set to real platform endpoints
- [ ] `SESSION_SECRET` changed from default
- [ ] `AGENT_BRANCH_WRITES=true` for production (all agent writes go via PR)
- [ ] `GITHUB_CLIENT_ID/SECRET` set (optional but recommended for audit trail)
- [ ] PM2 started with `ecosystem.config.cjs` — verify `instances: 1` in `pm2 status`
- [ ] First week: review every maintenance report manually
- [ ] After week 1: enable `AUTO_FIX_ENABLED=true` with `AUTO_FIX_MIN_CONFIDENCE=80`
- [ ] Claude Code hooks verified active (`settings.json` PreToolUse hooks)
- [ ] Confirm agent only has access to dev/feature branches — never main directly

---

*For daily progress log, see: `docs/devlog.md`*
*For full technical reference, see: `docs/TECHNICAL.md`*
