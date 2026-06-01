# TIQ World AI Agent — Dev Log

*Daily progress log for the TIQ World AI Agent project.*

---

## June 1, 2026 — Agent workflow review + MCP integration check

### What I did

Full end-to-end workflow review session. Verified agent connects correctly to `sample_codebase` (Shalin-mish/sample_codebase) as the target repo. Traced tool call path: user query → dispatcher classification → tool scope selection → Bedrock API → tool execution → result.

Checked MCP server connections:
- **github MCP** — confirmed `mcp__github__get_file_contents`, `mcp__github__create_or_update_file`, `mcp__github__search_code` all responding
- **postgres-tiqworld-dev MCP** — SSM tunnel on localhost:5433 required before `db_query` tool fires
- **playwright MCP** — available for e2e test runs
- **chrome-devtools MCP** — available for frontend debugging

Ran `health_check` tool against sample_codebase — returns file counts, git status, env gaps. All clean.

**What changed:** No code changes — review + documentation day.

**Why:** Before adding any new feature, full workflow must be verified so regressions don't sneak in.

---

## May 29, 2026 — branch_write tool + 27 tools total + session persistence

### What I did

**New tool: `branch_write` (src/tools/branchWrite.js)**

Needed a safer write path for multi-file changes — writing directly to working branch is risky. `branch_write` creates a new git branch, applies the change, and returns the branch name so a PR can be opened for review. This enforces the PR workflow even for agent-initiated changes.

Flow:
1. Check `isHighRisk()` — same gate as `write_file`
2. `git checkout -b agent/fix-<timestamp>` on target repo
3. Show diff, require approval
4. Write file, commit with message
5. Return branch name → Claude can call `mcp__github__create_pull_request`

**Session persistence** — sessions now survive server restarts. Each session serialized to `logs/sessions/{sessionId}.json` on every tool call. On startup, recent sessions (< 2hr old) reloaded into memory. This means agent can resume mid-conversation after a crash.

**Test count:** 103 → 151 tests. New tests: branchWrite safety gates (12), session persistence load/save (18), integration test for branch→PR flow (18).

**Why:** `write_file` writes directly — fine for simple fixes. Multi-file refactors need branch isolation. Session persistence needed because Bedrock calls sometimes timeout and user has to restart — losing all context was annoying.

### Test results
- 151/151 tests passing
- `branch_write` blocked all 6 high-risk scenarios correctly
- Session reload: 4/4 test scenarios pass

---

## May 28, 2026 (Session 7) — Production safety hardening: self-protect, confidence, command allowlist

### What changed

**Critical Fix 1 — Agent self-protection (writeFile.js + scheduler.js)**

Agent can now NEVER autonomously modify its own source code or DB migrations. Two hard blocks added — one at tool level (writeFile.js), one at scheduler gate (HIGH_RISK_PATTERNS):

Protected forever (write blocked regardless of caller):
- Agent source: `src/tools/`, `src/agent.js`, `src/scheduler.js`, `src/config.js`, `src/web/server.js`, `src/web/router.js`, `ecosystem.config`
- DB migrations: `migrations/`, `migration.*`, `schema.prisma`, `prisma/schema`, `seeds/`, `seeders/`

Why this matters: Without this, a sufficiently persuasive prompt could cause the agent to modify its own safety gates and bypass every protection. Self-modification = catastrophic failure mode.

**Critical Fix 2 — Auto-fix confidence threshold: 55 → 80 (config.js + .env.example)**

55% confidence meant nearly 1 in 2 auto-fixes could be wrong. Raised to 80%. `AUTO_FIX_MIN_CONFIDENCE=80` is now the documented default in `.env.example`.

**Critical Fix 3 — Command approval: prefix-match → exact allowlist (scheduler.js)**

Old: `startsWith('npm run test')` → `"npm run deploy"` would pass.

New: exact Set + strict pattern matching:
```
Exact: npm test | npm run test | npx eslint | node --check
With path arg: npx eslint <path> | node --check <path>
Monorepo pattern: npm --prefix <service> test
Everything else: BLOCKED
```

### Test results
- 75/75 unit tests pass
- Self-protect gate: 8/8 scenarios verified (6 blocked correctly, 2 pass-through correctly)

---

## May 28, 2026 (Session 6) — health_monitor + credential_guard (26 tools total)

### What changed

**New tool: `health_monitor` (src/tools/healthMonitor.js)**

Probes the live platform from agent side — zero platform code changes needed. Three signal layers:
1. **HTTP synthetic probes** — GET configured URLs, checks status code + response time (<3s threshold)
2. **Log anomaly scan** — scans `logs/activity.jsonl` for ERROR/CRITICAL/FATAL lines in last N minutes
3. **Node process vitals** — heap used/total, uptime, event-loop lag measurement

Config: `HEALTH_MONITOR_URLS` env var (comma-separated list). Default: `http://localhost:3001/api/status`.

Integrated into day scan cycle (every 2h) — DEGRADED or UNHEALTHY triggers `notify()` automatically.

New API endpoint: `GET /api/health-monitor` — on-demand live probe.

Admin tab — new "Platform Health" section with `▶ Run Now` button, shows verdict badge (score/100), per-check pills, URL probe results, log errors, process vitals.

**New tool: `credential_guard` (src/tools/credentialGuard.js)**

Automatic write-gate — every `write_file` pre-screened before touching disk. 13 detection rules:
- AWS Access Key ID (AKIA... pattern)
- PEM / SSH private keys
- Hardcoded passwords (`password = "..."`)
- DB connection strings with credentials embedded
- JWT secret literals
- GCP service account JSON, Azure storage keys
- Slack/Discord webhook URLs
- Generic API key/token assignments

Protected filenames (always blocked): `.env`, `.env.*`, `secrets.json`, `credentials.json`, `id_rsa`, `private.key`, `service-account.json`

Severity: HIGH → write blocked + logged. MEDIUM/LOW → warning logged, write proceeds.

Smart false-positive avoidance: `process.env.X` usage NOT blocked. Comment lines NOT blocked.

**Agent registry: 24 → 26 tools.**

### Test results
- 75/75 unit tests pass
- credential_guard: 8/8 detection tests pass
- health_monitor: live probe — HEALTHY/100 on localhost

---

## May 28, 2026 (Session 5) — UI overhaul: bilateral toggles, resizable sidebars, Admin tab default

### What changed

**Bilateral panel toggles (`position: fixed`, outside `.body`)**
- `#left-panel-toggle` — `‹` open, `›` collapsed. `left: var(--left-w)` tracks sidebar.
- `#right-panel-toggle` — `›` open, `‹` collapsed. `right: calc(var(--right-w) + 5px)` tracks panel.
- Both `position: fixed` — avoids clip from parent `overflow: hidden`.

**Drag-to-resize both sidebars**
- `#sidebar-resize-handle` — left sidebar right edge (position: fixed).
- `#right-resize-handle` — right sidebar left edge.
- Both persist width in `localStorage` (`tiq-sidebar-w`, `tiq-right-w`).
- Dynamic MAX_W: `viewport - opposite_sidebar - 320px` — chat area min 320px guaranteed.
- Double-click to reset to default width.

**Quick Actions — Admin Dashboard button** replaces old admin widget grid. Same style as other sidebar buttons. `openAdminTab()` helper opens right panel + switches to admin tab.

**`.sidebar-body` scrollable wrapper** — left sidebar content scrollable when narrow.

**Admin tab default on page load** — `switchTab('admin')` in boot unless `?tab=` URL param present.

**Bugs fixed this session:**
- Resize handle clipped by `overflow: hidden` → fixed with `position: fixed`
- Right panel collapse broken → `style.width` inline override → fixed with `!important` + clear on collapse
- Arrow directions reversed → corrected
- Right toggle 5px misalignment → `calc(var(--right-w) + 5px)`
- Chat area horizontal scrollbar → `min-width: 320px`
- e2e test `#sidebar-toggle` → `#left-panel-toggle`

### Test results
- 75/75 unit tests, 28/28 e2e tests pass
- Playwright UI: 12/12 checks pass, 0 browser errors

---

## May 28, 2026 (Session 4) — Right sidebar UI fixes + SSE reconnect + markdown

### What changed

**SSE auto-reconnect**
- `reconnect()` with exponential backoff (1s, 2s, 4s… max 30s)
- `[DONE]` check before `JSON.parse`
- `sse-reconnect-notice` UI element for user feedback
- `handleError()` graceful degradation

**7 right sidebar bug fixes:**
1. `thinkEl.remove()` on approval events — thinking indicator clears
2. `resolveApproval` try/catch
3. `resolveCommandApproval` try/catch
4. `addWriteItem` null-safe (`file ?? ''`)
5. `startMaintStream` null-check
6. `triggerMaintenance` disables all deep scan buttons
7. `onMessage` named function — proper `removeEventListener`

**Mobile layout** — `@media (max-width: 900px)` slide-up right panel, backdrop overlay.

**Admin tab** — clickable stat cards filter activity log.

**Markdown** — `~~strikethrough~~` → `<del>`, `_italic_` → `<em>`.

---

## May 27, 2026 (Session 4) — README fixed, full test suite verified

**README.md fixes:** port 3001, correct codebase path, TypeScript microservices stack, admin URL, verify commands section.

**Test run:** 75 unit + 28 e2e = 103 tests, all passing.

### Current state (May 28, 2026)

| Area | Status |
|------|--------|
| 26 tools | All wired, tested |
| Agent self-protection | Done (writeFile + scheduler) |
| DB migration guard | Done |
| Credential guard (write-gate) | Done, 13 rules |
| Health monitor | Done, 3 signal layers |
| Command exact-match allowlist | Done |
| Auto-fix confidence 80% | Done |
| Per-session log isolation | Done |
| Tool call deduplication | Done |
| Bedrock timeout 60s | Done |
| Context-aware diff | Done |
| Rollback (gitBackup restore) | Done |
| Test file safety gate | Done |
| Rate limiting + input cap | Done |
| Token usage SSE | Done |
| Session TTL eviction 2hr | Done |
| Approval timeout 5min | Done |
| tiq_workplace alignment | Done |
| GitHub Actions CI | Done |

**Total tests: 75 unit + 28 e2e = 103 passing**

---

## May 27, 2026 (Session 3) — Aligned agent with tiq_workplace microservices

**Context:** `tiq_workplace` is the dev/review codebase. Agent will point at real TIQ codebase once lead approves.

**System prompt** — rewritten: TypeScript microservices (Fastify, PostgreSQL, BetterAuth), 7 backend services, 2 React frontends.

**runCommand whitelist** — `npm --prefix backend/<service> test`, `npx tsc --noEmit`.

**HIGH_RISK_PATTERNS** — `config.ts`, `server.ts`, `app.ts`, `/config/`, `database.config`, `env.ts`, `auth-service/src/modules/auth/`, `__tests__/`.

**safetyGate.test.js** — rewritten for tiq_workplace paths.

---

## May 27, 2026 (Session 2) — 6 production bugs fixed (46 → 74 tests)

Full audit against real TIQ codebase.

**Fix 1 — `gitBackup` restore was a no-op** — added `action` enum. Rollback now actually restores.

**Fix 2 — `runCommand` had `npm test` (doesn't exist in TIQ)** — added TIQ-specific commands. Timeout 30s → 60s.

**Fix 3 — `searchCode` plain `includes()` only** — added `is_regex` param, `max_results` (default 100), more file types.

**Fix 4 — `writeFile` diff showed 500 lines for 1-line change** — context-aware diff with `@@ line N @@` headers, 3-line context.

**Fix 5 — Maintenance tool budget 8 (too low)** — `git_backup → show_diff → write_file → run_command` = 4 calls per fix. Scheduler now passes `toolBudget=20`.

**Fix 6 — Scheduler had no `sessionId`** — maintenance tool calls polluted `'default'` session. Now uses `'maintenance-scheduler'`.

---

## May 27, 2026 (Session 1) — Deep audit, all gaps fixed (46 → 74 tests)

**Judge & Criminal problem solved** — agent can no longer modify test files (`HIGH_RISK_PATTERNS`). GitHub Actions CI = independent external judge.

| Fix | What |
|-----|------|
| Token truncation | Cap tool results at 3000 chars (`src/utils/truncate.js` NEW) |
| History -20 → -8 | Reduce context window waste |
| Prompt cache default ON | `!== 'false'` (was `=== 'true'`) |
| Dispatcher confidence scoring | Multi-keyword, TYPE_PRIORITY tie-break |
| Per-session log isolation | Global `log[]` → `Map<sessionId>` — privacy fix |
| Tool call dedup | `seenCalls = new Set()` keyed on `name:JSON(input)` |
| Bedrock timeout | `AbortController`, 60s default |
| Session TTL eviction | 2hr idle auto-delete, 30min GC |
| Approval timeout | 5min auto-reject |
| Rate limiting | 15/min chat, 5/min scan |
| Input cap | 4000 char max on `/api/chat` |
| Token usage SSE | Live sidebar stats |
| Safety gate | `isHighRisk` exported + tested |
| Auto-rollback | Post-fix tests fail → `git_backup restore` |

---

## May 26, 2026 — Secret scanner, dep updater, admin panel, full UI overhaul

**New tools:**
- `secret_scanner` — scans codebase for leaked API keys, JWT secrets, passwords, private keys
- `dep_updater` — npm outdated by risk (patch/minor/major), `safe_update_command` for patches

**Notification system** (`src/notifications.js`) — persistent notifications, bell icon, webhook support.

**Admin panel** merged into `index.html` — stats grid, cron display, maintenance reports, activity log, manual trigger.

**UI overhaul** — thinking animation, live tool call chips, copy buttons, maintenance header banner, write history tab, diff viewer with approve/deny.

---

## May 25, 2026 — dep_updater groundwork + notification system design

### What I did

After May 23 scheduler was done, needed two things before the admin panel (May 26): dependency update tooling and a way to surface agent alerts to the user.

**dep_updater design session:**
- Ran `npm outdated` on sample_codebase manually to understand output format
- Mapped npm outdated JSON → risk categories: patch (safe), minor (review), major (breaking)
- Designed `safe_update_command` field — only patches get auto-command, minor/major require human decision
- Wrote initial `src/tools/depUpdater.js` skeleton with risk classifier

**Notification system (`src/notifications.js`) design:**
- Decided on in-memory array + file persistence (`logs/notifications.json`)
- Bell icon in UI header — badge count from `/api/notifications`
- Webhook support: POST to `NOTIFICATION_WEBHOOK_URL` (Slack/Discord compatible)
- Notification types: `maintenance_complete`, `auto_fix_applied`, `scan_alert`, `approval_needed`

**Why:** Admin panel on May 26 needs both of these wired before it can display useful data. Can't build the UI before the data layer exists.

### What changed
- `src/tools/depUpdater.js` — skeleton + risk classifier
- `src/notifications.js` — full implementation
- `src/web/server.js` — added `/api/notifications` + `/api/notifications/read-all` endpoints

---

## May 23, 2026 — Semi-autonomous maintenance system

`src/scheduler.js` — autonomous maintenance loop.

**Night (2am):** Full scan → issues → confidence ≥ threshold → git backup → diff → write → test → rollback if fail.

**Day (every 2h):** Health check only, no writes.

**`fix_error` tool** — parse error → read files → root cause → confidence score (0–100) + fix + verification command.

**`full_scan` tool** — 10 checks in parallel, one call instead of 10.

---

## May 22, 2026 — fix_error tool + UI redesign

`fix_error` wired into agent. Decision tree: error → confidence ≥ 55 → full pipeline; < 55 → ask user.

UI: TIQ brand palette (dark orange + teal), left sidebar tool list, right sidebar session memory, real-time progress strip.

---

## May 21, 2026 — GitHub OAuth + audit trail + approval gates

**GitHub OAuth** — Passport.js, real GitHub username on every action.

**Audit trail** (`src/activityLog.js`) — every action logged to `logs/activity.jsonl`.

**Write archive** (`src/writeArchive.js`) — before/after content for every `write_file`.

**Approval gates** — `approval_needed` SSE → browser diff modal → `/api/approve` → resolves async Promise. Bedrock call paused until human decides.

---

## May 20, 2026 — Week 4: Web UI, DB access, 4 new tools (16 → 20 tools)

**New tools:** `git_log`, `health_check`, `lint_file`, `db_query` (read-only PostgreSQL via SSM tunnel).

**Web UI (`src/web/`):**
- `server.js` — Express + SSE
- `index.html` — single file, no build step, dark theme, live tool chips, markdown
- `npm run web` → `http://localhost:3001`

**Bedrock prompt caching** — system prompt cached, ~60% input token reduction on cached portion.

---

## May 19, 2026 — Week 3 tools testing + findTodos / checkEnvUsage / detectDeadCode / schemaToApi

### What I did

May 18 built the three core Week 3 tools (trace_error, map_dependencies, explain_route). Today: tested all three against `sample_codebase`, found edge cases, then built the remaining four analysis tools.

**Testing Week 3 tools:**
- `trace_error` — tested with a fake stack trace pointing to sample_codebase/test-agent.js. File path extraction working. Edge case found: Windows backslash paths in stack traces weren't parsed. Fixed with path normalization (`replace(/\\/g, '/')`).
- `map_dependencies` — ran on test-agent.js. Circular import detection working. Depth=4 got slow — added `maxDepth` cap.
- `explain_route` — no Express routes in sample_codebase, so tested against a copy of TIQ backend. Route → middleware → controller chain traced correctly.

**New tools built:**
- `find_todos` — scans for TODO, FIXME, HACK, DEPRECATED, BUG, XXX. Severity: BUG/FIXME = critical, HACK = warning, TODO/NOTE = info.
- `check_env_usage` — diffs `.env.example` keys vs `process.env.X` calls in source. Finds missing + unused keys.
- `detect_dead_code` — builds import graph, finds unreferenced files. Excludes known entry points.
- `schema_to_api` — given Mongoose model name, checks which CRUD operations are covered by routes/controllers.

**Tool count: 9 → 13**

**Why:** Week 3 goal was code review mode. These 4 tools are what make a real review useful — not just "read this file" but "what's missing, what's unused, what's undocumented."

---

## May 18, 2026

Tools `trace_error`, `map_dependencies`, `explain_route` built. Tool count: 6 → 9.

---

## May 15, 2026 — Week 3 start: error tracer design + tool architecture review

### What I did

Week 2 done. Starting Week 3 (May 15-21): code review mode + bug detection.

**Error tracer design session:**
Thought through `trace_error` architecture before writing any code.

Problem: given a stack trace, agent needs to understand the full error context — not just the top frame but every file in the chain. Design decisions:
1. Parse stack trace lines with regex: `at <function> (<file>:<line>:<col>)`
2. For each frame: read file, extract 10 lines of context around error line
3. Auto-extract keywords: route paths from Express patterns, class names, function names
4. Return structured object: `{ errorType, message, frames: [{ file, line, context, keywords }] }`

Also designed `map_dependencies` — realized a simple recursive import scanner would hit circular imports and hang. Solution: visited Set to track already-traversed files.

**Week 3 tool list finalized:**
- `trace_error` — stack trace → all involved files + context
- `map_dependencies` — import graph (incoming + outgoing)
- `explain_route` — Express route → full request flow
- `find_todos` — scan for TODO/FIXME/HACK/BUG
- `check_env_usage` — .env.example vs actual usage
- `detect_dead_code` — unreferenced files
- `schema_to_api` — Mongoose model → CRUD coverage check

**Why:** Designing before coding saved time. The circular import problem with map_dependencies would've taken hours to debug if I'd just started writing.

---

## May 14, 2026 — run_command tool + Week 2 wrap

### What I did

`run_command` tool built. Week 2 complete.

**`run_command` (src/tools/runCommand.js):**
- Allowlist approach from day 1 — not "block bad commands" but "only allow known-good commands"
- Allowed: `npm test`, `npm run test`, `npx eslint <path>`, `node --check <path>`, `git status`, `git log`, `git diff`
- Spawn with `execFile` not `exec` — no shell injection possible
- 60s timeout (Bedrock timeout is also 60s — matched intentionally)
- Captures stdout + stderr separately

**Why this matters:** `run_command` closes the fix loop. Before: agent could only write a fix and hope. Now: write fix → run tests → if tests fail → rollback. This is the verification step.

**Week 2 end-to-end test:**
Manually ran the full pipeline:
1. `find_todos` found a FIXME in test-agent.js
2. `read_file` read the file
3. `show_diff` showed proposed fix
4. `git_backup` created backup commit
5. `write_file` applied fix (approved via CLI)
6. `run_command npm test` — passed
7. Verified fix in git log

Full pipeline working end-to-end.

**Tool count: 5 → 6** (run_command added)

---

## May 13, 2026 — write_file + approval gate refinement

### What I did

Continued write_file work from May 12. Main focus: approval gate UX and diff quality.

**Approval gate:**
- CLI: `readline.question()` blocks until user types `y/n`
- Designed async version for future Web UI: `_approvalFn` callback parameter
- If no response in 5min → auto-reject (timeout added)

**Diff display improvements:**
- Context-aware: 3 lines before + after each changed block
- `@@ line N @@` headers like real git diff
- Unchanged lines shown with ` ` prefix, added with `+`, removed with `-`
- Groups adjacent changes into single hunk (avoids fragmented output)

**Edge case fixed:** If file doesn't exist yet (new file creation), diff shows entire new content as `+` lines — no crash.

**git_backup integration:**
- `git_backup` now called automatically inside `write_file` before any disk write
- No way to write without a backup — enforced at code level, not documentation level

**Why:** The diff display was too noisy yesterday — showed entire file for a 1-line change. Context-aware diff makes review actually usable.

---

## May 12, 2026 — show_diff + write_file initial build

### What I did

Week 2 main work: write tools. Built `show_diff` and started `write_file`.

**`show_diff` (src/tools/showDiff.js):**
- Takes `filePath`, `oldContent`, `newContent`
- Line-by-line diff using Myers diff algorithm (hand-rolled, no external dep)
- Returns formatted string with +/- lines
- Used by Claude before every write to confirm changes

**`write_file` initial build:**
- Safety check 1: is path inside `TIQ_CODEBASE_PATH`? — path traversal prevention
- Safety check 2: is it a high-risk file? — skips routes/, models/, auth/
- Calls `show_diff` first, always
- Calls `git_backup` before writing
- Then `fs.writeFileSync`

Not wired into agent yet — testing standalone first.

**`git_backup` (src/tools/gitBackup.js):**
- `git add -A && git commit -m "agent-backup: <timestamp>"` on target repo
- `action` param: `'backup'` (create) or `'restore'` (reset to last backup commit)
- Restore uses `git reset --hard <backupHash>`

**Why:** Write tools are the most dangerous part of the agent. Built them slowly with extra care — standalone test before wiring.

---

## May 11, 2026

Pushed all local commits. Commit trail discipline fixed going forward.

---

## May 9, 2026 (Leave)

Key insight: Claude must control the tool loop, not the orchestrator.

---

## May 8, 2026

Week 1 retro. Week 2 goals set. Approval gate flow designed.

---

## May 7, 2026

End-of-week cleanup. Search truncation noted. EXCLUDE_DIRS confirmed.

---

## May 6, 2026

System prompt updated with TIQ-specific context. Hallucination reduced.

---

## May 5, 2026

First real test against TIQ codebase. Fixed import path bug, hallucination guard, search overload.

---

## May 4, 2026 — Tool response format + auto-import + prompt caching

### What I did

After May 2 config setup, focused on three improvements from Week 1 goals:

**Tool response format:**
- Old: tools returned raw file content as plain string
- New: structured response object `{ filePath, lineCount, lastModified, content, imports: [] }`
- Agent now has metadata without parsing — knows file size before reading, can decide if worth loading

**Auto-import in `read_file`:**
- When reading a file, agent auto-detects local imports (`require('./...')` or `import from './...'`)
- Resolves up to 2 levels deep
- Returns all imported files inline — reduces round trips from N reads to 1

**Prompt caching (`ENABLE_PROMPT_CACHE`):**
- System prompt is ~2000 tokens — repeated every single Bedrock call
- Added `cache_control: { type: 'ephemeral' }` marker after system prompt
- Cache hit = ~60% reduction in input tokens per session
- Default: OFF (need to verify Bedrock caching behavior before enabling by default)

**Tested against TIQ codebase:**
- Read `backend/src/routes/auth.js` → auto-loaded `../controllers/authController.js` + `../middleware/auth.js`
- All three files returned in one tool call instead of three

**Why:** Reducing tool calls per query matters — Bedrock has rate limits and each round trip adds latency. Auto-import cuts a typical "explain this route" session from 6 tool calls to 2.

---

## May 2, 2026

config/settings.py built. Configuration centralized.

---

## May 1, 2026

First day. Built agent.py, tools.py, prompts.py. Left out write_file intentionally.

---

## April 28–30, 2026

Research: Anthropic tool use docs, gitpython, psycopg2. Decision: no auto-push, no delete without human.

---

## April 25–27, 2026

Tool list design. DB access identified as the unique differentiator.

---

## April 23–24, 2026

Architecture planning. system-design.md written. Tool-use over text-dumping chosen.

---

## April 22, 2026

Project assigned. GitHub repo created. v0.1 foundation built.
