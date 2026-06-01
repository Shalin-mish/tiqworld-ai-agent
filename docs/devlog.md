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

Old: `startsWith('npm run test')` — `"npm run deploy"` would pass.

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
1. **HTTP synthetic probes** — GET configured URLs, checks status code + response time
2. **Log anomaly scan** — scans `logs/activity.jsonl` for ERROR/CRITICAL/FATAL lines in last N minutes
3. **Node process vitals** — heap used/total, uptime, event-loop lag measurement

**New tool: `credential_guard` (src/tools/credentialGuard.js)**

Automatic write-gate — every `write_file` pre-screened before touching disk. 13 detection rules covering AWS keys, PEM keys, hardcoded passwords, DB connection strings, JWT secrets, and more.

**Agent registry: 24 → 26 tools.**

### Test results
- 75/75 unit tests pass
- credential_guard: 8/8 detection tests pass
- health_monitor: live probe — HEALTHY/100 on localhost

---

## May 28, 2026 (Session 5) — UI overhaul: bilateral toggles, resizable sidebars, Admin tab default

### What changed

Bilateral panel toggles with `position: fixed`. Drag-to-resize both sidebars with localStorage persistence. Admin tab default on page load. 6 bugs fixed including resize handle clip, arrow directions, right panel collapse.

### Test results
- 75/75 unit tests, 28/28 e2e tests pass

---

## May 28, 2026 (Session 4) — Right sidebar UI fixes + SSE reconnect + markdown

### What changed

SSE auto-reconnect with exponential backoff. 7 right sidebar bug fixes. Mobile layout. Markdown strikethrough and italic support.

---

## May 27, 2026 (Session 4) — README fixed, full test suite verified

README.md fixes for port, codebase path, TypeScript stack. Test run: 75 unit + 28 e2e = 103 tests passing.

### Current state (May 28, 2026)

| Area | Status |
|------|--------|
| 26 tools | All wired, tested |
| Agent self-protection | Done |
| Credential guard | Done, 13 rules |
| Health monitor | Done, 3 signal layers |
| Command exact-match allowlist | Done |
| Auto-fix confidence 80% | Done |
| GitHub Actions CI | Done |

---

## May 27, 2026 (Session 3) — Aligned agent with tiq_workplace microservices

System prompt rewritten for TypeScript microservices stack. runCommand whitelist updated. HIGH_RISK_PATTERNS updated for tiq_workplace paths.

---

## May 27, 2026 (Session 2) — 6 production bugs fixed (46 → 74 tests)

Fix 1: gitBackup restore was a no-op. Fix 2: runCommand missing TIQ-specific commands. Fix 3: searchCode regex support. Fix 4: writeFile context-aware diff. Fix 5: Maintenance tool budget 8→20. Fix 6: Scheduler sessionId isolation.

---

## May 27, 2026 (Session 1) — Deep audit, all gaps fixed

Judge and Criminal problem solved — agent cannot modify test files. GitHub Actions CI = external judge. 14 fixes including token truncation, history cap, prompt cache default, dispatcher confidence scoring, session isolation, tool dedup, Bedrock timeout, rate limiting.

---

## May 26, 2026 — Secret scanner, dep updater, admin panel, full UI overhaul

New tools: `secret_scanner`, `dep_updater`. Notification system. Admin panel. Full UI overhaul with thinking animation, live tool chips, diff viewer.

---

## May 25, 2026 — dep_updater groundwork + notification system design

### What I did

After May 23 scheduler was done, needed two things before the admin panel (May 26): dependency update tooling and a way to surface agent alerts to the user.

**dep_updater design:** npm outdated JSON mapped to risk categories (patch/minor/major). Only patches get auto-command, minor/major require human decision.

**Notification system design:** In-memory array + file persistence at `logs/notifications.json`. Bell icon with badge count. Webhook support for Slack/Discord.

**Why:** Admin panel on May 26 needs both of these wired before it can display useful data.

### What changed
- `src/tools/depUpdater.js` — skeleton + risk classifier
- `src/notifications.js` — full implementation
- `/api/notifications` + `/api/notifications/read-all` endpoints added

---

## May 23, 2026 — Semi-autonomous maintenance system

`src/scheduler.js` built. Night maintenance at 2am: full scan → confidence check → git backup → fix → test → rollback if fail. Day scan every 2h: health check only, no writes. `fix_error` and `full_scan` tools added.

---

## May 22, 2026 — fix_error tool + UI redesign

`fix_error` wired. Decision tree: confidence >= 55 → full pipeline; < 55 → ask user. UI redesigned with TIQ brand palette.

---

## May 21, 2026 — GitHub OAuth + audit trail + approval gates

GitHub OAuth via Passport.js. Activity log to `logs/activity.jsonl`. Write archive with before/after content. Approval gates: SSE → browser diff modal → async Promise resolution.

---

## May 20, 2026 — Week 4: Web UI, DB access, 4 new tools (16 → 20 tools)

New tools: `git_log`, `health_check`, `lint_file`, `db_query`. Web UI with SSE streaming at http://localhost:3001. Bedrock prompt caching enabled.

---

## May 19, 2026 — Week 3 tools testing + 4 new analysis tools

Tested trace_error, map_dependencies, explain_route against sample_codebase. Fixed Windows backslash parsing in trace_error. Built 4 new tools: `find_todos`, `check_env_usage`, `detect_dead_code`, `schema_to_api`. Tool count: 9 → 13.

**Why:** Week 3 goal was code review mode. These tools answer "what's missing, what's unused, what's undocumented" — not just "read this file."

---

## May 18, 2026

Tools `trace_error`, `map_dependencies`, `explain_route` built. Tool count: 6 → 9.

---

## May 15, 2026 — Week 3 start: error tracer design

Designed `trace_error` architecture before writing code. Key decision: visited Set to prevent circular import hangs in `map_dependencies`. Week 3 tool list finalized: 7 tools planned.

---

## May 14, 2026 — run_command tool + Week 2 wrap

`run_command` built with allowlist approach (not blocklist). `execFile` not `exec` — no shell injection. Full Week 2 pipeline tested end-to-end: find_todos → read_file → show_diff → git_backup → write_file → run_command → verify. Tool count: 5 → 6.

---

## May 13, 2026 — write_file approval gate refinement

Approval gate: CLI readline + async `_approvalFn` for Web UI. 5-min auto-reject timeout. Context-aware diff with `@@ line N @@` headers, 3-line context. Edge case: new file creation shows full content as `+` lines. git_backup now auto-called inside write_file — no way to skip.

---

## May 12, 2026 — show_diff + write_file initial build

`show_diff` built with Myers diff algorithm (hand-rolled, no external dep). `write_file` initial build with path traversal prevention + high-risk file gate. `git_backup` with backup/restore action enum. Testing standalone before wiring.

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

Structured tool response format: `{ filePath, lineCount, lastModified, content, imports[] }`. Auto-import in `read_file`: resolves local imports 2 levels deep, returns all in one call. Prompt caching with `cache_control: ephemeral` — 60% token reduction on cached portion. Tested: reading auth.js auto-loaded controller + middleware in one tool call instead of three.

**Why:** Reducing tool calls matters — Bedrock has rate limits and each round trip adds latency.

---

## May 2, 2026

config/settings.py built. Configuration centralized.

---

## May 1, 2026

First day. Built agent.py, tools.py, prompts.py. Left out write_file intentionally.

---

## April 28-30, 2026

Research: Anthropic tool use docs, gitpython, psycopg2. Decision: no auto-push, no delete without human.

---

## April 25-27, 2026

Tool list design. DB access identified as the unique differentiator.

---

## April 23-24, 2026

Architecture planning. system-design.md written. Tool-use over text-dumping chosen.

---

## April 22, 2026

Project assigned. GitHub repo created. v0.1 foundation built.
