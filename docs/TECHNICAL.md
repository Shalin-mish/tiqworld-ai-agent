# TIQ AI Agent — Technical Reference

> Complete technical documentation for the TIQ World autonomous maintenance agent.
> Architecture · All 27 tools · API endpoints · Safety model · Configuration

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Technology Stack](#2-technology-stack)
3. [Configuration](#3-configuration)
4. [Core Modules](#4-core-modules)
5. [Tool Reference (All 27 Tools)](#5-tool-reference)
6. [API Endpoints](#6-api-endpoints)
7. [Safety Model](#7-safety-model)
8. [Scheduler & Automation](#8-scheduler--automation)
9. [GitHub Integration](#9-github-integration)
10. [Session & Persistence](#10-session--persistence)
11. [Performance & Limits](#11-performance--limits)
12. [Deployment](#12-deployment)

---

## 0. Any-Codebase Design

The agent is **not tied to any specific project**. It works on any codebase — any language, any size, any structure — without code changes.

### How it works

At startup the agent calls `discoverProject(codebasePath)` (`src/projectDiscovery.js`) which:

1. **Reads root config files** — `package.json`, `go.mod`, `Cargo.toml`, `pyproject.toml`, `pom.xml`, `composer.json`, `Gemfile`, etc.
2. **Detects language + framework** — Node.js/TypeScript, Python (Django/FastAPI/Flask), Go (Gin/Echo), Rust, Java (Maven/Gradle), Ruby (Rails), PHP (Laravel/Symfony)
3. **Detects monorepo** — workspace fields in `package.json` OR multiple `package.json` files in subdirectories
4. **Reads README** — first 25 lines used as project description in system prompt
5. **Walks top-2-level directory tree** — gives Claude a map of the codebase structure
6. **Extracts scripts** — `test`, `build`, `lint` commands from `package.json` scripts (or language equivalent)

The result feeds into `buildSystemPrompt()` which assembles the full Claude system prompt **dynamically, every time the agent starts**.

### To point the agent at a new codebase

```bash
# Option 1: env var
CODEBASE_PATH=/path/to/any/project npm start

# Option 2: .env file
CODEBASE_PATH=C:/path/to/your-new-project

# Option 3: no config — defaults to current working directory
cd /path/to/project && npm start
```

No code changes needed. No system prompt edits needed. The agent re-discovers the project on next start.

### Supported languages and frameworks

| Language | Auto-detected from | Frameworks detected |
|----------|-------------------|---------------------|
| JavaScript / TypeScript | `package.json`, `tsconfig.json` | Express, Fastify, NestJS, Next.js, React, Vue, Angular, Svelte, Koa, Hapi |
| Python | `requirements.txt`, `pyproject.toml`, `setup.py` | Django, FastAPI, Flask |
| Go | `go.mod` | Gin, Echo, Fiber |
| Rust | `Cargo.toml` | — |
| Java / Kotlin | `pom.xml`, `build.gradle` | Maven, Gradle |
| Ruby | `Gemfile`, `config/routes.rb` | Rails |
| PHP | `composer.json` | Laravel, Symfony |
| Monorepo | `workspaces` in `package.json` OR ≥2 subdirs with `package.json` | All of the above per-package |

---

## 1. Architecture Overview

```
┌────────────────────────────────────────────────────────┐
│                      Browser / API Client               │
└────────────────────┬───────────────────────────────────┘
                     │ SSE + REST (port 3001)
┌────────────────────▼───────────────────────────────────┐
│               Express Web Server (server.js)            │
│  OAuth · Webhook · Maintenance API · Notifications SSE  │
│                  Router (router.js)                     │
│  Chat SSE · Approval queue · Session memory · Rate limit│
└────────────────────┬───────────────────────────────────┘
                     │
┌────────────────────▼───────────────────────────────────┐
│                   Agent Loop (agent.js)                 │
│   Tool call ↔ LLM round-trip · Retry · Token tracking  │
└──────┬─────────────────────────────────┬───────────────┘
       │ AWS Bedrock Converse API         │ Tool executor
┌──────▼──────┐                 ┌────────▼───────────────┐
│  Claude     │                 │   27 Tool Modules       │
│  Sonnet 4.5 │                 │   (src/tools/*.js)      │
│  (Bedrock)  │                 │   Read · Write · Run    │
└─────────────┘                 └────────────────────────┘
                                         │
                              ┌──────────▼──────────┐
                              │  ANY target codebase │
                              │  auto-detected on    │
                              │  startup via         │
                              │  discoverProject()   │
                              └─────────────────────┘
```

**Request lifecycle (chat query):**

1. Browser sends `GET /api/chat?q=<query>&sessionId=<id>` (SSE)
2. `router.js` classifies the task type (`query|review|maintenance|feature`)
3. Task type selects the allowed tool scope (`READ_ONLY|REVIEW_EXTRA|WRITE`)
4. `runAgent()` sends system prompt + history + question to Bedrock
5. Claude responds with tool calls → agent executes them → result fed back to Claude
6. Loop continues until `stop_reason = end_turn` or tool budget (8) is exhausted
7. Final answer streamed as `data: {"type":"answer","text":"..."}` SSE event
8. Session history saved to disk for restart recovery

---

## 2. Technology Stack

| Layer | Technology |
|-------|-----------|
| LLM | AWS Bedrock · `us.anthropic.claude-sonnet-4-5-20250929-v1:0` |
| Backend | Node.js 18+ · ES Modules · Express 4 |
| Auth | Passport.js + `passport-github2` (OAuth) |
| Session | Express-session (in-memory + disk persistence) |
| Scheduling | `node-cron` |
| GitHub | `@octokit/rest` |
| Tests | Playwright (E2E, 28 tests) |
| Target codebase | TypeScript · Fastify · PostgreSQL · vitest |

---

## 3. Configuration

All configuration is loaded from `.env` via `dotenv/config` in `src/config.js`.

| Variable | Default | Description |
|----------|---------|-------------|
| `CODEBASE_PATH` | `process.cwd()` | Absolute path to ANY target codebase — any language, any size. Falls back to `TIQ_CODEBASE_PATH` then `cwd`. |
| `TIQ_CODEBASE_PATH` | _(legacy)_ | Backward-compatible alias for `CODEBASE_PATH` |
| `AWS_REGION` | `us-east-2` | Bedrock region |
| `AWS_ACCESS_KEY_ID` | — | AWS credentials |
| `AWS_SECRET_ACCESS_KEY` | — | AWS credentials |
| `WEB_PORT` | `3001` | HTTP server port |
| `ENABLE_PROMPT_CACHE` | `true` | Bedrock prompt caching |
| `BEDROCK_TIMEOUT_MS` | `60000` | Per-call timeout (180000 recommended) |
| `SCAN_INTERVAL_MINUTES` | `0` | If >0, use interval mode instead of cron |
| `NIGHT_MAINTENANCE_CRON` | `0 2 * * *` | Deep maintenance schedule (IST) |
| `DAY_LIGHT_SCAN_CRON` | `0 9 * * *` | Light scan — once per day at 9 AM IST (healthCheck + healthMonitor only) |
| `MAINTENANCE_TIMEOUT_MS` | `7200000` (2h) | Max wall-clock time for a night maintenance run. Agent is forcibly aborted (via AbortController) after this duration. |
| `AUTO_FIX_ENABLED` | `true` | Allow autonomous file writes |
| `AUTO_FIX_MIN_CONFIDENCE` | `80` | Minimum `fix_error` confidence to auto-fix |
| `NOTIFICATION_WEBHOOK_URL` | — | Slack or Discord incoming webhook |
| `HEALTH_MONITOR_URLS` | — | Comma-separated URLs to probe |
| `GITHUB_CLIENT_ID` | — | GitHub OAuth App client ID |
| `GITHUB_CLIENT_SECRET` | — | GitHub OAuth App client secret |
| `SESSION_SECRET` | (insecure default) | Express session secret — MUST set in prod |
| `GITHUB_WEBHOOK_SECRET` | — | HMAC secret for webhook signature verification |
| `GITHUB_TOKEN` | — | PAT for posting PR review comments |
| `WEEKLY_REPORT_CRON` | `0 9 * * 1` | Weekly Slack report schedule (IST) |
| `DB_URL` | — | PostgreSQL connection string (SSM tunnel) |

---

## 4. Core Modules

### `src/agent.js`

The agent loop. Handles:
- Tool registration and routing
- Bedrock Converse API calls with retry (3 attempts, 4s → 8s → 16s backoff)
- AbortController timeout per call
- Token usage logging and forwarding to UI
- Duplicate tool call deduplication (same name+input → skip)
- Tool budget enforcement (default 8 calls/turn, configurable)
- `runAgent(question, history, tools, onEvent, user, approvalFn, commandApprovalFn, sessionId, toolBudget, abortSignal)`
- `abortSignal` — optional `AbortController.signal`; when fired it immediately cancels the in-flight Bedrock call and stops the loop (used by maintenance timeout)

### `src/dispatcher.js`

Task classification and tool scope gating. **Called once per session** — on the first user message. The classified task type is then fixed for the entire session lifetime.

**Where it's called:**
- `src/web/router.js` — first turn of every web session (`GET /api/chat`)
- `src/index.js` — first turn of every CLI session

**`classify(input)`** — returns `{ type, confidence, scores }` (NOT a bare string). Multi-keyword scoring across 4 task types:
- `query` — read-only exploration (→ `READ_ONLY` scope)
- `review` — code review, security audit (→ `REVIEW_EXTRA` scope)
- `maintenance` — scheduled fix mode (→ `WRITE` scope)
- `feature` — new feature requests (→ `WRITE` scope, but agent is instructed to propose only)

**Tool scopes:**
```
READ_ONLY     = 19 read-only tools
REVIEW_EXTRA  = READ_ONLY + show_diff + fix_error
WRITE         = REVIEW_EXTRA + git_backup + write_file + branch_write + run_command
```

### `src/scheduler.js`

Cron-driven autonomous maintenance.

**Night maintenance** (`0 2 * * *` IST):
1. `fullScan()` — 6 checks in parallel
2. Run project's detected test command (`projectInfo.testCmd` — e.g. `pytest`, `go test ./...`, `npm test`)
3. If tests pass AND issues found AND auto-fix enabled: call `runAgent()` in maintenance mode (passes `AbortController.signal`)
4. Post-fix: run tests again → rollback via `git_backup restore` if failing
5. Save report to `logs/maintenance-{ts}.json`, send notification

**Maintenance timeout**: controlled by `MAINTENANCE_TIMEOUT_MS` (default 2h). On timeout the `AbortController` is fired — this cancels the in-flight Bedrock call and stops `runAgent()` cleanly. Without this the agent could run indefinitely.

**Day light scan** (`0 9 * * *` IST — once per day):
- Runs only `healthCheck` + `healthMonitor` (lightweight — no lint/todos)
- Lint and TODOs are intentionally kept for night maintenance to avoid unnecessary token spend
- Sends notification if platform status is UNHEALTHY or DEGRADED

**Weekly report** (`0 9 * * 1` IST):
- Aggregates last 7 days of maintenance reports
- Sends formatted message to Slack/Discord webhook

**Safety gates** (`HIGH_RISK_PATTERNS` list): blocks writes to agent source, migrations, test files, config files regardless of confidence score. The maintenance agent prompt receives a dynamic sample of these patterns so Claude understands what it cannot touch.

**`_status.progress`**: ring-buffer capped at 200 entries — prevents unbounded memory growth on long runs.

### `src/config.js`

Single exported `config` object. Centralises all `process.env` reads.

### `src/session.js`

Per-session tool call log (in-memory). Used by `recall_session` tool.

### `src/sessionPersistence.js`

Serialize/deserialize sessions to `logs/sessions/{id}.json`. Survives server restarts. Max history: 8 messages (4 turns). Max age: 24 hours.

### `src/notifications.js`

In-app notification store (ring buffer, last 100) + Slack/Discord webhook delivery.
- `notify(level, title, body)` — creates notification and sends webhook if configured
- `getNotifications(limit)`, `markAllRead()`, `unreadCount()`

### `src/activityLog.js`

Append-only JSONL log at `logs/activity.jsonl`. Every user query, tool call, error, and write is recorded.

### `src/weeklyReport.js`

Aggregates `logs/maintenance-*.json` files for last 7 days, formats Slack block-kit message, saves to `logs/weekly-{date}.json`, sends to `NOTIFICATION_WEBHOOK_URL`.

### `src/prReview.js`

Triggered by GitHub webhook on PR open/synchronize. Runs lint, findTodos, secretScanner, detectDeadCode in parallel, then posts a structured comment via `@octokit/rest`.

### `src/writeArchive.js`

Saves before/after diff for every accepted `write_file` call to `logs/archives/`. Provides audit trail for every autonomous change.

---

## 5. Tool Reference

### Exploration Tools

#### `list_files`
List directory contents recursively. Respects `.gitignore`.
```
Input:  { directory: "backend/src" }
Output: { entries: [{ name, path, type, size }], total, scannedAt }
```

#### `read_file`
Read file with optional import resolution (depth 2).
```
Input:  { file_path: "backend/auth-service/src/index.ts", include_imports: true }
Output: { content, total_lines, imported_files: [] }
```

#### `search_code`
Regex search across codebase. Caps at 300 results.
```
Input:  { keyword: "getUserById", directory: "backend", is_regex: false }
Output: { matches: [{ file, line, column, text }], total_matches, searched_files }
```

#### `recall_session`
Show all tool calls made in the current session.
```
Input:  { filter_tool: "write_file" }  // optional
Output: { total_calls, entries: [{ tool, input, result_summary, at }] }
```

---

### Analysis Tools (read-only)

#### `health_check`
Quick codebase snapshot: total files, git status, env gaps, TODOs, key file presence.
```
Input:  {}
Output: { total_files, code_files, todos, git_status, env_gaps, key_files }
```

#### `full_scan`
Run ALL 6 maintenance checks in parallel. Use instead of individual tools.
```
Input:  { lint_path?: "backend/src", todo_path?: "/path/to/scan" }
Output: { summary: { critical_todos, lint_errors, dead_code_files, ... }, timings, sections }
```

#### `trace_error`
Parse stack trace → read every file mentioned. Ideal for debugging.
```
Input:  { error_text: "<stack trace>", extra_keywords: ["getUserById"] }
Output: { stack_trace_files: [], keyword_matches: {}, total_files_searched }
```

#### `fix_error`
End-to-end error diagnosis with confidence score. Preferred entry point for bug fixing.
```
Input:  { error_text: "<error>", fix_hint: "check null handling", codebase_path: "" }
Output: { confidence_score: 0-100, primary_error_files: [], suggested_pipeline: [], keyword_matches: {} }
```
Confidence interpretation:
- `≥80`: HIGH — auto-fix safe
- `55–79`: MEDIUM — apply with review
- `<55`: LOW — manual investigation needed

#### `map_dependencies`
Outgoing imports + incoming importers for a file or directory.
```
Input:  { file_path: "backend/auth-service/src/index.ts", depth: 2 }
Output: { outgoing_imports: [], incoming_importers: [], summary }
```

#### `explain_route`
Trace an Express/Fastify route → middleware → controller → service.
```
Input:  { route_path: "/api/users/:id", method: "GET", route_file: "routes/users.js" }
Output: { route_definitions: [], handler_definitions: {}, related_middleware: {} }
```

#### `find_todos`
Scan for TODO/FIXME/BUG/HACK with severity classification.
```
Input:  { directory: "backend/src", tags: ["TODO", "FIXME"] }
Output: { total, by_severity: { critical, warning, info }, items: [] }
```
Severity rules: `FIXME`/`SECURITY`/`HACK` → `critical`; plain `TODO` → `warning`; `NOTE` → `info`.

#### `check_env_usage`
Compare `.env.example` against `process.env.*` calls in code.
```
Input:  { env_file: ".env.example" }
Output: { missing_from_example: [], documented_but_unused: [] }
```

#### `detect_dead_code`
Find files with zero importers (unreferenced). Excludes known entry points.
```
Input:  { directory: "backend/src" }
Output: { unreferenced: [], scanned, note }
```

#### `schema_to_api`
Check CRUD completeness for a model: does it have GET/POST/PUT/DELETE routes?
```
Input:  { model_name: "User" }
Output: { operations: [], missing: [], found_count }
```

#### `summarize_diff`
Show git diff (staged, unstaged, or branch comparison).
```
Input:  { mode: "staged|unstaged|branch", base_branch: "main" }
Output: { diff, truncated, mode }
```

#### `git_log`
Filtered commit history.
```
Input:  { count: 20, file_path: "src/auth.ts", since: "7 days ago" }
Output: { commits: [{ hash, date, author, message }], count }
```

#### `lint_file`
Run ESLint on file or directory.
```
Input:  { file_path: "backend/src" }
Output: { total_errors, total_warnings, files: [{ file, errors, warnings }], clean }
```

#### `db_query`
Read-only SQL queries. Requires PostgreSQL SSM tunnel on `localhost:5433`.
```
Input:  { sql: "SELECT id, name FROM users LIMIT 10", description: "List users" }
Output: { row_count, columns, rows, duration_ms }
```

#### `secret_scanner`
Scan for leaked credentials. Uses 9 regex patterns (AWS keys, JWT secrets, PEM, DB strings, Slack webhooks, etc.).
```
Input:  { directory: "backend" }
Output: { findings: [{ file, line, pattern, match_preview }], scanned_files, affected_files }
```

#### `dep_updater`
Check outdated npm packages with risk classification.
```
Input:  { directory: "backend/auth-service" }
Output: { packages: [], by_risk: { patch, minor, major }, safe_update_command }
```

#### `health_monitor`
Synthetic HTTP probes + log anomaly scan + process vitals.
```
Input:  { urls: [], log_paths: [], last_minutes: 60 }
Output: { overall: "HEALTHY|DEGRADED|UNHEALTHY", score: 0-100, checks: {}, http_probes: [], process: {} }
```

---

### Diagnostic Tools

#### `fix_error`
See [Analysis Tools](#analysis-tools-read-only) above.

#### `show_diff`
Preview diff between current file and proposed content (read-only, no write).
```
Input:  { file_path: "src/controller.js", proposed_content: "..." }
Output: { diff, total_changes }
```

#### `credential_guard`
Audit a file's content for hardcoded secrets.
```
Input:  { file_path: "src/config.js", content: "..." }
Output: { blocked: bool, findings: [], by_severity: { HIGH, MEDIUM }, verdict }
```

---

### Write Tools

**Mandatory sequence for any write:**
```
git_backup → show_diff → write_file → run_command
```

#### `git_backup`
Create a checkpoint branch before writes, or restore from last checkpoint.
```
Input:  { reason: "fix-null-check", action: "backup|restore" }
Output: { status, branch, message, restore_command }
```
Backup branch name format: `backup/maint-{ISO timestamp}-{slug}`
State persisted to `logs/.last-backup-branch` (survives restarts).

#### `write_file`
Write/update a file. Requires approval (interactive CLI prompt or SSE approval for web).
- Blocks: self-protect patterns (agent source, migrations, test files)
- Blocks: high-severity credentials in content
- Warns: medium-severity credentials
- Archives: before/after diff to `logs/archives/`
```
Input:  { file_path: "backend/src/utils/helper.ts", new_content: "...", reason: "fix null check" }
Output: { status: "success|rejected|blocked|skipped", file_path, is_new_file, backup, archive }
```

#### `branch_write`
Alternative to `write_file` — commits to a feature branch instead of working tree.
```
Input:  { file_path: "...", new_content: "...", reason: "..." }
Output: { status, branch, commit, next_steps: ["open PR"] }
```

#### `run_command`
Execute whitelisted shell commands for verification.

**Allowed commands (exact match):**
- `npm test`, `npm run test`
- `npx eslint`, `node --check`
- `npm --prefix <service> test` (monorepo pattern)
- `npx eslint <path>`, `node --check <path>` (prefix patterns)

```
Input:  { command: "npm test", directory: "backend/auth-service" }
Output: { exit_code, output, error }
```

---

## 6. API Endpoints

### Chat & Session

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/chat` | SSE streaming chat (rate: 15/min) |
| `GET` | `/api/status` | Tool count, model, last scan, unread count, **project_name, language, framework, is_monorepo** |
| `GET` | `/api/me` | Current user + auth mode |
| `POST` | `/api/identify` | Set session user name |
| `POST` | `/api/clear` | Delete session |
| `GET` | `/api/sessions` | List all persisted sessions |
| `GET` | `/api/session/:id/memory` | Session memory (files read, tool calls, writes) |

### Scan & Maintenance

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/scan` | Trigger light scan (rate: 5/min) |
| `GET` | `/api/last-scan` | Last scan results |
| `GET` | `/api/health-monitor` | Run live health probe |
| `GET` | `/api/maintenance/stream` | SSE stream of maintenance progress |
| `GET` | `/api/maintenance/status` | Current maintenance state |
| `POST` | `/api/maintenance/trigger` | Trigger deep/light/weekly scan |
| `GET` | `/api/maintenance/reports` | Last 50 maintenance reports |
| `GET` | `/api/scheduler/health` | Scheduler config + last run |

### Writes & Audit

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/approve` | Approve or reject pending write |
| `GET` | `/api/writes` | List archived write operations |
| `GET` | `/api/activity` | Global activity log |

### Notifications

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/notifications` | Get notifications |
| `POST` | `/api/notifications/read-all` | Mark all read |

### Authentication

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/auth/github` | Start GitHub OAuth flow |
| `GET` | `/auth/github/callback` | OAuth callback |
| `GET` | `/auth/logout` | Logout |

### Webhooks

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/webhook/github` | GitHub webhook (PR review + push scan) |
| `GET` | `/webhook/status` | Webhook endpoint health |

### Admin

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/admin` | Redirect to `/?tab=admin` |

---

## 7. Safety Model

The agent has **5 independent safety layers**. Each is enforced separately — bypassing one does not bypass others.

### Layer 1 — Self-Protection (write_file + scheduler)

Defined in `scheduler.js:HIGH_RISK_PATTERNS` and `writeFile.js:SELF_PROTECT_PATTERNS`.

Files matching these patterns are **never written** regardless of confidence or approval:
- Agent own source: `tiqworld-ai-agent/src/`, `src/tools/`, `src/agent.js`, `src/scheduler.js`, etc.
- Database: `migrations/`, `schema.prisma`, `seeds/`, `knexfile`, etc.
- Test files: `tests/`, `__tests__/`, `*.test.*`, `*.spec.*`
- Config: `config.js`, `config.ts`, `server.js`, `app.js`, `.env`

### Layer 2 — Credential Guard (write_file + branchWrite)

`credentialGuard.js` scans file content before any write:

**HIGH severity (write blocked):**
- AWS access key format (`AKIA...`)
- PEM private keys (`-----BEGIN`)
- Hardcoded passwords in assignments
- JWT secrets in code
- Database connection strings
- Slack/Discord tokens

**MEDIUM severity (warning only):**
- Webhook URLs
- `.env` file literals

### Layer 3 — Approval Gate (write_file)

Every `write_file` call pauses and requires explicit approval:
- **Web UI**: SSE `approval_needed` event → user clicks Approve/Reject
- **CLI**: readline prompt
- **Auto-reject** after 5 minutes

### Layer 4 — Maintenance Scheduler Gate (scheduler.js)

For autonomous maintenance runs:
- Pre-fix test suite must pass (skips auto-fix if already failing)
- Post-fix test suite must pass (auto-rollback via `git_backup restore` if failing)
- `commandApprovalFn`: only whitelisted commands allowed during maintenance

### Layer 5 — Audit Trail

- `logs/activity.jsonl` — every action logged (append-only)
- `logs/sessions/{id}.json` — per-session tool call history
- `logs/archives/` — before/after diff for every write
- `logs/.last-backup-branch` — last git backup branch (restart-persistent)

---

## 8. Scheduler & Automation

### Cron Schedule (Asia/Kolkata timezone)

| Schedule | Default | Task |
|----------|---------|------|
| `0 2 * * *` | 2:00 AM IST daily | Night deep maintenance (fullScan + auto-fix + tests) |
| `0 9 * * *` | 9:00 AM IST daily | Day light scan (healthCheck + healthMonitor only) |
| `0 9 * * 1` | Monday 9:00 AM IST | Weekly Slack report |

> **Why separate schedules?** Night runs everything (expensive, full lint + todos + LLM). Day is cheap — just a liveness check. Running lint/todos 12× a day would waste tokens for zero extra value.

### Night Maintenance Flow

```
1. fullScan()                              → 6 checks in parallel
2. projectInfo.testCmd (npm/pytest/go)     → pre-fix baseline
3. IF tests passing AND issues found:
   a. runAgent(maintenance, abortSignal)   → fix lint errors, null checks, unused vars
      └── AbortController: cancelled after MAINTENANCE_TIMEOUT_MS (default 2h)
   b. projectInfo.testCmd                  → post-fix verification
   c. IF failing → git_backup restore (rollback all changes)
4. saveMaintenanceReport()                 → logs/maintenance-{ts}.json
5. notify()                                → Slack/Discord + in-app notification
```

### Maintenance Timeout

The `MAINTENANCE_TIMEOUT_MS` env var (default `7200000` = 2h) controls the hard ceiling:

1. A `setTimeout` fires at the deadline
2. It calls `controller.abort()` on the `AbortController` passed into `runAgent()`
3. The abort signal is linked to every individual Bedrock call — the current in-flight LLM call is immediately cancelled
4. `runAgent()` throws `"Maintenance run aborted by timeout"` — the scheduler catches it and marks the run as done
5. All file locks are released and the running flag is cleared

Without this the agent could hang indefinitely on a slow Bedrock response.

### Auto-Fix Rules (maintenance agent prompt)

The agent in maintenance mode is explicitly instructed to:
- Skip files matching the `HIGH_RISK_PATTERNS` list (a dynamic sample is included in the prompt)
- Only fix: lint errors, null checks, unused variables, `console.log` cleanup
- Skip: feature additions, schema changes, route changes
- Only apply if `fix_error` confidence ≥ configured threshold (default 80)
- Run `git_backup` before every file change
- Run `projectInfo.testCmd` (not hardcoded `npm test`) after every file change
- Rollback immediately on test failure

---

## 9. GitHub Integration

### OAuth (optional)

Configure `GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET`. Callback URL:
```
http://localhost:3001/auth/github/callback
```

When enabled:
- Users authenticate via GitHub profile
- Session contains `login`, `name`, `avatarUrl`, `githubId`
- Activity log attributes actions to GitHub login

### Webhook (optional)

Configure `GITHUB_WEBHOOK_SECRET` in `.env` and GitHub repo → Settings → Webhooks with:
- Payload URL: `http://your-server:3001/webhook/github`
- Content type: `application/json`
- Events: `Pull requests`, `Pushes`

**On PR opened/synchronize:**
1. Runs parallel scan: lint, findTodos, secretScanner, detectDeadCode
2. Posts structured review comment to the PR via `@octokit/rest`
3. Comment includes: lint errors (top 10), critical TODOs (top 10), detected secrets, dead files

**On push to non-main branch:**
1. Triggers a light scan of the codebase
2. Results available at `/api/last-scan`

### Signature Verification

Webhook endpoint verifies `x-hub-signature-256` HMAC header when `GITHUB_WEBHOOK_SECRET` is set.
Uses `crypto.timingSafeEqual` to prevent timing attacks.

---

## 10. Session & Persistence

### In-Memory Session Store

`sessions` Map in `router.js`. Each session contains:
```javascript
{
  history:      [...],       // Bedrock conversation messages (last 8)
  taskType:     "query",     // Classified on first message, fixed for session lifetime
  user:         "alice",     // GitHub login or name
  github:       {...},       // GitHub profile (if OAuth)
  lastActiveAt: timestamp,
  tokens:       { in, out, cacheRead },
  memory: {
    filesRead: Map<path, count>,
    toolCalls: [{ name, inputSummary, at }],
    writes:    [{ path, status, reason, at, approvalId }],
  }
}
```

**Session TTL**: 2 hours idle → auto-evict. GC runs every 30 minutes.

### Disk Persistence

Sessions saved to `logs/sessions/{id}.json` on every chat response. Loaded on first access after restart. Sessions older than 24 hours are automatically deleted.

### Tool Call Log (session.js)

Separate in-memory store per session, used by `recall_session` tool. Records name, input, result summary, timestamp for every tool call.

---

## 11. Performance & Limits

### Tool Call Budget

Default: **8 tool calls per user query**. Configurable via `toolBudget` parameter to `runAgent()`.

### Rate Limits

| Endpoint | Limit |
|----------|-------|
| `GET /api/chat` | 15 requests/min/IP |
| `POST /api/scan` | 5 requests/min/IP |

### Input Limits

| Limit | Value |
|-------|-------|
| Query max length | 4,000 characters |
| Tool result max size | ~100KB (truncated by `truncateResult()`) |
| Session history | 8 messages (4 turns) |
| Maintenance report listing | 50 most recent |
| Archive listing | 100 most recent |
| Notification ring buffer | 100 notifications |

### Bedrock Timeouts & Retries

| Setting | Default |
|---------|---------|
| Per-call timeout | `BEDROCK_TIMEOUT_MS` (default 60s, recommended 180s) |
| Max retries | 3 attempts |
| Retry delays | 4s → 8s → 16s (exponential) |
| Retried errors | `AbortError` (timeout), `ThrottlingException`, `ServiceUnavailableException` |

### Tool Performance

| Speed | Tools |
|-------|-------|
| Fast (<500ms) | list_files, read_file, search_code, recall_session, trace_error, explain_route, find_todos, check_env_usage, schema_to_api, fix_error, show_diff |
| Medium (500ms–5s) | map_dependencies, secret_scanner, lint_file, git_log, health_check |
| Slow (5s+) | full_scan (~10–30s), health_monitor (~5–10s), dep_updater (~20–30s) |

---

## 12. Deployment

### Development

```bash
npm install
cp .env.example .env   # fill in credentials
npm start              # starts web server on WEB_PORT (default 3001)
```

**Port already in use?**

If `EADDRINUSE :3001` appears, the old process is still running. Kill it and restart:

```bash
# Windows — find and kill whatever owns port 3001
node -e "require('child_process').execSync('npx kill-port 3001', {stdio:'inherit'})"

# Then restart
npm run web
```

Or set a different port in `.env`:
```
WEB_PORT=3002
```

### PM2 Production

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs --env production
pm2 save
pm2 startup
```

### Environment Requirements

- Node.js 18+ (ES modules required)
- Git installed and in PATH (for git_backup, git_log, summarize_diff, secret_scanner)
- AWS credentials with Bedrock access (`bedrock:InvokeModel` on `us-east-2`)
- ESLint in the target codebase's `node_modules` (for lint_file)
- PostgreSQL SSM tunnel on `localhost:5433` (for db_query)

### Directory Structure

```
tiqworld-ai-agent/
├── src/
│   ├── agent.js              # LLM loop + tool registry
│   ├── config.js             # Environment config
│   ├── dispatcher.js         # Task classification + tool scoping
│   ├── scheduler.js          # Cron automation + safety gates
│   ├── session.js            # Per-session tool call log
│   ├── sessionPersistence.js # Disk-based session store
│   ├── notifications.js      # In-app + webhook notifications
│   ├── activityLog.js        # Global append-only event log
│   ├── prReview.js           # GitHub PR automated review
│   ├── weeklyReport.js       # Weekly Slack summary
│   ├── writeArchive.js       # Write before/after diff archive
│   ├── index.js              # CLI entry point
│   ├── tools/                # 27 tool modules
│   │   ├── listFiles.js
│   │   ├── readFile.js
│   │   ├── searchCode.js
│   │   ├── traceError.js
│   │   ├── mapDependencies.js
│   │   ├── explainRoute.js
│   │   ├── findTodos.js
│   │   ├── checkEnvUsage.js
│   │   ├── detectDeadCode.js
│   │   ├── schemaToApi.js
│   │   ├── summarizeDiff.js
│   │   ├── gitLog.js
│   │   ├── healthCheck.js
│   │   ├── lintFile.js
│   │   ├── dbQuery.js
│   │   ├── fullScan.js
│   │   ├── secretScanner.js
│   │   ├── depUpdater.js
│   │   ├── healthMonitor.js
│   │   ├── fixError.js
│   │   ├── showDiff.js
│   │   ├── gitBackup.js
│   │   ├── writeFile.js
│   │   ├── branchWrite.js
│   │   ├── runCommand.js
│   │   ├── credentialGuard.js
│   │   ├── recallSession.js
│   │   ├── fileLock.js        # internal: concurrent write guard
│   │   └── maintenanceReport.js # internal: report I/O
│   ├── utils/
│   │   ├── fs.js              # file helpers
│   │   └── truncate.js        # tool result size cap
│   └── web/
│       ├── server.js          # Express app + OAuth + webhooks
│       └── router.js          # API routes + SSE chat + approvals
├── tests/
│   └── e2e/ui.test.js         # 28 Playwright E2E tests
├── docs/
│   ├── TECHNICAL.md           # This file
│   ├── devlog.md              # Day-by-day build log
│   └── system-design.md       # Architecture diagrams
├── logs/                      # Runtime-generated
│   ├── activity.jsonl
│   ├── sessions/
│   ├── archives/
│   ├── maintenance-*.json
│   └── weekly-*.json
├── .env                       # Not committed
├── ecosystem.config.cjs       # PM2 config
└── package.json
```

---

## 13. Inspection & Testing Guide

This section explains how to verify every layer of the agent without sending actual LLM queries.

### Unit tests

```bash
npm run test:unit        # 123 tests — runs in ~2s, no server needed, no AWS needed
```

Covers: dispatcher classification, scheduler safety gates, scheduler health fields, tool isolation (file read/write/search), session persistence, write archive, PR review logic, credential guard, config validation.

### End-to-end tests (Playwright)

```bash
npm run test:e2e         # 28 tests — requires server running on port 3001
```

Covers: page load + dynamic title, identity modal, GitHub login flow, layout (sidebar/right panel), brand colours, keyboard shortcuts, API health endpoints, session memory API, admin panel routing, SSE-based streaming (partial).

### Manual API inspection (no browser)

```bash
# 1. Confirm project auto-detection
curl http://localhost:3001/api/status
# → project_name, language, framework, is_monorepo

# 2. Confirm scheduler config
curl http://localhost:3001/api/scheduler/health
# → day_cron "0 9 * * *", maintenance_timeout_hrs 2

# 3. Trigger a light scan and watch it complete
curl -X POST http://localhost:3001/api/maintenance/trigger \
  -H "Content-Type: application/json" -d '{"mode":"light"}'
sleep 6
curl http://localhost:3001/api/maintenance/status
# → state "done", progress has 2 entries: start + done

# 4. Run a tool directly
curl -X POST http://localhost:3001/api/scan \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"manual-test"}'
# → health_check + health_monitor results

# 5. Check activity log
curl "http://localhost:3001/api/activity?limit=5"
```

### What to check before review

| Check | How |
|-------|-----|
| All tests pass | `npm test` — should be 123 unit + 28 e2e |
| Server starts cleanly | `npm run web`, check for `[Scheduler]` lines in output |
| Codebase detected | Look for `[Agent] Codebase detected: <name> · <lang>` in startup log |
| Day cron once/day | `/api/scheduler/health` → `day_cron: "0 9 * * *"` |
| Timeout is 2h | `/api/scheduler/health` → `maintenance_timeout_hrs: 2` |
| Project shown in UI | Open browser → header badge shows project name + language |
| Light scan is lightweight | Trigger light scan, check `/api/maintenance/status` → only 2 progress entries |
| Safety gate blocks self | Try to write `src/agent.js` via write_file → expect `blocked: high-risk` response |

---

*Last updated: June 2026*

**This session:** any-codebase design (Section 0) · maintenance timeout abort via `AbortController` · day scan changed to once/day (9 AM IST) · day scan simplified to healthCheck+healthMonitor only · `runTests()` uses `projectInfo.testCmd` · `_status.progress` capped at 200 · UI dynamic project badge from `/api/status` · inline SVG logo (no external URLs) · all 151 tests passing.
