# TIQ World AI Agent — System Design & Documentation

**Version:** 4.0 (v1.0.0 — All gaps closed)
**Last Updated:** June 1, 2026
**Purpose:** Claude-powered AI agent for autonomous codebase maintenance, code review, and monitoring — integrated with the TIQ World development workflow.

---

## 1. What Is This?

A **Claude-powered AI agent** (AWS Bedrock) that functions as a senior software engineer on the TIQ World team.

Rather than a developer manually reviewing code, writing documentation, checking git history, querying the database, or monitoring for production issues — this agent does it automatically on demand or on a scheduled basis.

---

## 2. Architecture (Current — v4.0)

```
┌─────────────────────────────────────────────────────────────┐
│                    User (Web UI / CLI)                       │
│                  http://localhost:3001                       │
└────────────────────────┬────────────────────────────────────┘
                         │ query / chat
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              Express Web Server (src/web/server.js)          │
│   SSE streaming │ session management │ OAuth │ rate limiting │
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
          │ 1. self_protect     │
          │ 2. credential_guard │
          │ 3. high_risk check  │
          │ 4. human approval   │
          └─────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│           Scheduler (src/scheduler.js)                       │
│   Night 2am IST: deep scan + auto-fix (confidence ≥ 80)     │
│   Every 2h: light scan + health monitor + notify            │
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
| `full_scan` | All 10 checks in parallel — the "opening move" |
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
| `run_command` | Execute from exact-match allowlist only |

---

## 4. Safety Architecture

### Agent-Side (Tool Gates)

Every write goes through **four sequential gates**:

```
write_file called
      │
      ▼
[Gate 1] self_protect
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

An additional safety layer runs **outside the agent process** at the Claude Code session level. These hooks fire before any tool call and cannot be bypassed by the agent itself:

| Hook | What it blocks |
|------|---------------|
| `Bash` — main push guard | `git push origin main/master/production` |
| `Bash` — destructive guard | `git reset --hard`, `git push --force` |
| `mcp__postgres-tiqworld-dev__query` | UPDATE, DELETE, INSERT, DROP, TRUNCATE, ALTER — only SELECT allowed |
| `mcp__github__push_files` | Direct push to main/master/production branches |
| `mcp__github__create_or_update_file` | Direct commit to main/master/production branches |

**Why two layers?** The tool gates protect the **target codebase** (tiq_workplace). The Claude Code hooks protect the **agent's own repo** and dev workflow. Different threat surfaces, both needed.

### Self-Protect List (Gate 1 — absolute)
- `src/tools/`, `src/agent.js`, `src/scheduler.js`, `src/config.js`
- `src/web/server.js`, `src/web/router.js`, `ecosystem.config`
- `migrations/`, `migration.*`, `schema.prisma`, `prisma/schema`
- `seeds/`, `seeders/`

### Credential Guard Rules (Gate 2)
Blocks writes containing:
- AWS Access Key ID (`AKIA...` pattern)
- PEM / SSH private keys
- Hardcoded password assignments
- DB connection strings with embedded credentials
- JWT secret literals
- GCP service account JSON, Azure storage keys
- Slack/Discord webhook URLs in source
- Generic API key/token hardcoded values

Protected filenames: `.env`, `.env.*`, `secrets.json`, `credentials.json`, `id_rsa`, `private.key`

Smart exclusions: `process.env.X` usage, comment lines, test mock values.

### Command Approval (run_command)
Exact allowlist only — prefix match is insufficient:
```
Allowed: npm test | npm run test | npx eslint | node --check
With path: npx eslint <path> | node --check <path>
Monorepo: npm --prefix <service> test
Everything else: BLOCKED
```

### Auto-Fix Confidence: 80%
Agent only auto-applies fixes when `fix_error` confidence ≥ 80. Anything below requires a human decision. Pre-existing test failures skip auto-fix entirely.

---

## 5. Autonomy Model

Agent is **semi-autonomous** — two distinct modes:

### Fully Automated (no human needed)
- Routine maintenance: lint fixes, dead code cleanup, env gap detection, TODO tracking
- Small safe improvements: code quality, formatting, missing null checks
- Scheduled: night deep scan (2am) + light daytime checks (every 2h)
- Auto-fix only if `confidence ≥ 80` AND change is isolated (single file, low risk)

### Human-Instructed Only (dev team must trigger)
- Feature addition — never autonomous
- Any change that touches multiple files
- Any change to routes, models, auth, or core business logic
- Database schema changes
- Any push to main/production branch

---

## 6. Maintenance Scheduler

### Night Deep Maintenance (2:00 AM IST daily)
```
fullScan() — parallel: lint + todos + env + dead code + git log + secrets + deps
    │
    ▼
runTests() — pre-fix baseline
    If failing → skip auto-fix (don't compound)
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

### Day Light Scan (Every 2 hours IST)
```
Parallel: lint + findTodos + healthCheck + healthMonitor
    │
    ▼
If health DEGRADED/UNHEALTHY → notify() immediately
No writes in day scan
```

### Manual Trigger
```
POST /api/maintenance/trigger { mode: 'deep' | 'light' }
→ streams live progress via SSE to Admin tab
```

---

## 7. Health Monitor

Agent monitors the live platform without touching platform code.

**Three signal layers:**

1. **HTTP Synthetic Probes**
   - GET each URL in `HEALTH_MONITOR_URLS` env var
   - Checks: status code (non-2xx = fail), response time (>3s = warn)
   - Default URL: `http://localhost:3001/api/status`

2. **Log Anomaly Scan**
   - Scans `logs/activity.jsonl` for ERROR/CRITICAL/FATAL lines
   - Configurable time window (`last_minutes`, default 60)

3. **Process Vitals**
   - Node heap used/total, RSS
   - Uptime
   - Event-loop lag (setImmediate measurement)

**Scoring:** Each check contributes to 0–100 score.
- HEALTHY = 100 (all pass)
- DEGRADED = warnings present (score 70–90)
- UNHEALTHY = any fail (score ≤ 75)

Runs on every day scan cycle. On-demand via `GET /api/health-monitor` or Admin tab `▶ Run Now`.

---

## 8. Web UI

Single-page app at `http://localhost:3001`. No build step — one HTML file.

### Layout (3-column)
```
┌─────────────────┬───────────────────────┬──────────────────┐
│  Left Sidebar   │     Chat Area         │  Right Sidebar   │
│                 │                       │                  │
│  Quick Actions  │  Message stream       │  Tabs:           │
│  ⚡ Maintenance │  + thinking animation │  ✅ Approve      │
│  🔍 Full Scan   │  + tool call chips    │  ✏️ Writes        │
│  📊 Admin       │  + copy buttons       │  🔧 Tools        │
│  ⌘ Palette     │                       │  ⚡ Maint        │
│  🗑 Clear       │  Input (SSE stream)   │  📊 Admin        │
│                 │                       │                  │
│  Session Stats  │  ← bilateral ‹/›      │  Platform Health │
│  Memory         │    toggle arrows →    │  Reports         │
│  Quick Queries  │                       │  Activity log    │
└─────────────────┴───────────────────────┴──────────────────┘
```

### Key UI features
- `‹/›` bilateral toggle buttons — collapse/expand either sidebar (right collapses by default)
- Drag-to-resize both sidebars (localStorage persists width)
- SSE auto-reconnect with exponential backoff (1s → 30s max)
- Write approval modal — full diff view with approve/deny
- Live tool call chips — pulse while running, green when done
- Mobile layout — slide-in panels, bottom nav bar (`@media max-width: 768px`)

---

## 9. Data Persistence

All logs are files in `logs/` (gitignored):

| File | Content |
|------|---------| 
| `logs/activity.jsonl` | All events: queries, tool calls, writes, approvals |
| `logs/maintenance-{ISO}.json` | Per-run maintenance reports |
| `logs/notifications.json` | In-app notifications (with read state) |
| `logs/writes/{ISO}___{path}.diff` | Before/after for every file write |

---

## 10. Configuration (`.env`)

| Variable | Default | What |
|----------|---------|------|
| `AWS_REGION` | `us-east-2` | Bedrock region |
| `AWS_ACCESS_KEY_ID` | — | Required |
| `AWS_SECRET_ACCESS_KEY` | — | Required |
| `TIQ_CODEBASE_PATH` | `C:/Users/Shalini Mishra/TIQ` | Target codebase |
| `DB_URL` | — | PostgreSQL via SSM tunnel |
| `WEB_PORT` | `3001` | Web server port |
| `ENABLE_PROMPT_CACHE` | `true` | Bedrock prompt caching |
| `BEDROCK_TIMEOUT_MS` | `60000` | Per-call timeout |
| `SCAN_INTERVAL_MINUTES` | `0` | 0 = use cron, >0 = interval |
| `NIGHT_MAINTENANCE_CRON` | `0 2 * * *` | 2am IST daily |
| `DAY_LIGHT_SCAN_CRON` | `0 */2 * * *` | Every 2h IST |
| `AUTO_FIX_ENABLED` | `true` | Enable autonomous fixes |
| `AUTO_FIX_MIN_CONFIDENCE` | `80` | Minimum confidence for auto-fix |
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
| Run `npm run deploy`, `npm run build:prod` | Not in exact command allowlist |
| Auto-fix when pre-existing tests fail | Don't compound a broken state |
| Auto-fix with confidence < 80% | Too risky for production code |
| Run UPDATE/DELETE/INSERT on database | DB query hook — SELECT only |
| Access external APIs beyond Bedrock + DB | Security boundary |

---

## 12. Gap Resolution — All Closed (v1.0.0)

| Gap | Resolution | Files |
|-----|-----------|-------|
| **No PR-based write flow** | `branch_write` tool — commits to `agent/fix-*` feature branch, never touches main | `src/tools/branchWrite.js` |
| **No session persistence** | `sessionPersistence.js` — saves/loads session to `logs/sessions/*.json` on every turn, survives restarts | `src/sessionPersistence.js` |
| **No scheduler tests** | Full unit test suite — `isHighRisk()`, `getMaintenanceStatus()`, `getLastScan()`, `getSchedulerHealth()` | `tests/unit/scheduler.test.js` |
| **No session persistence tests** | Save/load round-trip, history cap, delete, list, corrupt file safety | `tests/unit/sessionPersistence.test.js` |
| **No branchWrite tests** | Self-protect gate + credential guard tested without git dependency | `tests/unit/branchWrite.test.js` |
| **`fix_error` confidence is self-reported** | Heuristic scoring (stack files found, keywords, function size). Production recommendation: add test-run verification pass after any auto-fix. | Architecture decision |
| **Health monitor only probes localhost** | Configure `HEALTH_MONITOR_URLS` with real production URLs | `.env.example` |

### `write_file` vs `branch_write`

| | `write_file` | `branch_write` |
|--|-------------|----------------|
| Where change lands | Working tree directly | New `agent/fix-*` branch |
| Requires human approval | Yes (modal/readline) | No — committed automatically |
| How change is reviewed | Approve/deny modal | Open a PR on GitHub |
| Suitable for | Dev/staging iteration | Production changes via PR |

### Session Persistence

Sessions survive server restarts. On `getSession(id)`, the router checks the in-memory Map first; if not found, loads from `logs/sessions/{id}.json`. Saved per session: history (last 8 messages), user, taskType, tokens, filesRead, toolCalls, writes. Snapshots older than 24h are discarded automatically.

**API:** `GET /api/sessions` — list all persisted sessions.

---

## 13. Technology Stack

| Component | Technology |
|-----------|-----------| 
| AI Model | Claude Sonnet (AWS Bedrock, `us-east-2`) |
| Runtime | Node.js 20+ (ES modules) |
| Web server | Express 4 + SSE |
| Frontend | Single HTML file (no build) |
| DB | PostgreSQL read-only via SSM tunnel (localhost:5433) |
| Scheduling | `node-cron` (Asia/Kolkata timezone) |
| Session persistence | JSONL snapshots in `logs/sessions/` — 24h TTL |
| Testing | Vitest (unit, 123 tests) + Playwright (e2e, 28 tests) |
| CI | GitHub Actions (independent test judge) |
| Process manager | PM2 |
| Dev environment guardrails | Claude Code hooks (settings.json) |

---

## 14. Running the Agent

```bash
npm install
cp .env.example .env
# Fill in AWS credentials and TIQ_CODEBASE_PATH

# Web UI (recommended)
npm run web
# → http://localhost:3001

# Development (auto-reload)
npm run web:dev

# CLI (interactive terminal)
npm run start

# Run tests
npx vitest run          # unit tests
npx playwright test     # e2e tests

# Always-on with PM2
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup
```

---

## 15. Deployment Checklist (Before Pointing at Production Codebase)

- [ ] `TIQ_CODEBASE_PATH` set to real tiq_workplace path
- [ ] `DB_URL` set to production read-only DB user
- [ ] `AUTO_FIX_ENABLED=false` for first week (observe-only mode)
- [ ] `NOTIFICATION_WEBHOOK_URL` set to team Slack channel
- [ ] `HEALTH_MONITOR_URLS` set to real platform endpoints
- [ ] `SESSION_SECRET` changed from default
- [ ] `GITHUB_CLIENT_ID/SECRET` set (optional but recommended for audit trail)
- [ ] PM2 configured for always-on operation
- [ ] First week: review every maintenance report manually
- [ ] After week 1: enable `AUTO_FIX_ENABLED=true` with `AUTO_FIX_MIN_CONFIDENCE=80`
- [ ] Claude Code hooks verified active (`settings.json` PreToolUse hooks)
- [ ] Confirm agent only has access to dev/feature branches — never main directly

---

*For daily progress log, see: `docs/devlog.md`*
