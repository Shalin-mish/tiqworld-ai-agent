# TIQ World AI Agent — Dev Log

*Daily progress log for the TIQ World AI Agent project.*

---

## June 2, 2026 (Session 11) — Any-codebase agent, maintenance timeout abort, once-daily scan, dynamic UI

### What changed

---

#### 1. Any-codebase design — agent now works on ANY project without code changes

**Problem:** The agent was hardwired for `tiq_workplace` — TIQ-specific system prompt, hardcoded paths, tools that assumed backend/frontend directory structure. Pointing it at a Python or Go project would produce wrong answers.

**Solution:** Auto-discovery at startup via `src/projectDiscovery.js` (new module, ~230 lines).

`discoverProject(codebasePath)` runs once on startup and returns a `projectInfo` object containing:
- **Language** — detected from `package.json`, `go.mod`, `Cargo.toml`, `pyproject.toml`, `pom.xml`, `composer.json`, `Gemfile`
- **Framework** — Express, Fastify, NestJS, Next.js, React, Gin, Echo, Django, FastAPI, Rails, Laravel, etc.
- **Monorepo detection** — `workspaces` in `package.json` OR ≥2 subdirs with own `package.json` (scans 2 levels deep)
- **README** — first 25 lines, fallback chain: root → `backend/README.md` → `docs/README.md`
- **Top-level directory tree** — 2 levels, capped at 3000 chars
- **Test/build/lint commands** — extracted from `package.json` scripts or language equivalent

`buildSystemPrompt(projectInfo)` assembles the full Claude system prompt **dynamically** from that result. The 115-line hardcoded TIQ system prompt in `agent.js` was replaced with a single call.

**How to point at a new codebase — no code change needed:**
```bash
CODEBASE_PATH=/path/to/any/project npm start
# or set in .env
```

**`src/config.js`:** `codebasePath` now reads `CODEBASE_PATH || TIQ_CODEBASE_PATH || process.cwd()`.

**`src/agent.js`:** Calls `discoverProject()` once at module load. Logs: `[Agent] Codebase detected: tiq_workplace · TypeScript · Fastify (monorepo)`. Exports `projectInfo` so other modules (scheduler, router) can use it.

**Tools updated for any-codebase:**
- `src/utils/fs.js` — `getAllFiles()` capped at `MAX_FILES=50,000` and `MAX_DEPTH=12` (was unbounded — would hang on huge repos)
- `src/tools/runCommand.js` — replaced hardcoded `TIQ_SERVICES` regex with generic allowlist: pytest, `go test ./...`, `cargo test`, `./gradlew test`, `mvn test`, `bundle exec rspec`, plus generic `npm --prefix` pattern
- `src/tools/lintFile.js` — `findEslintBin()` now walks up the directory tree to find ESLint binary instead of hardcoding `/backend/node_modules/.bin/eslint`
- `src/tools/fullScan.js` — changed defaults from `'backend/src'` to `''` (codebase root)
- `src/tools/healthCheck.js` — `keyFilesPresent()` now scans one level deep if root has no config files (monorepos without root package.json)
- `src/tools/mapDependencies.js` + `src/tools/readFile.js` — added `.js→.ts` candidate swap for TypeScript ESM imports (`import './foo.js'` → actual file is `foo.ts`)

**`dispatcher.test.js`:** Tests used `expect(classify('...')).toBe('review')` but `classify()` now returns `{ type, confidence, scores }`. Fixed by adding `const t = (input) => classify(input).type` helper.

---

#### 2. Maintenance timeout — hard abort via AbortController

**Problem:** The 4-hour timeout in `scheduler.js` was a `setTimeout` that set flags but did NOT stop the running `runAgent()` call. If Bedrock was mid-stream, it kept running. The flag just meant the next run would be skipped — the current one was unstoppable.

**Fix:** Full abort chain:

```
setTimeout fires
  → controller.abort()           ← AbortController per maintenance run
       → onOuterAbort listener   ← linked into every Bedrock call
            → Bedrock call throws AbortError
                 → runAgent() throws "Maintenance run aborted by timeout"
                      → scheduler catches, marks run done, releases locks
```

**Changes:**
- `src/config.js` — added `maintenanceTimeoutMs: parseInt(process.env.MAINTENANCE_TIMEOUT_MS) || 2 * 60 * 60 * 1000`  (default **2 hours**, was 4h hardcoded)
- `.env.example` — added `MAINTENANCE_TIMEOUT_MS=7200000`
- `src/agent.js` — `runAgent()` now accepts `abortSignal` as 10th parameter. Inside `callBedrock()`: adds `abortSignal.addEventListener('abort', onOuterAbort)` before each Bedrock call, removes it after. If outer signal is already aborted on entry, throws immediately — no retry.
- `src/scheduler.js` — creates `new AbortController()` per maintenance run, passes `signal` to `runAgent()`, timeout handler calls `controller.abort()`. `_maintenanceAbortController` module-level variable; reset to `null` on normal completion and on timeout.

**Why 2h default (not 4h):** Night maintenance runs at 2 AM. Even if it runs for 2 full hours, it finishes by 4 AM. 4h would risk overlapping with the 9 AM day scan.

---

#### 3. Day scan — once per day, lightweight only

**Problem:** `DAY_LIGHT_SCAN_CRON` was `0 */2 * * *` — running **12 times per day**. Each run called `lintFile` + `findTodos` + `healthCheck` + `healthMonitor`. Lint and TODO scans are token-expensive and slow. Running them 12×/day was wasting resources for zero extra value — those checks are already done at 2 AM.

**Fix:**
- `src/config.js` — changed default from `0 */2 * * *` to `0 9 * * *` (once at 9 AM IST)
- `.env` — updated `DAY_LIGHT_SCAN_CRON=0 9 * * *`
- `src/scheduler.js` — `runDayScan()` simplified: removed `lintFile` + `findTodos`, now only runs `healthCheck` + `healthMonitor`. Progress log goes from 4 entries to 2 (start + done).

**Rationale:** Night = full diagnosis (fullScan + auto-fix + tests). Day = liveness check only (is the platform up? is the process healthy?). Lint/TODOs don't change in 2 hours; checking them repeatedly burns tokens for nothing.

---

#### 4. Language-agnostic test runner

**`runTests()` in `scheduler.js`** was hardcoded to `npm test` — would fail silently on Python, Go, or Rust repos.

**Fix:** Uses `projectInfo?.testCmd || 'npm test'`. The detected command (e.g. `pytest`, `go test ./...`, `cargo test`, `bundle exec rspec`) is used automatically.

Same command is interpolated into the maintenance agent prompt so Claude knows what to run after each fix.

---

#### 5. `_status.progress` ring buffer — cap at 200 entries

`pushProgress()` now does `if (_status.progress.length >= 200) _status.progress.shift()` before pushing. Prevents unbounded memory growth on long maintenance runs (theoretically thousands of entries over 4 hours).

---

#### 6. Maintenance agent prompt — no more hardcoded TIQ patterns

The prompt previously listed `routes/, models/, middleware/, auth, config.js, index.js, server.js, app.js` — TIQ-specific. Replaced with:
- Dynamic sample from `HIGH_RISK_PATTERNS` array (first 12 entries, always current)
- `projectInfo.testCmd` instead of hardcoded `npm test`
- `projectInfo.name` + `projectInfo.language` in the header for context

---

#### 7. UI — dynamic project identity

**Problem:** UI was fully TIQ-branded — external logo from `tiqworld.com/logos/tiq-logo.png` (breaks on any other deployment), hardcoded "TIQ World codebase" text in welcome screen, page title always "TIQ World AI Agent".

**Fix 1 — Logo:** Replaced external `<img src="https://...">` with a self-contained inline SVG robot icon (orange-on-dark, consistent with brand palette). No external requests, works on any deployment, never broken.

**Fix 2 — `/api/status` extended:** Now returns `project_name`, `language`, `framework`, `is_monorepo` from `projectInfo`.

**Fix 3 — Dynamic UI:** `init()` in `index.html` reads the new fields from `/api/status` and:
- Sets header badge: `tiq_workplace · TypeScript · monorepo`
- Sets page `<title>`: `tiq_workplace · AI Agent`
- Sets welcome subtitle: `Pointed at tiq_workplace · TypeScript · monorepo — ready to explore, analyse, and fix.`
- Sets welcome logo brand text: `TIQ_WORKPLACE` (dynamic)

On a Python FastAPI project, the header would show `my_api · Python · FastAPI`.

---

#### 8. All tests updated and passing

| File | What changed |
|------|-------------|
| `tests/e2e/ui.test.js` | Title check: `/TIQ World AI Agent/` → `/AI Agent/` (dynamic title) |
| `tests/e2e/ui.test.js` | Admin redirect title: `/TIQ/` → `/AI Agent/` |
| `tests/e2e/ui.test.js` | Logo text: `'TIQ Agent'` → `'Agent'` (inline SVG has "CodebaseAI Agent") |

**Final count: 123 unit + 28 e2e = 151 tests, all passing.**

---

#### 9. TECHNICAL.md updated

- Section 3 config table: `DAY_LIGHT_SCAN_CRON` corrected, `MAINTENANCE_TIMEOUT_MS` added
- Section 4 dispatcher: documents that `classify()` is called **once per session** (web: `router.js` first turn; CLI: `index.js` first turn), returns `{type, confidence, scores}` not a bare string
- Section 4 agent: `runAgent()` signature updated with `abortSignal` parameter
- Section 4 scheduler: timeout abort mechanism explained, day scan rationale documented, progress ring buffer noted
- Section 6: `/api/status` updated to show new project fields
- Section 8: cron table corrected (`0 9 * * *`), maintenance flow shows `abortSignal` + `testCmd`, new "Maintenance Timeout" subsection explaining the full abort chain
- Section 12: port-busy resolution guide added
- **Section 13 (new): Inspection & Testing Guide** — what to run, what to check, pre-review checklist table

---

### Commit trail (June 2)

| SHA | What |
|-----|------|
| `a689297` | feat: maintenance timeout abort, once-daily day scan, dynamic UI project badge |
| `6b0d7d4` | fix: inline SVG logo, day cron once/day, docs updated with inspection guide |

---

### Current state (June 2, 2026)

| Area | Status |
|------|--------|
| Any-codebase support | Done — auto-discovery on startup, 7 languages detected |
| Maintenance timeout | Done — `MAINTENANCE_TIMEOUT_MS` env var, real AbortController abort (default 2h) |
| Day scan schedule | Done — once at 9 AM IST, healthCheck + healthMonitor only |
| Language-agnostic test runner | Done — uses `projectInfo.testCmd` |
| `_status.progress` bounded | Done — ring buffer, max 200 entries |
| Maintenance prompt | Done — dynamic HIGH_RISK_PATTERNS sample + detected testCmd |
| UI dynamic project identity | Done — header badge, title, welcome text from `/api/status` |
| Logo self-contained | Done — inline SVG, no external URLs |
| 151 tests (123 unit + 28 e2e) | All passing |
| TECHNICAL.md | Complete — dispatcher usage, timeout design, day scan rationale, inspection guide |

---

## June 1, 2026 (Session 10) — Right panel collapsed by default, UI polish, bug fixes

### What changed

**Right panel: collapsed by default (src/web/index.html)**

The admin/context panel on the right now starts collapsed on first visit — width 0, toggle button shows `‹`. User clicks the toggle button on the right edge to expand, same pattern as the left sidebar.

Why: The right panel (Approvals / Writes / Tools / Maint / Admin) is reference information, not primary UI. Starting it collapsed gives the chat area full width by default. User can expand when they actually need to see admin stats or tool calls. This matches how VS Code and most IDEs handle secondary panels — closed until you need them, not permanently taking up space.

Changes:
- `--right-w` CSS variable starts at `0` on first load
- Toggle button position fixed to right viewport edge when collapsed
- `tiq-right-open` key in `localStorage` persists state across page reloads
- Resize handle (`#right-resize-handle`) hidden while collapsed, visible when expanded
- E2E test updated to match new collapsed-by-default behaviour — `tiq-right-open` now set to `'true'` before navigation in tests that need the panel open

**UI polish — visual consistency pass (src/web/index.html)**

Full visual consistency pass across the web interface:
- Button hover states unified — consistent `opacity` + `background` transitions
- Tab bar active state sharpened — clearer active indicator
- Sidebar section headings — consistent spacing and font-weight
- Chat bubble padding and line-height tuned for readability at long message lengths
- Toggle button styling matched between left and right panels
- Scrollbar styling applied to sidebar body and right panel body

**Bug fixes (src/web/index.html, src/web/router.js)**

Three fixes from testing session:
1. Right panel resize handle was showing during collapsed state — fixed with `display: none` conditional on `--right-w === 0`
2. `localStorage` tiq-right-open not read on page load — initialization order issue, fixed by reading storage before CSS variable is set
3. Admin tab content not scrolling when panel is narrow — added `overflow-y: auto` to `.tab-content` wrapper

**Technical documentation (docs/TECHNICAL.md)**

Completed documentation pass — all 27 tools, all API endpoints, UI architecture, deployment checklist. This was flagged as a gap in Session 8's honest gap analysis. Now closed.

### Commit trail (June 1)
| SHA | What |
|-----|------|
| `b9293aa` | feat(ui): right panel collapsed by default, toggle to expand like left sidebar |
| `9b0a46d` | feat(ui): polish web interface for better UX and visual consistency |
| `96db013` | fix: bug fixes + add complete technical documentation |
| `6c48c2e` | docs: update devlog with June 1 2026 workflow review session |
| `cbf84b0` / `fbc7d27` / `a839986` / `32c639e` | docs: incremental documentation updates |

### Current state (June 1, 2026)

| Area | Status |
|------|--------|
| 27 tools | All wired, tested |
| Right panel collapsed by default | Done — localStorage persisted |
| Resize handle hidden when collapsed | Done |
| UI visual consistency | Done |
| Technical docs complete | Done |
| 151 tests (123 unit + 28 e2e) | All passing |
| Session persistence | Done |
| Branch-write flow | Done |
| Production safety hardening | Done |

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

Three things matter most before live production:
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

**Context:** `tiq_workplace` is the dev/review codebase. Agent will point at real TIQ codebase once approved.

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

## May 26, 2026 — Secret scanner, dep updater, notifications, admin panel, UI overhaul

### What changed

**New tool: `secret_scanner` (src/tools/secretScanner.js)**

Scans codebase for leaked credentials — 9 regex patterns covering AWS access keys, JWT secrets, PEM private keys, DB connection strings, Slack/Discord webhook URLs, and generic API key assignments. Reports by file with line numbers and match previews.

**New tool: `dep_updater` (src/tools/depUpdater.js)**

Checks npm outdated across services, categorises results by risk: patch (safe), minor (review), major (breaking). Returns a `safe_update_command` for patch-only updates. Prevents blind `npm update` across all packages.

**Notification system (`src/notifications.js`)**

Persistent ring buffer (last 100), bell icon with unread count, Slack/Discord webhook support. `notify(level, title, body)` called from scheduler on every maintenance result. Previously the scheduler ran silently — no visibility unless you manually checked logs.

**Admin panel merged into single-page UI**

Removed separate `/admin` route. Admin is now a tab in the right panel — stats grid, cron schedule display, maintenance reports, activity log, manual trigger button. Eliminates context switching between chat and admin views.

**Major UI overhaul (src/web/index.html)**
- Thinking animation while agent is processing
- Live tool call chips — pulse while running, green tick on completion
- Copy buttons on all code blocks and agent responses
- Maintenance header banner with last-run status
- Write history tab showing all approved/rejected write operations
- Diff viewer with approve/deny buttons integrated inline

### Commits
| SHA | What |
|-----|------|
| `ec73f91` | feat: secret scanner, dependency updater, notification system |
| `b69cbb5` | feat: wire secret_scanner + dep_updater into agent |
| `bc05628` | feat: admin panel — notifications bell, auto-refresh, countdown |
| `09f8d1b` | feat: major UI overhaul |
| `b41c4c7` | feat: one-click maintenance, parallel sessions, PM2 config |
| `6163511` | fix: resolve 8 bugs, pass all 67 tests |
| `7f7fd0f` | feat: merge admin panel into single-page UI |

---

## May 23, 2026 — Semi-autonomous maintenance system

### What changed

**`src/scheduler.js` — autonomous maintenance loop**

Two cron cycles:

**Night deep scan (2am IST):**
- `fullScan()` — all checks in parallel
- Pre-fix test run — skip auto-fix if tests already failing (don't compound broken state)
- For each issue with confidence ≥ threshold: `git_backup → show_diff → write_file → run_command`
- Post-fix test run — if failing, `git_backup restore` and stop
- Save `logs/maintenance-{ISO}.json` + notify

**Day light scan (every 2h IST):**
- Lint, TODOs, health check, health monitor in parallel
- No writes — observation only during working hours

**`fix_error` tool** — now the standard entry point for bug fixing. Takes an error message, reads the relevant files, identifies root cause, returns a confidence score (0–100) + proposed fix + verification command.

**`full_scan` tool** — runs all 10 maintenance checks in parallel in a single call. Replaces calling each tool individually.

### Commit
| SHA | What |
|-----|------|
| `2e2b55a` | feat: semi-autonomous maintenance system |

---

## May 22, 2026 — fix_error meta-tool + UI redesign

### What changed

**`fix_error` meta-tool (src/tools/fixError.js)**

End-to-end pipeline: error input → trace files → root cause analysis → confidence scoring → proposed fix → verification command. Registered across all dispatcher scopes.

Decision gate in agent prompt: confidence ≥ threshold → full auto-fix pipeline; below threshold → surface to user for decision. Confidence is a composite score based on stack trace file coverage, keyword matches, and function complexity.

**UI redesign (src/web/index.html)**

Moved from flat layout to 3-column: left sidebar (tool list + quick actions), centre (chat), right (session memory + admin). TIQ brand palette: dark orange `#E85D26` + teal `#0D9488`. Real-time progress strip shows tool calls as they fire. Session memory sidebar shows files read, writes made, tool call count.

### Commits
| SHA | What |
|-----|------|
| `17bc35a` | feat: add fix_error meta-tool — end-to-end error→fix→verify pipeline |
| `e88972d` | feat: wire fix_error tool, add tool budget + confidence rules |
| `1c33ded` | feat: add fix_error to dispatcher scopes + redesign index.html UI |

---

## May 21, 2026 — GitHub OAuth + audit trail + approval gates

### What changed

**GitHub OAuth (src/web/server.js)**

Passport.js + `passport-github2`. Users sign in with real GitHub accounts. Session stores `login`, `name`, `avatarUrl`, `githubId`. Every write, approval, and tool call is attributed to a verified GitHub username. Before this, all actions were anonymous.

**Audit trail (`src/activityLog.js`)**

Append-only JSONL at `logs/activity.jsonl`. Every event written: user query, tool call (name + input summary), write (path + status), approval (approved/rejected + by whom), error. JSONL chosen over a database — no schema, no setup, grep-able, pipeable to `jq`.

**Write archive (`src/writeArchive.js`)**

Before/after content saved for every accepted `write_file` to `logs/archives/{ISO}___{path}.diff`. Audit log says a write happened; write archive shows exactly what changed. Together they provide full traceability.

**Approval gates**

`approval_needed` SSE event → browser renders diff modal with approve/deny buttons → POST `/api/approve` with decision → resolves the async Promise in the tool loop → agent continues or stops. Bedrock call is paused (not polling) until the Promise resolves. 5-minute timeout → auto-reject.

**Week 4 complete — v0.6.0**

All Week 4 goals achieved: Web UI, approval gates, session memory, audit trail, GitHub OAuth.

### Commits
| SHA | What |
|-----|------|
| `057ae61` | feat: GitHub OAuth login |
| `9606707` | feat: audit trail — activity log, write archive, user identity, admin panel |
| `446e935` | feat: complete Week 4 — UI redesign, approval gates, session memory, v0.6.0 |
| `be06105` | refactor: final system prompt tuning based on real usage patterns |

---

## May 20, 2026 — Week 4: Web UI, DB access, 11 new tools, dispatcher refactor (9 → 24 tools)

### What changed

**Web UI (`src/web/`)**

- `server.js` — Express server, session management, OAuth scaffold, rate limiting
- `router.js` — `/api/chat` SSE endpoint, `/api/scan`, `/api/approve`, session CRUD
- `index.html` — single file, no build step, dark theme, live tool call chips, markdown rendering, copy buttons, timestamps

Why SSE over WebSockets: streaming is one-directional (server → browser). SSE is simpler, works over plain HTTP, no protocol upgrade needed.

Why no build step: developer tool for one team. Vite/webpack adds deployment friction with no benefit here.

**4 Week 4 tools:**

- `git_log` — commit history with file/date filters
- `health_check` — full codebase snapshot in one call (file counts, TODOs, git status, env gaps)
- `lint_file` — ESLint structured output (file:line:rule)
- `db_query` — read-only SQL against PostgreSQL via SSM tunnel (localhost:5433)

**7 additional tools built same day:**

- `find_todos` — TODO/FIXME/BUG/HACK scan with severity classification
- `check_env_usage` — diff `.env.example` vs `process.env.*` calls in code
- `summarize_diff` — git diff for staged/unstaged/branch comparison
- `detect_dead_code` — find files with zero importers
- `schema_to_api` — check CRUD route completeness for a given model
- `recall_session` — surface all tool calls + files read + writes from current session
- In-memory session store (`src/session.js`)

The rapid expansion was possible because shared fs utilities (`getAllFiles`, `toRel`, `readSafe`) were extracted first — each new tool reuses the same file traversal logic.

**Dispatcher refactor (src/dispatcher.js)**

Rebuilt from an `ALL_TOOLS` registry. Previously: add a tool → update import + switch case + tool list (3 places). Now: add one entry to the registry. Tool scope assignment (READ_ONLY / REVIEW_EXTRA / WRITE) is declarative.

**Bedrock prompt caching**

System prompt marked `cache_control: ephemeral`. In the multi-turn tool loop, the system prompt is sent on every round trip. Caching saves ~60% of input tokens on the cached portion across a full conversation.

**Bedrock prompt caching added** — system prompt marked `cache_control: ephemeral`, ~60% input token reduction on cached portion.

### Commits
| SHA | What |
|-----|------|
| `6de36fc` | feat: add git_log tool |
| `6863a69` | feat: add health_check tool |
| `24e721a` | feat: add lint_file tool |
| `c6ea8e7` | feat: add db_query tool |
| `4b56826` | feat: add shared fs utils |
| `61f9c2d` | feat: add find_todos tool |
| `5873e0e` | feat: add check_env_usage tool |
| `529bf3c` | feat: add summarize_diff tool |
| `364a2ae` | feat: add detect_dead_code tool |
| `97f3e4d` | feat: add schema_to_api tool |
| `3f9241a` | feat: add in-memory session store |
| `83b7014` | feat: add recall_session tool |
| `bf3b500` | refactor: rebuild dispatcher from ALL_TOOLS registry |
| `71b213e` | feat: wire Week 4 tools, Bedrock prompt caching |
| `b177a06` | feat: redesign Web UI |
| `c439fe7` | feat: full_scan tool + scheduler — v0.5.0 |

---

## May 18, 2026 — Week 3 complete: trace_error, map_dependencies, explain_route (6 → 9 tools)

### What changed

**`trace_error` tool (src/tools/traceError.js)**

Takes a stack trace string, extracts every file path mentioned, reads each file, and returns a structured analysis with all relevant code in context. The manual process of opening each file from a stack trace is replaced with a single tool call.

**`map_dependencies` tool (src/tools/mapDependencies.js)**

Given a file path, returns:
- Outgoing imports — what this file depends on (forward, depth configurable)
- Incoming importers — what files import this file (reverse)

Both directions matter: forward shows blast radius of a change; reverse shows what breaks if this file is modified.

**`explain_route` tool (src/tools/explainRoute.js)**

Given a route path + method, traces the full request lifecycle: route definition → middleware chain → controller → service calls → DB queries. Outputs a structured map of every file in the chain.

Why this is high-value: tracing a route manually (route → controller → service → model) takes 15-30 minutes for unfamiliar code. `explain_route` does it in one call.

### Commit
| SHA | What |
|-----|------|
| `6005ff9` | feat: add Week 3 tools — trace_error, map_dependencies, explain_route |

---

## May 17, 2026 — Dispatcher layer + git_backup + per-task tool scoping

### What changed

**Dispatcher (`src/dispatcher.js`)**

Routes queries to task types and restricts which tools Claude can access per task:

| Task type | Tool scope | Use case |
|-----------|-----------|----------|
| `query` | READ_ONLY | Answering questions about the codebase |
| `review` | READ_ONLY + show_diff + fix_error | Code review, security audit |
| `maintenance` | Full WRITE set | Scheduled auto-fix runs |
| `feature` | Full WRITE set | New feature work (propose only) |

Without scoping, Claude could call `write_file` when asked a simple question. Scoping prevents this by category. Smaller tool set per call also reduces context noise.

**`git_backup` tool (src/tools/gitBackup.js)**

Creates a checkpoint branch `backup/maint-{ISO}-{slug}` before any write. Also handles restore (`action: 'restore'`). Implemented as an explicit tool (not hidden logic) so Claude can invoke it in its own reasoning chain — the backup step appears in the tool call log and is visible in the UI.

### Commit
| SHA | What |
|-----|------|
| `d24d2bc` | feat: add dispatcher layer, git_backup tool, and per-task tool scoping |

---

## May 15, 2026 — Week 3 start: registry dispatcher, error_tracer, explain_route scaffolding

### What changed

**Registry-based dispatcher** replaced the if-elif chain

Before:
```javascript
if (taskType === 'query') return queryTools;
else if (taskType === 'review') return reviewTools;
// ...
```

After:
```javascript
const TASK_REGISTRY = { query: [...], review: [...], maintenance: [...] };
return TASK_REGISTRY[taskType] ?? TASK_REGISTRY.query;
```

Adding a new task type now means one dict entry, zero changes to routing logic. Open for extension, closed for modification.

**`error_tracer` tool scaffolded (src/tools/traceError.js)**

Initial implementation: parse stack trace → identify originating file and line → read that file and its imports → return structured root cause candidates.

**`explain_route` tool scaffolded (src/tools/explainRoute.js)**

Initial implementation: given a route string, search for its definition, read the handler, extract middleware references.

### Commits
| SHA | What |
|-----|------|
| `34a7df1` | feat(week3): add error_tracer + explain_route tools, registry dispatcher |
| `7aac789` | refactor(week3): replace if-elif dispatcher with registry pattern |
| `862e653` | feat(week3): add error trace and route explanation prompts |

---

## May 13, 2026 — Recursive auto-context loader + structured error format

### What changed

**Recursive auto-context loader — depth 2 with circular guard (src/tools/readFile.js)**

Extended from depth 1 (May 11) to depth 2 — when reading a file, also read its imports' imports. Added a `visited` Set to detect circular dependencies and break the recursion.

Why depth 2: most debugging paths span two hops. Component → utility → config is the common pattern. Depth 1 frequently missed the actual source of an issue. Depth 2 covers the large majority of real cases without the token overhead of unlimited recursion.

The circular guard is essential: without it, codebases with circular imports (A → B → A) would cause infinite recursion. The `visited` Set breaks any cycle.

**Structured error format for `show_diff` (src/tools/showDiff.js)**

Error returns now use `{ error, path, suggestion }` instead of a plain string.

Why structured: a string error gives Claude nothing actionable. A structured object lets Claude reason: "the file wasn't found at this path, the suggestion says to check if the path is relative to project root" — leading to a more accurate follow-up action.

### Commits
| SHA | What |
|-----|------|
| `740d104` | feat: recursive auto-context loader (depth 2) with circular import guard |
| `58b5894` | fix: standardize error format in showDiff (add path + suggestion) |

---

## May 12, 2026 — AWS Bedrock migration + show_diff tool

### What changed

**Migrated from Anthropic SDK to AWS Bedrock (`src/agent.js`)**

Replaced `Anthropic` client with `BedrockRuntimeClient` + `ConverseCommand` from `@aws-sdk/client-bedrock-runtime`.

Why Bedrock: TIQ's infrastructure is AWS. Bedrock keeps API traffic within the AWS network — no data leaving the cloud provider, same IAM credential model used by the rest of the stack, no separate API key to manage. AWS instance profile credentials work directly.

Trade-off: adds an AWS dependency. Running outside AWS requires credentials setup. Acceptable for an internal tool tied to TIQ infrastructure.

Model ID: `us.anthropic.claude-sonnet-4-5-20250929-v1:0` on region `us-east-2`.

**`show_diff` tool (src/tools/showDiff.js)**

Generates a context-aware diff between current file content and proposed new content. Uses `@@ line N @@` headers with 3 lines of context around each change — not the full file.

Why context-aware: if a 1-line change is made in a 300-line file, showing 300 lines is noise. `git diff` uses 3-line context for exactly this reason. This tool matches that behaviour.

Also fixed pending issues in `write_file` and `run_command` from May 11.

### Commits
| SHA | What |
|-----|------|
| `c082fb9` | feat: migrate from Anthropic SDK to AWS Bedrock (BedrockRuntimeClient) |
| `951f9d5` | fix: resolve pending issues in write_file, run_command, and add show_diff tool |

---

## May 11, 2026 — v0.2: Real tool-use loop, write_file, run_command, auto-context loader

### What changed

**Real tool-use loop — v0.2 agent core (`src/index.js`, `src/agent.js`)**

Replaced the v0.1 text-dumping approach with a proper Anthropic tool-use loop:

1. Send Claude the `tools` array + conversation history
2. Claude returns `stop_reason: "tool_use"` with function name + arguments
3. Agent executes the function locally
4. Agent sends back `tool_result` message
5. Loop continues until `stop_reason: "end_turn"` or tool budget exhausted

Before this: the agent called Python functions itself and passed results as text context. Claude made one call. In the new architecture, Claude controls the loop — it decides what to read, in what order, and when it has enough information to answer. This is the distinction between a script wrapper and an agent.

**`write_file` tool with approval gate and git backup (`src/tools/writeFile.js`)**

Flow:
1. `git_backup` — checkpoint branch created before any write
2. `show_diff` — before/after displayed to user
3. User confirms yes/no via readline prompt
4. Write only proceeds on explicit approval

Gate lives in the orchestrator, not inside `write_file`. Tools are pure — no user-facing I/O inside the tool itself. Approval logic belongs to the caller.

**`run_command` tool with exact allowlist (`src/tools/runCommand.js`)**

Executes shell commands from a defined whitelist. Everything not in the list returns a blocked error.

Allowlist approach over blacklist: a blacklist is always incomplete. Whitelist is complete by definition — if it's not listed, it cannot run.

**Auto-context loader — depth 1 (`src/tools/readFile.js`)**

When reading a file, automatically detects and reads its direct `import`/`require` statements. Returns both the file and its immediate dependencies in one tool call.

Why: most questions about a function require reading both the function and what it calls. Auto-loading depth 1 imports eliminates the round trip of "now read file B" after reading file A.

### Commits
| SHA | What |
|-----|------|
| `d067032` | feat: add write_file tool with diff view, approval gate, and git backup |
| `f5fed21` | feat: add run_command tool with whitelist for safe command execution |
| `2027157` | feat: auto-context loader — readFile parses and returns imported local files |
| `5da6321` | feat: wire write_file + run_command into agent, make executeTool async |
| `1e67b05` | feat: implement real tool-use loop (v0.2 agent core) |
| `5c6f12c` | Add v0.1 agent implementation and full project documentation |

---

## May 9, 2026 — Leave day

Architecture notes written: Claude must control the tool loop, not the orchestrator. v0.2 refactor plan finalised.

---

## May 8, 2026 — Week 1 retro, Week 2 planning, approval gate design

### What changed

**Week 1 retrospective**

| Goal | Status |
|------|--------|
| CLI working | Done |
| read tools working | Done |
| Q&A working | Done |
| System prompt with TIQ context | Done |
| Structured tool response format | Deferred to Week 2 |
| Prompt caching | Researched, intentionally deferred |

Prompt caching deferred: caching saves tokens on repeated calls with the same system prompt. In v0.1 (single API call per query), caching saves almost nothing. The multi-turn tool-use loop in v0.2 — where each tool call round trip resends the system prompt — is where caching pays off.

**Approval gate design**

Flow: agent proposes change → `show_diff` (proposed vs current) → user confirms yes/no → `write_file` only if yes.

Decision: gate logic lives in the orchestrator (`agent.py`), not inside `write_file`. Tools are pure functions — inputs in, outputs out, no side effects, no user-facing I/O. The orchestrator owns the confirmation loop.

**Week 2 goals set:** `show_diff`, approval gate, `git_backup`, `run_command`, structured tool response format.

---

## May 7, 2026 — Structured tool responses + prompt caching

### What changed

**Structured response format — all 3 tools**

| Tool | Before | After |
|------|--------|-------|
| `read_file` | Raw file string | `{ file_path, line_count, language, content, truncated }` |
| `list_files` | Raw array | `{ entries: [{name, path, type, size}], total_count, filtered_count }` |
| `search_code` | Raw match list | `{ matches: [{file, line, column, text}], match_count, files_searched }` |

Why structured: raw strings give Claude no metadata. Structured responses enable precise answers: "Line 47 of `src/middleware/auth.js`" instead of "somewhere in auth.js."

**Prompt caching added (`src/agent.py`)**

System prompt block marked `cache_control: ephemeral`. First call populates the cache. Subsequent calls with the same system prompt get ~90% token reduction on that block.

Why add now: structured tool responses and the TIQ-specific system prompt mean the system prompt block is now large and stable — a good caching target. Also, this prepares for the v0.2 multi-turn loop where the same prompt is sent on every round trip.

### Commits
| SHA | What |
|-----|------|
| `cb4d9a0` | feat: structured response format for read_file tool |
| `6cfb9af` | feat: structured response format for list_files tool |
| `6516109` | feat: structured response format for search_code tool |
| `bc2036b` | feat: add prompt caching to system prompt (cache_control: ephemeral) |

---

## May 6, 2026 — TIQ-specific system prompt

### What changed

**`SYSTEM_PROMPT` updated with TIQ World codebase context (`config/prompts.py`)**

Added explicit context: MERN stack, module structure (Tracks, Tasks, Submissions, Assessments, Certificates), key file locations, route naming conventions, database patterns.

Before: Claude gave generic output — "add input validation", "use environment variables for secrets." Technically correct, not specific.

After: Claude references actual module names, route patterns, and file paths from the TIQ codebase. Reviews become actionable rather than textbook advice.

Key insight: a language model is only as useful as the context it receives. Generic context → generic output. Codebase-specific context → codebase-specific output. Every token invested in the system prompt pays off on every subsequent call.

---

## May 5, 2026 — First test against TIQ codebase, 3 bugs fixed

### What changed

**First real run against `C:/Users/Shalini Mishra/TIQ`**

Results: auth Q&A worked, health check correctly identified structure, code review found real issues.

**Bug 1 — Import path resolution (`agent.py`)**

`from prompts import ...` breaks when running from outside the `agent/` directory. Fixed: `sys.path.insert(0, os.path.dirname(__file__))` at the top of `agent.py`. Forces Python to look relative to the script file, not the working directory. A broken import means a tool nobody uses.

**Bug 2 — Hallucination guard (`config/prompts.py`)**

Claude was referencing code that wasn't in the provided files — filling in gaps from training data. Fixed: explicit instruction added to `QUESTION_PROMPT`: "Only reference code from the context provided. Do not invent or assume code that was not shown to you."

**Bug 3 — Search relevance (noted, not fixed)**

When a keyword appears in many files, all results are weighted equally. A file with 20 surface matches gets the same weight as one with a deep, relevant match. Proper relevance ranking deferred to v0.2.

---

## May 2, 2026 — Configuration module + bug fix

### What changed

**`config/settings.py` — centralised configuration**

Extracted all hardcoded values from `agent.py`:
- `MODEL` — reads from environment first, falls back to default
- `EXCLUDE_DIRS` — `node_modules`, `__pycache__`, `.venv`, `dist`, `build`
- `MAX_FILE_SIZE` — 100KB cap (skips minified/generated files)
- API key — `os.environ.get('ANTHROPIC_API_KEY')` only, never hardcoded. Exits with clear error if not set.

Why centralise: model name and API settings were hardcoded in `agent.py`. When the model name changes, a single file to update beats finding every hardcoded reference.

**Bug fix — `get_file_summary()` over-counting files**

`.git/` internals were being counted as source files, inflating the codebase file count to thousands. Fixed by applying `EXCLUDE_DIRS` filter inside `list_files`.

---

## May 1, 2026 — Project foundation: CLI agent, 3 tools (v0.1)

### What changed

**`agent/agent.py` — CLI orchestrator**

`argparse` for CLI (auto-generates `--help`, makes each mode independently testable). `rich` library for terminal output (renders Claude's markdown responses instead of raw symbols). Four modes: `--review`, `--ask`, `--health-check`, interactive default.

**`agent/tools.py` — 3 read-only tools**

- `read_file` — read any file under `TIQ_CODEBASE_PATH`
- `list_files` — directory listing with file type breakdown
- `search_codebase` — plain string search across all non-excluded files

`write_file` deliberately excluded: the system design requires a human approval gate before writes. The gate isn't built yet. Including write without the gate risks accidental modification. It will be added in Week 2 once the gate is ready.

**`agent/prompts.py` — prompt templates**

Separated from `agent.py` so prompts can be tuned independently without touching orchestration logic. `REVIEW_PROMPT` uses Critical / Warning / Suggestion severity tiers — unstructured review output is hard to prioritise. Structured tiers make it immediately clear what needs immediate attention.

### Commit
| SHA | What |
|-----|------|
| `d1b2271` | project foundation — CLI agent with read/list/search tools |

---

## April 28–30, 2026 — Research phase

### What was explored

- **Anthropic tool use documentation** — full message flow: `tools` array → `stop_reason: tool_use` → `tool_result` → loop. Understanding this was prerequisite to designing v0.2.
- **gitpython** — programmatic access to git log, diff, blame for the planned git tools.
- **psycopg2** — PostgreSQL connectivity for the planned `db_query` tool via SSM tunnel.

**Constraints decided upfront:**
- No auto-push to git remote — human always controls pushes
- No delete operations without explicit confirmation
- No merging PRs autonomously
- Write access scoped to documentation files only (initially)

Rationale: trust is earned incrementally. Starting constrained and expanding is safer than starting permissive and adding restrictions after something goes wrong.

---

## April 25–27, 2026 — Tool list design

### What was decided

Defined the full tool set for v0.2. Key decision: include `db_query` as a first-class tool.

Why DB access is the differentiator: generic AI coding tools (Copilot, Devin, Cursor) have no knowledge of TIQ World's data. An agent with database access can answer questions no off-the-shelf tool can answer for this specific context. This was identified as the highest-value capability to build.

Final tool list: `read_file`, `list_files`, `search_codebase`, `git_log`, `git_diff`, `git_blame`, `db_query`, `db_schema`, `write_file` (with gate).

---

## April 23–24, 2026 — Architecture planning

### What was decided

**`docs/system-design.md` written before any v0.2 code.**

Core architectural decision: v0.2 must be a real tool-use agent, not a text-dumping wrapper.

v0.1 approach: code searches for files, dumps content as text context into a prompt, Claude answers. Claude has no agency — it responds to whatever the code passes it.

v0.2 approach: Claude receives a `tools` array, decides which tools to call, the agent executes them, Claude continues. Claude controls the loop. This is the difference between a script that uses Claude and an agent.

**Human-in-the-loop for writes:** Agent can read everything and suggest anything. All code changes require human approval before being applied. Trust is built incrementally — read-only first, write access only after the safety mechanisms are proven.

---

## April 22, 2026 — Project start

### What changed

**GitHub repository created: `tiqworld-ai-agent`**

**v0.1 built — four modes:**
- `--review <file>` — structured feedback (Critical / Warning / Suggestion)
- `--ask <question>` — codebase search + answer
- `--health-check <dir>` — structural overview
- Default — interactive chat

**Why Python for v0.1:** Fastest path to something working. Official Anthropic SDK, `rich` for terminal output, `gitpython` for later git integration. Agent migrated to Node.js in Week 2 to match TIQ's stack.

**Why not start with tool use in v0.1:** Tool use is the right architecture but adds significant complexity. v0.1 validates the concept with something testable. v0.2 refactors to proper tool use once the idea is proven.

### Commit
| SHA | What |
|-----|------|
| `920c240` | Initial commit |
