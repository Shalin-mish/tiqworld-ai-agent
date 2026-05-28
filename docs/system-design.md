# TIQ World AI Agent — System Design & Documentation

**Version:** 3.0 (Production-Hardened)
**Last Updated:** May 28, 2026
**Author:** Shalini Mishra
**Purpose:** Claude-powered AI agent that acts as a senior engineer on the TIQ World team — maintaining, reviewing, and monitoring the codebase autonomously and safely.

---

## 1. What Is This?

A **Claude-powered AI agent** (AWS Bedrock) that behaves like a senior software engineer on the TIQ World team.

Instead of a human developer manually reviewing code, writing docs, checking git history, querying the database, or monitoring for production issues — this agent does it automatically when asked, or on its own schedule.

**Lead Requirement:**
> "Create a prototype AI agent, powered by Claude, that can help maintain and improve our codebase and act like it is part of our tech team."

---

## 2. Architecture (Current — v3.0)

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
   │ 26 Tools │ │ Write  │ │  DB  │ │ Monitor  │
   │(read-only│ │ Gates  │ │Query │ │  Tools   │
   │ + write) │ │        │ │      │ │          │
   └──────────┘ └────────┘ └──────┘ └──────────┘
                     │
          ┌──────────┴──────────┐
          │   TWO-LAYER GATE    │
          │ 1. self_protect     │
          │ 2. credential_guard │
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

## 3. All 26 Tools

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
| `credential_guard` | Scan file content for hardcoded credentials |

### Monitoring (1)
| Tool | What it does |
|------|-------------|
| `health_monitor` | HTTP probes + log anomaly scan + process vitals |

### Write + Verify (4)
| Tool | What it does |
|------|-------------|
| `git_backup` | Create/restore checkpoint branch |
| `show_diff` | Display context-aware diff before writing |
| `write_file` | Write with approval gate + two safety layers |
| `run_command` | Execute from exact-match allowlist only |

---

## 4. Safety Architecture

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

### Self-Protect List (Gate 1 — absolute, can never be overridden)
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
Agent only auto-applies fixes when `fix_error` confidence ≥ 80. Anything below requires human decision. Pre-existing test failures skip auto-fix entirely (don't compound broken state).

---

## 5. Maintenance Scheduler

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

## 6. Health Monitor

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

## 7. Web UI

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
- `‹/›` bilateral toggle buttons — collapse/expand either sidebar
- Drag-to-resize both sidebars (localStorage persists width)
- Admin tab opens by default on page load
- SSE auto-reconnect with exponential backoff (1s → 30s max)
- Write approval modal — full diff view with approve/deny
- Live tool call chips — pulse while running, green when done
- Mobile layout — slide-in panels, bottom nav bar (`@media max-width: 768px`)

---

## 8. Data Persistence

All logs are files in `logs/` (gitignored):

| File | Content |
|------|---------|
| `logs/activity.jsonl` | All events: queries, tool calls, writes, approvals |
| `logs/maintenance-{ISO}.json` | Per-run maintenance reports |
| `logs/notifications.json` | In-app notifications (with read state) |
| `logs/writes/{ISO}___{path}.diff` | Before/after for every file write |

---

## 9. Configuration (`.env`)

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

## 10. What the Agent Does NOT Do (Hard Limits)

| Out of Scope | Why |
|---|---|
| Modify its own source code | Self-protect gate — absolute block |
| Touch DB migrations / schema.prisma | Migration guard — absolute block |
| Write hardcoded credentials to any file | Credential guard — absolute block |
| Auto-push to remote git | Human must always push |
| Run `npm run deploy`, `npm run build:prod` | Not in exact command allowlist |
| Auto-fix when pre-existing tests fail | Don't compound a broken state |
| Auto-fix with confidence < 80% | Too risky for production code |
| Access external APIs beyond Bedrock + DB | Security boundary |

---

## 11. Technology Stack

| Component | Technology |
|-----------|-----------|
| AI Model | Claude Sonnet (AWS Bedrock, `us-east-2`) |
| Runtime | Node.js 20+ (ES modules) |
| Web server | Express 4 + SSE |
| Frontend | Single HTML file (no build) |
| DB | PostgreSQL read-only via SSM tunnel (localhost:5433) |
| Scheduling | `node-cron` (Asia/Kolkata timezone) |
| Testing | Vitest (unit) + Playwright (e2e) |
| CI | GitHub Actions (independent test judge) |
| Process manager | PM2 |

---

## 12. Running the Agent

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

## 13. Deployment Checklist (Before Pointing at Real Codebase)

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

---

*For daily progress, see: `docs/devlog.md`*
*For Google Doc version, see: `docs/google-doc-content.md`*
