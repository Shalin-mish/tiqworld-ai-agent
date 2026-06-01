# TIQ World AI Agent — Dev Log

*Daily progress log for the TIQ World AI Agent project.*

---

## May 29, 2026 (Session 9) — v1.0.0: All gaps closed, 27 tools, 151 tests passing

### What changed

**New tool: `branch_write` (src/tools/branchWrite.js)**

PR-based write flow. Instead of writing directly to the working tree (write_file), `branch_write`:
1. Creates feature branch `agent/fix-<slug>-<timestamp>`
2. Writes + commits the file on that branch
3. Returns branch name + diff + next steps (push + open PR)
4. Always switches back to original branch after — zero working tree pollution
5. Same four safety gates as write_file: self_protect → credential_guard → (then git)

Registered in agent.js tool registry (27 tools total), dispatcher WRITE scope, versioned API to 1.0.0.

**Session persistence (src/sessionPersistence.js)**

Sessions now survive server restarts. After each chat answer, the router saves session snapshot to `logs/sessions/{id}.json`. On `getSession()`, if session not in memory, loads from disk. 24h TTL on snapshots — stale ones discarded on load. Corrupt JSON handled safely (returns null).

Saved per session: user, taskType, tokens, history (last 8), filesRead Map, toolCalls (last 50), writes (last 20).

New endpoint: `GET /api/sessions` — lists all persisted sessions.

**Session clear now deletes persisted file too** — POST /api/clear removes both in-memory and disk entry.

**New test files (48 new tests)**
- `tests/unit/scheduler.test.js` — 28 tests: isHighRisk() (all HIGH_RISK_PATTERNS verified), getMaintenanceStatus() shape, getLastScan() shape, getSchedulerHealth() types + values
- `tests/unit/sessionPersistence.test.js` — 12 tests: round-trip, history cap, delete, list, corrupt file safety
- `tests/unit/branchWrite.test.js` — 8 tests: tool definition schema, self-protect gate (8 paths), credential guard (AWS key, PEM key, safe content)

**Test results: 151/151 passing**
- Unit: 123/123 (9 test files)
- E2E: 28/28 (Playwright, all UI flows)

**docs/system-design.md → v4.0**
- All 5 gaps marked resolved in Section 12 with file references
- write_file vs branch_write comparison table
- Session persistence documented
- Tool count updated: 26 → 27
- Test count updated: 75 → 151

### Version bump: 0.9.0 → 1.0.0

All documented gaps closed. Agent is production-safe with PR-based write flow and session persistence.

---

## May 29, 2026 (Session 8) — External guardrails layer + honest gap analysis + docs updated to v3.1

### What changed

**Claude Code Hooks — External Safety Layer (settings.json)**

Added a second safety layer that runs *outside* the agent process, at the Claude Code session level. These hooks fire before any tool call and cannot be bypassed by the agent itself:

- `Bash` push guard: blocks `git push origin main/master/production` — agent can never push directly to live branch
- `Bash` destructive guard: blocks `git reset --hard`, `git push --force`
- `mcp__postgres-tiqworld-dev__query` guard: only SELECT allowed — UPDATE/DELETE/INSERT/DROP blocked at hook level
- `mcp__github__push_files` guard: blocks direct push to main/master/production
- `mcp__github__create_or_update_file` guard: blocks direct commit to main/master/production

Why two layers? Tool gates (existing) protect the target codebase. Claude Code hooks protect the agent's own repo and dev workflow. Different threat surfaces.

**CLAUDE.md — Agent Rules Written as Instructions**

Project-level CLAUDE.md updated with explicit rules: feature branch → PR → human review → merge workflow, DB read-only policy, branch naming conventions.

**system-design.md — Updated to v3.1**

- Added Section 4 subsection: "Claude Code Guardrails (External)" documenting the hooks layer
- Added Section 5: Autonomy Model (moved from memory, now in codebase)
- Added Section 12: **Honest Gap List** — real missing pieces documented (PR-based write flow, session persistence, self-reported confidence, scheduler tests)
- Updated hard limits table to include "push to main" and "run UPDATE/DELETE on DB"
- Updated deployment checklist with hooks verification step
- Version bumped 3.0 → 3.1

### Gap analysis summary

Agent is solid for internship prototype + dev environment use. Three things matter most before live production:
1. PR-based write flow (instead of direct working tree writes)
2. Session persistence across restarts
3. External verification of fix_error confidence score

None block current use on dev/staging.

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

## May 18, 2026

Tools `trace_error`, `map_dependencies`, `explain_route` built. Tool count: 6 → 9.

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
