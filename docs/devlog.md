# TIQ World AI Agent — Dev Log

*Daily progress log for the TIQ World AI Agent project.*

---

## May 27, 2026 (Session 4) — README fixed, full test suite verified, final state confirmed

### What changed

**README.md — 4 bugs fixed:**
- Port `3000` → `3001` (actual config.js port)
- `TIQ_CODEBASE_PATH` example: `C:/Users/.../TIQ` → `C:/Users/.../tiq_workplace`
- Stack description: added tiq_workplace as TypeScript microservices (Fastify + PostgreSQL, 7 services + 2 frontends)
- Admin URL: removed `localhost:3000/admin` (doesn't exist as a separate URL) — admin is the Admin tab in single-page UI at `localhost:3001`
- New section added: **"Verify Commands (tiq_workplace microservices)"** — shows `npm --prefix backend/<service>` examples for tests, build, lint

**Final test run:**
- 6 unit test files, 75 unit tests — all passing
- 28 e2e tests (Playwright) — all passing
- 0 failures, 0 errors

### Current state of the agent

| Area | Status |
|------|--------|
| 24 tools | All wired, tested |
| Per-session log isolation | Done (session.js Map) |
| Tool call deduplication | Done (seenCalls Set) |
| Bedrock timeout (AbortController) | Done, 60s default |
| Context-aware diff | Done (3-line context + @@ headers) |
| Rollback (gitBackup restore) | Fixed — was a no-op |
| Test file safety gate | Done (HIGH_RISK_PATTERNS) |
| Rate limiting + input cap | Done (express-rate-limit) |
| Token usage SSE | Done (sidebar live update) |
| Session TTL eviction | Done (2hr idle auto-cleanup) |
| Approval timeout | Done (5min auto-reject) |
| tiq_workplace alignment | Done (system prompt, commands, patterns) |
| GitHub Actions CI | Created (.github/workflows/ci.yml) |
| README | Fixed (port, path, stack, admin URL) |

**Total tests: 75 unit + 28 e2e = 103 tests passing**

### Ready for lead review

Agent is in final pre-review state. All known production drawbacks fixed. Once lead approves, `TIQ_CODEBASE_PATH` is pointed at the real TIQ codebase and `NIGHT_MAINTENANCE_CRON` is set.

---

## May 27, 2026 (Session 3) — Aligned agent with tiq_workplace (sample codebase)

### Context
`tiq_workplace` is the sample codebase for development/review phase. Once lead approves the agent, it will be pointed at the real TIQ codebase. Until then, all tools, commands, and prompts are aligned to `tiq_workplace`.

### What changed

**System prompt** — completely rewritten codebase section:
- Old: MERN monolith (`backend/src/controllers/`, `models/`, Express, MongoDB)
- New: TypeScript microservices (Fastify, PostgreSQL, BetterAuth, 7 services)
- Services listed: auth, training, assessment, inference, notification, job-posting, payment
- Frontend: `consumer-app` + `admin-app` (both React + Vite + TypeScript)
- Verify commands section: tells Claude to use `npm --prefix backend/<service> test`

**runCommand whitelist** — updated for microservices:
- Added: `npm --prefix backend/<service> test` for all 7 services
- Added: `npm --prefix consumer-app/admin-app test/build`
- Added: `npx tsc --noEmit` for TypeScript type checking
- Error message updated to show correct examples

**HIGH_RISK_PATTERNS** — updated for TypeScript:
- Added: `config.ts`, `server.ts`, `app.ts`, `/config/`, `database.config`, `env.ts`
- Added: `auth-service/src/modules/auth/` (core auth — never auto-touch)
- Added: `__tests__/` (vitest directory convention in tiq_workplace)
- Removed: bare `'auth'` keyword (too broad — blocked unrelated utils)

**safetyGate.test.js** — rewritten for tiq_workplace paths, 75/75 passing

---

## May 27, 2026 (Session 2) — 6 production drawbacks fixed

Full audit of agent tools against the real TIQ codebase revealed 6 bugs/gaps that would cause silent failures in production. All fixed and tested.

### Fix 1 — `gitBackup` restore was silently a no-op (`src/tools/gitBackup.js`)

**Bug:** Scheduler calls `gitBackup({ action: 'restore' })` after a failed fix, but the function had no `action` parameter — it silently created another backup branch instead of rolling back.

**Fix:** Added `action` enum (`backup` | `restore`). `_lastBackupBranch` variable tracks the last checkpoint in the session. `restore` runs `git checkout <branch> -- .` against the TIQ codebase. Returns a clear error if no prior backup exists.

**Why it matters:** The entire rollback safety net was broken. Agent could apply a bad fix, tests fail, rollback called, nothing happens — codebase stays broken.

---

### Fix 2 — `runCommand` whitelist had `npm test` which doesn't exist in TIQ (`src/tools/runCommand.js`)

**Bug:** TIQ's `backend/package.json` has no `test` script — only `dev`, `start`, `seed`. `npm test` would always fail with "missing script: test". Agent could never verify its own fixes.

**Fix:** Added TIQ-specific commands: `npm --prefix backend run build`, `npm --prefix frontend run build`, `npx eslint backend/src`. Added `npx vitest run`, `npx jest`. Removed `git push origin` (dangerous). Timeout raised 30s → 60s. Tool description updated to tell Claude: "TIQ has no top-level npm test — use build or lint to verify."

---

### Fix 3 — `searchCode` was plain `includes()` only, no regex, only 50 results (`src/tools/searchCode.js`)

**Bug:** Searching `user` matched `userController`, `getUserById`, `isUserAdmin`, `currentUser` — 200+ noise results. No way to search `^export function` or `require\(.+\)`. Hard cap of 50 results could miss important matches.

**Fix:** Added `is_regex` boolean param — uses `new RegExp(keyword, 'i')` when true. Added `max_results` param (default 100, max 300). Added `.yaml/.yml/.sh/.env` to searched file types. Invalid regex returns a clean error message instead of crashing.

---

### Fix 4 — `writeFile` diff was index-based, showed 500 lines for a 1-line change (`src/tools/writeFile.js`)

**Bug:** Naive line-by-line index comparison. Add one line at top of file → every subsequent line shows as "changed". 500-line diff for a 1-line fix. User can't review it properly.

**Fix:** Context-aware diff with `@@ line N @@` headers. Shows 3 lines of context before/after each change group. A 1-line change in a 500-line file now shows ~7 lines. Grouped consecutive changes so related edits appear together.

---

### Fix 5 — Autonomous maintenance tool budget was 8 — not enough for multi-file fix (`src/agent.js` + `src/scheduler.js`)

**Bug:** Maintenance mode needs `git_backup → show_diff → write_file → run_command` per issue = 4 calls. With 5 issues that's 20 calls. Budget was 8 → maintenance silently stops after 2 fixes.

**Fix:** Added `toolBudget` parameter to `runAgent()` (default 8 for web users). Scheduler passes `toolBudget=20` for autonomous maintenance runs.

---

### Fix 6 — Scheduler `runAgent` had no `sessionId` — tool calls polluted default session (`src/scheduler.js`)

**Bug:** Scheduler called `runAgent(..., 'maintenance-scheduler')` without `sessionId`. All maintenance tool calls went into the `'default'` bucket in `session.js`, mixing with web user logs.

**Fix:** Scheduler now passes `'maintenance-scheduler'` as `sessionId`. Maintenance history is fully isolated from web users' `recall_session` results.

---

### Final state after May 27 Session 2
- 74/74 tests passing
- 6 production bugs fixed
- Rollback works correctly
- TIQ-specific commands in whitelist
- Regex search available
- Context-aware diff for human review
- Maintenance budget 20 tool calls

---

## May 27, 2026 — Deep audit + all remaining gaps fixed

### Overview

Full audit of the agent was done — identified every gap between "working" and "production-ready." Fixed all of them in one session. Test count went from 46 → 74. All 74 passing.

---

### Problem identified: "Judge aur Criminal" problem

Agent apna khud ka code likhta tha aur khud test bhi karta tha — matlab ek hi insaan judge bhi tha aur criminal bhi. Agar agent test file tod deta toh koi rokne wala nahi tha.

**Solution implemented:**
1. `HIGH_RISK_PATTERNS` mein `tests/`, `.test.`, `.spec.` add kiye — agent in files ko touch nahi kar sakta
2. `isHighRisk` export kiya taaki independently test ho sake
3. Autonomous maintenance prompt mein rule likha: "NEVER touch test files"
4. GitHub Actions CI setup kiya — ek independent baahri judge jo har push par tests chalata hai

---

### What was fixed (date: May 27)

#### 1. Token waste — 3 optimizations

**Token truncation** (`src/utils/truncate.js` — NEW file)
- Tool results ko 3000 characters par cap kiya
- Pehle ek `list_files` call 15,000+ chars return kar sakti thi — poora context fill ho jata tha
- Ab: `...[truncated 12847 chars — use a narrower query if more detail is needed]`
- 8 unit tests added for boundary cases

**History reduction** (`src/index.js`, `src/web/router.js`)
- Conversation history -20 → -8 messages
- Ek turn mein average 4-5 tool calls hoti hain, 8 messages enough hai context ke liye

**Prompt caching default ON** (`src/config.js`)
- Bug fix: `=== 'true'` (default OFF) → `!== 'false'` (default ON)
- Ye ek silent bug tha — har deployment par caching off thi, ~30% extra tokens waste ho rahe the

---

#### 2. Dispatcher confidence scoring fix (`src/dispatcher.js`)

**Pehle:** Single keyword match — "explain how to fix" → `explain` milta, type = `query`

**Ab:** Multi-keyword scoring — har keyword ka count karo, highest score jeet ta hai
- "explain how to fix" → `explain:1, fix:1` → tie → `TYPE_PRIORITY` se `maintenance` jeet ta hai (priority 2 > 0)
- `/gi` flag se case-insensitive aur multiple matches count hoti hain
- `WRITE_SCOPE` ek shared object — feature aur maintenance dono same reference use karte hain (no duplication)

---

#### 3. Per-session log isolation (`src/session.js`) — PRIVACY BUG FIX

**Bug:** Global `log[]` array thi — User A `read_file` kare aur User B `recall_session` kare toh User B ko User A ka history dikhe ga.

**Fix:** `Map<sessionId, LogEntry[]>` — har user ka log alag
- `recordToolCall(name, input, summary, sessionId)` — sessionId parameter add kiya
- `getLog(sessionId)` — sirf us session ka log
- `clearLog('*')` — sab sessions clear (admin use)
- `agent.js` → `router.js` → `recallSession.js` sab update kiye taaki sessionId thread ho
- 7 isolation tests added

---

#### 4. Tool call deduplication (`src/agent.js`)

Claude kabhi kabhi ek hi tool ko same arguments ke saath do baar call kar deta tha ek turn mein.

**Fix:** `seenCalls = new Set()` keyed on `name:JSON(input)`
- Duplicate call pe: actual execution nahi hoti, `[duplicate]` message return hota hai
- Tool budget waste nahi hota

---

#### 5. Bedrock call timeout (`src/agent.js` + `src/config.js`)

**Problem:** Hung Bedrock call SSE connection ko forever open rakhti thi — server memory leak.

**Fix:** `AbortController` har `callBedrock` call ko wrap karta hai
- Default timeout: 60 seconds (`BEDROCK_TIMEOUT_MS` env var se configurable)
- Timeout pe clear error message user ko dikhta hai

---

#### 6. Memory leaks fix (`src/web/router.js`) — MAJOR REWRITE

**sessions Map leak:**
- Sessions kabhi delete nahi hote the — server days chalane ke baad memory full
- Fix: TTL-based cleanup — 2 ghante idle sessions auto-delete, har 30 min check

**pendingApprovals leak:**
- User browser band kar de toh approval forever pending rehti thi
- Fix: 5-minute auto-reject timeout — auto `no` resolve karta hai, session mein `timed_out` status mark karta hai

**Rate limiting:**
- `/api/chat` → max 15 queries/min per IP
- `/api/scan` → max 5/min per IP
- `express-rate-limit` package install kiya

**Input cap:**
- User 100,000 char question bhi bhej sakta tha — Bedrock crash
- Fix: 4000 char cap on `/api/chat`

---

#### 7. Token usage SSE + UI display

**Backend (`src/agent.js`):**
- Bedrock `response.usage` → `[Tokens] in:X out:X cache_read:X` console log

**Web UI (`src/web/public/index.html`):**
- Sidebar mein 3 new stat rows: "Tokens in", "Tokens out", "Cache hits"
- `token_usage` SSE event → live update karta hai har Bedrock call ke baad
- Rate limit (429) error → user ko friendly message dikhta hai
- `.wi-status.timed_out` CSS class → approval badge ke liye

---

#### 8. Safety gate — test files protect karna (`src/scheduler.js`)

Agent ki autonomous maintenance sab files touch kar sakti thi — including test files.

- `HIGH_RISK_PATTERNS` mein `'tests/'`, `'.test.'`, `'.spec.'` add kiye
- `isHighRisk` export kiya — independently testable
- Autonomous prompt mein Rule 2: "NEVER touch test files"
- `rollbackLastWrite(label)` — agar post-fix tests fail ho toh `git_backup({action:'restore'})` call karta hai
- Pre-fix check bhi: agar fix se pehle hi tests fail hain toh auto-fix skip karo

---

#### 9. Scheduler auto-rollback (`src/scheduler.js`)

Autonomous maintenance mein agar fix apply karne ke baad tests fail ho toh:
1. `run_command("npm test")` → exit code check
2. Exit code ≠ 0 → `rollbackLastWrite()` → `git_backup({action:'restore'})`
3. Log mein note: "fix reverted — tests failed"

---

### Tests added this session

| File | Tests | What they cover |
|------|-------|----------------|
| `tests/unit/truncate.test.js` | 8 | Under/at/over limit, truncation message format, empty string, JSON passthrough |
| `tests/unit/session.test.js` | 7 | Per-session isolation, copy safety, stats accuracy, wildcard clear, unknown session |
| `tests/unit/safetyGate.test.js` | 7 | `isHighRisk()` blocks test files, allows safe utility files |
| `tests/unit/dispatcher.test.js` | Updated | Confidence scoring, tie-break, scope isolation |

**Total: 46 → 74 tests (all passing)**

---

### Files changed (May 27)

| File | Change |
|------|--------|
| `src/session.js` | Global log → per-session Map |
| `src/agent.js` | SessionId threading, dedup, AbortController timeout, truncateResult |
| `src/config.js` | Prompt cache default ON, bedrockTimeoutMs added |
| `src/dispatcher.js` | Multi-keyword confidence scoring, TYPE_PRIORITY tie-break |
| `src/scheduler.js` | Test file safety gate, auto-rollback, isHighRisk export |
| `src/web/router.js` | TTL session cleanup, approval timeout, rate limiting, input cap, token SSE |
| `src/utils/truncate.js` | NEW — tool result truncation util |
| `src/tools/recallSession.js` | Uses _sessionId from extras |
| `src/web/public/index.html` | Token stats sidebar, rate limit error, timed_out CSS |
| `tests/unit/*.test.js` | 3 new test files, 1 updated |

---

## May 26, 2026 — Secret scanner, dep updater, admin panel, full UI overhaul

### What shipped

**2 new tools:**

`secret_scanner` — scans entire codebase for accidentally committed API keys, tokens, passwords. Regex patterns for AWS keys, JWT secrets, DB passwords, Stripe keys, private keys. Returns file:line citations with the matched pattern type. Context: one leaked key in a GitHub repo can mean a full security breach — this tool makes secret detection a one-command operation.

`dep_updater` — checks all npm packages against npm registry, categorises outdated ones by risk: patch (safe), minor (usually safe), major (breaking changes likely). Returns `safe_update_command` for patches. Context: outdated dependencies are the most common source of silent bugs and CVEs — checking them manually is tedious, this makes it a 1-click operation.

**Notification system** (`src/notifications.js`)
- Scheduler maintenance results now create persistent notifications
- Bell icon in header shows unread count
- `/api/notifications` returns last N notifications
- `/api/notifications/read-all` marks all read

**Admin panel** — merged into main `index.html` (no separate URL):
- Stats: total actions, critical TODOs, lint errors, dead code, uncommitted files, missing env vars, recent commits
- Cron schedule display with next-run countdown
- Maintenance reports list
- Activity log (last 20 actions with user + timestamp)
- Trigger maintenance manually

**UI overhaul (`src/web/public/index.html`):**
- Thinking animation (animated dots while agent works)
- Live tool call chips — pulse while running, green checkmark when done
- Copy button on every code block
- Maintenance banner in header with pulsing dot
- Auto-refresh toggle for admin panel
- Write history tab — shows every file change attempt with approved/denied/pending status
- Approvals tab — file diff viewer with one-click approve/deny

---

## May 23, 2026 — Semi-autonomous maintenance system

### What shipped

`src/scheduler.js` — the core of the autonomous maintenance loop:

**Night deep maintenance (2am daily):** Full scan → identify issues → for each issue above confidence threshold (55/100): git backup → show diff → write fix → run tests → verify. Rollback if tests fail.

**Day light scan (every 2 hours):** Health check only — no writes, just observe and notify.

**Manual trigger:** `POST /api/maintenance/trigger` → runs immediately, streams progress via SSE.

**Why 55/100 confidence threshold:** Below 55, the fix is a guess — risks introducing new bugs. Above 55, fix_error has traced the full call stack and identified a specific line. This is the dividing line between "I think I know" and "I know."

**Tool: `fix_error`** — the meta-tool that powers autonomous maintenance:
1. Parse error text → extract file path + line number
2. `read_file` on the erroring file + its imports
3. Identify root cause
4. Return: confidence score (0-100), fix description, exact file edits needed, verification command

**Tool: `full_scan`** — runs all 10 maintenance checks in parallel:
health_check + find_todos + check_env_usage + detect_dead_code + lint (backend + frontend) + secret_scanner + dep_updater + db schema check

Returns unified summary with severity counts. Designed to be the "opening move" for any maintenance session — one call instead of 10.

---

## May 22, 2026 — fix_error tool + UI redesign

### What shipped

`fix_error` meta-tool wired into agent + dispatcher. Claude now has a decision tree:
- User pastes error → `fix_error` → confidence ≥ 55 → full fix pipeline
- Confidence < 55 → ask user to confirm before touching any file

UI redesigned with TIQ brand palette (dark orange + dark teal). Left sidebar with tool list. Right sidebar with session stats + memory. Progress strip shows tool call chain in real time.

---

## May 21, 2026 — GitHub OAuth + audit trail + approval gates (Week 4 complete)

### What shipped

**GitHub OAuth** (`src/web/auth.js`):
- "Sign in with GitHub" → Passport.js OAuth flow
- Agent tags every action with real GitHub username
- `GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET` in `.env`

**Audit trail** (`src/activityLog.js`):
- Every query, tool call, write attempt, approval logged with user + timestamp
- Persisted to `activity-log.json` (gitignored)
- `/api/activity` endpoint for admin view

**Write archive** (`src/writeArchive.js`):
- Every `write_file` call (approved or denied) archived with before/after content
- Rollback possible from admin panel

**Approval gates** (redesigned in `router.js`):
- `approval_needed` SSE event → browser shows diff modal
- `/api/approve` with `{ approvalId, decision }` → resolves the pending Promise in agent loop
- Agent waits (async) — Bedrock call is paused until human decides

**Session memory** (right sidebar):
- Files read this session with access count
- Tool calls timeline
- Writes with approved/denied status

---

## May 20, 2026 — Week 4 (full plan)

### Overview

Completed the entire Week 4 plan in one session. Tool count went from 16 → 20. Added the Web UI (Express + SSE + single-file HTML frontend), Bedrock prompt caching, and four new tools.

---

### New tools

#### `git_log` (`src/tools/gitLog.js`)
Returns recent git commit history — short hash, author, date, message. Accepts a `count` param (max 50), a `file_path` to scope to commits that touched a specific file, and a `since` date filter. Used by Claude when writing commit messages or auditing what changed recently.

Why: "What changed in the last week?" and "who last touched this file?" are real daily questions on a dev team. `git_log` answers both in one tool call instead of the agent having to run `run_command("git log ...")` and parse the raw output.

#### `health_check` (`src/tools/healthCheck.js`)
One-call codebase snapshot: total file count by extension, TODO/FIXME severity totals, uncommitted git files, env var gaps (missing from .env.example or documented-but-unused), and whether key config files exist. Takes no arguments.

Why: The ideal first thing to run at the start of any review session. Instead of the agent calling five different tools to get oriented, health_check gives the full picture in one call. It was designed to be the "opening move" — like a doctor doing a general exam before ordering specific tests.

#### `lint_file` (`src/tools/lintFile.js`)
Runs ESLint on a file or directory and returns structured output — errors and warnings grouped by file, each with line number, column, rule ID, and message. Auto-detects whether to use the backend or frontend ESLint binary based on the file path.

Why: Code review without linting is incomplete. Previously, the agent could read a file and describe issues based on what it saw, but it couldn't run the actual linter. Now it can run lint before suggesting a refactor and after applying a fix — closing the loop. The structured JSON output (not raw ESLint text) makes it easy for Claude to cite specific line numbers.

#### `db_query` (`src/tools/dbQuery.js`)
Read-only SQL SELECT queries against the TIQ World dev PostgreSQL database via SSM tunnel on localhost:5433. Enforces read-only at the session level (`SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY`) and blocks INSERT/UPDATE/DELETE/DROP and all other write keywords before the query even reaches the DB. Returns up to 100 rows with column names.

Why: This is the feature that makes TIQ's agent genuinely different from generic AI coding tools. No off-the-shelf tool knows how many interns are enrolled in which tracks, or which submissions got an AI score of 5, or which certificates were issued this month. This tool makes that data directly queryable from the agent. The SSM tunnel is already part of the TIQ dev setup, so the infrastructure is already there — this tool just wires into it.

---

### Web UI (`src/web/`)

**`src/web/server.js`** — Express server with three endpoints:
- `GET /api/status` — health ping, returns tool count + model name
- `POST /api/clear` — reset a session's conversation history and session log
- `GET /api/chat` — SSE endpoint that streams the agent's tool call events and final answer to the browser in real time

The chat endpoint uses Server-Sent Events (SSE) rather than WebSockets. SSE is simpler (standard HTTP, works through proxies, no upgrade handshake), and one-directional streaming from server to client is all we need — the user sends a message via query param, the server streams back events until `[DONE]`.

Conversation state is stored in a `Map` keyed by `sessionId` (a UUID generated by the browser on load). Each session has `history` (last 20 messages, same trimming as the CLI) and `taskType` (locked on the first message of each session, same as the CLI).

**`src/web/public/index.html`** — single-file frontend (no build step, no framework):
- Dark theme chat interface with animated thinking dots while the agent works
- Live tool call chips appear as each tool fires — pulse animation while running, green dot when the turn ends
- Task type bar appears after the first message and stays visible for the session
- Example query chips on the empty state so you can start immediately
- Minimal markdown renderer for code blocks, inline code, bold, headers
- Shift+Enter for newline, Enter to send
- Tool count in header auto-fetched from `/api/status` on load

Why a single HTML file with no framework: the CLI is already the primary interface. The web UI is for showing the agent to the lead in a review — it needs to just work when you clone the repo and run `npm run web`, without a build step, a separate React server, or any extra setup.

**To start the web UI:**
```
npm install
npm run web
# → http://localhost:3001
```

---

### Bedrock prompt caching (`src/agent.js`)

Added opt-in prompt caching via the `cachePoint` block after the system prompt. When `ENABLE_PROMPT_CACHE=true` in `.env`, the system prompt is sent with a cache marker to Bedrock. Bedrock caches the processed system prompt tokens and reuses them on subsequent turns in the same session — skipping the cost and latency of re-processing the same ~800-token system prompt on every single API call.

Expected savings on a 10-turn session: ~60% reduction in input token cost for those tokens. The system prompt is the largest fixed cost per call, and caching is the right place to apply this optimization because the prompt never changes within a session.

Kept it opt-in (`ENABLE_PROMPT_CACHE=false` default) because Bedrock caching availability varies by region and model version — don't want it to silently break on a new setup.

---

### Updated files

- `src/config.js` — added `dbUrl`, `webPort`, `enablePromptCache`
- `package.json` — added `express`, `pg` deps; added `web` and `web:dev` npm scripts; bumped version to `0.4.0`
- `src/agent.js` — wired 4 new tools, added `onEvent` callback param (used by SSE server to push tool call events to browser), added prompt caching system blocks
- `src/dispatcher.js` — added `git_log`, `health_check`, `lint_file`, `db_query` to `READ_ONLY` scope; added `health`, `log`, `lint`, `query`, `select` to query classifier keywords
- `.env.example` — documented all new vars with comments

---

### Final tool count: 20

| Category | Tools |
|----------|-------|
| Exploration (4) | list_files, read_file, search_code, recall_session |
| Analysis (12) | trace_error, map_dependencies, explain_route, find_todos, check_env_usage, detect_dead_code, schema_to_api, summarize_diff, git_log, health_check, lint_file, db_query |
| Write + verify (4) | show_diff, git_backup, write_file, run_command |

---

### Week-by-week summary

| Week | Focus | What shipped |
|------|-------|--------------|
| 1 | CLI + read tools | list_files, read_file, search_code, system prompt, config |
| 2 | Fix + write safety | write_file, show_diff, run_command, approval gate, auto-context loader |
| 3 | Code review + bug detection | trace_error, map_dependencies, explain_route, git_backup, dispatcher registry |
| 3 (late) | Architecture + new tools | find_todos, check_env_usage, summarize_diff, detect_dead_code, schema_to_api, recall_session, shared fs utils, ALL_TOOLS registry |
| 4 | Web UI + DB + polish | git_log, health_check, lint_file, db_query, Web UI (SSE), prompt caching, version 0.4.0 |

---

## May 18, 2026

Built three new tools for Week 3: `trace_error`, `map_dependencies`, `explain_route`. Tool count: 6 → 9.

---

## May 11, 2026

Pushed all local commits. Realised commit trail was missing entirely — fixed discipline going forward.

---

## May 9, 2026 (Leave)

Planned the real tool-use loop. Key insight: Claude must control the loop, not the orchestrator code.

---

## May 8, 2026

Week 1 retro. Set Week 2 goals. Designed approval gate flow.

---

## May 7, 2026

End-of-week cleanup. Search truncation issue noted. EXCLUDE_DIRS confirmed working.

---

## May 6, 2026

System prompt updated with TIQ-specific context. Hallucination reduced.

---

## May 5, 2026

First real test against TIQ codebase. Fixed import path bug, hallucination guard, search overload.

---

## May 2, 2026

Built config/settings.py. Centralized all configuration.

---

## May 1, 2026

First day. Built agent.py, tools.py, prompts.py. Left out write_file intentionally.

---

## April 28–30, 2026

Research: Anthropic tool use docs, gitpython, psycopg2. Decision: no auto-push, no delete without human.

---

## April 25–27, 2026

Tool list design. Identified DB access as the unique differentiator.

---

## April 23–24, 2026

Architecture planning. Wrote system-design.md. Chose tool-use over text-dumping.

---

## April 22, 2026

Project assigned. GitHub repo created. v0.1 foundation built.
