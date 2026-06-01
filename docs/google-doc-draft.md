# TIQ World AI Agent — Development Log
**Project:** Claude-powered AI Agent for TIQ World codebase
**Period:** April 22, 2026 – ongoing

---

## June 1, 2026

**Commits:** `b9293aa` `9b0a46d` `96db013` + docs updates

**What was done:**

Three UI changes and a complete technical documentation pass.

**1. Right panel collapsed by default**

The admin/context panel on the right now starts at width 0 on first load. A toggle button sits at the right viewport edge — click to expand, same as the left sidebar. State is saved in `localStorage` (`tiq-right-open`) so it persists across reloads. The resize handle is hidden while collapsed.

*Why:* The right panel (Approvals, Writes, Tools, Maintenance, Admin) is reference information, not the primary interface. Forcing it open on every load pushed the chat area into a narrow column and created visual clutter. Collapsing by default gives full width to the chat — the primary use case. This follows the same pattern used by VS Code and JetBrains for secondary panels. The localStorage persistence means users who prefer it open do not have to re-expand every session.

**2. Visual consistency pass**

Standardised button hover states, tab active indicators, sidebar section heading spacing, and chat bubble padding. Individual changes are small, but inconsistencies had accumulated across rapid feature-building sessions.

*Why:* Visual inconsistency signals a lack of attention to detail. When buttons behave differently across different parts of the UI, users question what else may be inconsistent. This was deferred polish from all the feature work, now completed.

**3. Three bug fixes**

- Resize handle visible during collapsed state — fixed with `display: none` when width is 0
- `localStorage` state overwritten on page load due to initialisation order — fixed by reading storage before the CSS variable is set
- Admin tab content not scrollable when panel is narrow — fixed with `overflow-y: auto` on the tab content wrapper

**Also:** Completed `docs/TECHNICAL.md` — full documentation of all 27 tools, API endpoints, UI architecture, and deployment checklist. This was a flagged gap from May 29.

---

## May 29, 2026 — v1.0.0: All gaps closed

**Commits:** `branch_write`, `sessionPersistence`, 48 new tests, system-design v4.0

**What was done:**

Closed the last two major gaps identified in the Session 8 honest gap analysis.

**1. `branch_write` tool** (`src/tools/branchWrite.js`)

Instead of writing directly to the working tree, `branch_write` creates a feature branch `agent/fix-<slug>-<timestamp>`, commits the file on that branch, returns branch name + diff + next steps, then switches back to the original branch. Same safety gates as `write_file`: self-protect → credential_guard → then git.

*Why:* `write_file` writes directly to disk — if something goes wrong, the working tree is modified with no clean rollback path. `branch_write` means every agent-proposed fix lives on its own branch. The change is reviewed as a PR before merging. This is the correct workflow for any team using code review, and it is what makes the agent safe to use on a shared production codebase.

**2. Session persistence** (`src/sessionPersistence.js`)

Sessions now survive server restarts. After each response, the router saves a snapshot to `logs/sessions/{id}.json`. On `getSession()`, if not in memory, loads from disk. 24h TTL, corrupt JSON handled safely. Saved per session: history (last 8), filesRead, toolCalls (last 50), writes (last 20).

*Why:* Before this, restarting the server wiped all session context. The user would lose conversation history and the agent would lose awareness of which files it had already read. For a tool used during active debugging, this was a meaningful usability gap. Disk persistence with a 24h TTL is the right trade-off — keeps recent context without accumulating indefinitely.

**3. 48 new tests** — scheduler (28), sessionPersistence (12), branchWrite (8). Total: 151 passing.

**Version bump 0.9.0 → 1.0.0** — all documented gaps resolved.

---

## May 28, 2026 — Production safety hardening + health_monitor + credential_guard + UI overhaul

**Commits:** 14 commits across safety, tools, and UI

**Safety hardening (3 critical fixes):**

**Fix 1 — Agent self-protection**

The agent can now never autonomously modify its own source files or DB migrations. Hard block in both `writeFile.js` and `scheduler.js` (`HIGH_RISK_PATTERNS`).

*Why this is critical:* Without self-protection, a crafted prompt could instruct the agent to modify `src/tools/writeFile.js` — effectively disabling the approval gate itself. Once an agent can rewrite its own safety rules, every other protection becomes meaningless. The fix: protected paths are checked before any write, with no exceptions.

**Fix 2 — Auto-fix confidence threshold raised from 55% to 80%**

*Why:* At 55%, nearly 1 in 2 auto-fixes could be incorrect. The agent was autonomously writing code with coin-flip confidence. 80% means only fixes where the agent has strong signal proceed automatically. Everything below 80% is surfaced for human review.

**Fix 3 — Command allowlist changed from prefix-match to exact Set**

*Why:* `startsWith('npm run test')` would pass `npm run test:staging` or a chained command. Exact match with a defined Set closes this gap entirely.

**New tools:**

`health_monitor` — HTTP probes, log anomaly scan, Node process vitals. Runs every 2h in the day cycle, triggers `notify()` on DEGRADED/UNHEALTHY.

*Why:* The agent needs to know if the platform it monitors is actually running. Without this, it could report "no issues found" while the server is down. Three signal layers cover different failure modes: HTTP probe catches a dead server, log scan catches runtime errors, process vitals catch memory leaks.

`credential_guard` — 13 detection rules covering AWS keys, PEM keys, hardcoded passwords, DB connection strings, JWT secrets, and more. Runs as a write gate on every `write_file`.

*Why:* An agent that can write files could also accidentally write a file containing a secret. The guard runs before every write — if a secret pattern is detected, the write is blocked and logged regardless of the requested action.

**UI overhaul:**

Bilateral panel toggles (`position: fixed`), drag-to-resize both sidebars (persisted in localStorage), Quick Actions button replacing admin widget, Admin tab default on page load.

*Why fixed position for toggles:* They were clipped by `overflow: hidden` on the parent container. Fixed position removes them from the normal flow and places them relative to the viewport — the only reliable approach at all sidebar widths.

---

## May 27, 2026 — Deep audit: 6 production bugs fixed, CI added, tiq_workplace alignment

**Commits:** 40+ commits across fixes, tests, CI, and alignment

**6 production bugs fixed:**

1. `gitBackup` restore was a no-op — the `action` parameter was never read. Rollback did nothing silently. *Why it matters:* The entire auto-fix safety net depended on rollback working correctly.

2. `runCommand` had `npm test` hardcoded — TIQ uses `npm --prefix backend/<service> test`. Every run_command call was failing.

3. `searchCode` used `includes()` only — no regex support, no result cap. Added `is_regex` param and `max_results: 100`.

4. `writeFile` diff showed the full file for a 1-line change — replaced with context-aware diff using `@@ line N @@` headers and 3-line context.

5. Maintenance tool budget was 8 — `git_backup → show_diff → write_file → run_command` = 4 calls minimum. Scheduler now passes `toolBudget: 20`.

6. Scheduler had no `sessionId` — all maintenance calls were polluting the default session, mixing with user conversations.

**Independent test judge:**

Added `HIGH_RISK_PATTERNS` — agent cannot modify its own test files. GitHub Actions CI is the external judge that runs tests in an environment the agent cannot touch.

*Why this design:* Any system where the same entity that writes fixes also runs the tests that verify them is unreliable. The fix and the judge must be separate.

**tiq_workplace alignment:**

System prompt rewritten for TypeScript microservices (Fastify, PostgreSQL, BetterAuth, 7 backend services). runCommand whitelist and HIGH_RISK_PATTERNS updated for the correct file paths.

*Why:* The agent was configured for a MERN stack, but the actual codebase is TypeScript microservices. Every protected path and every tool suggestion was pointing at the wrong structure.

---

## May 26, 2026 — Secret scanner, dep updater, notifications, admin panel, UI overhaul

**Commits:** `ec73f91` `b69cbb5` `bc05628` `09f8d1b` `b41c4c7` + merge + fixes

**`secret_scanner` tool:**

Scans the entire codebase for leaked credentials — API keys, JWT secrets, passwords, private keys, `.env` content in non-.env files.

*Why:* Secrets committed to git are one of the most common and costly security mistakes in development. The scanner runs on demand from the admin panel or via the nightly maintenance scan.

**`dep_updater` tool:**

Checks npm outdated and categorises dependencies by risk level (patch / minor / major). Returns a `safe_update_command` for patches only.

*Why:* Outdated dependencies accumulate as silent maintenance debt. The categorisation matters — patch updates are safe to suggest automatically, major updates may have breaking changes and need human review. The tool distinguishes these explicitly.

**Notification system** (`src/notifications.js`):

Persistent in-app notifications with bell icon and webhook support for Slack/Discord.

*Why:* The maintenance scheduler was running silently. If it found issues at 2am, there was no way to know until manually checking the admin panel. Notifications give the agent a feedback loop.

**Admin panel merged into single-page UI:**

Removed the separate `/admin` route; admin is now a tab in the right panel.

*Why:* A separate admin page required switching context to check maintenance status. The integrated tab allows checking admin state without leaving the main interface.

---

## May 23, 2026 — Semi-autonomous maintenance system

**Commits:** `2e2b55a`

`src/scheduler.js` runs two cycles:
- **Night (2am):** Full scan → issues found + confidence ≥ threshold → git backup → diff → write fix → run tests → rollback if tests fail
- **Day (every 2h):** Health check only, no writes

*Why two different cycles:* The night cycle has autonomy because no one is available to approve changes, and the git backup + test + rollback chain makes it safe — any mistake rolls back automatically. The day cycle is read-only because writes during working hours should go through the human approval gate.

*Why confidence threshold:* Not every issue the agent finds is appropriate for an auto-fix. Low-confidence findings surface to the developer. High-confidence fixes (syntax errors, obvious import issues, unused variables) can be auto-applied. The threshold makes the boundary explicit.

*Why git backup before every write:* Even with confidence scoring, the agent can be wrong. Git backup means any auto-fix can be undone in one command.

---

## May 22, 2026 — fix_error tool + UI redesign

**Commits:** `17bc35a` `e88972d` `1c33ded`

Built `fix_error` — a meta-tool that chains multiple tools together to go from an error message to a proposed fix.

Flow: error input → agent reads relevant files → identifies root cause → generates fix → confidence score (0–100) → if ≥ threshold, full pipeline; if below, surfaces for human review.

*Why a meta-tool instead of individual steps:* When debugging, a developer does not call "read file", then "search code", then "write fix" one by one. They trace the error, understand context, and propose a fix. `fix_error` mirrors that natural workflow — one call, full pipeline. The confidence score makes the autonomy boundary explicit.

Also redesigned the UI — TIQ brand palette (dark orange + teal), left sidebar for tool list, right sidebar for session memory, real-time progress strip.

*Why redesign at this point:* With `fix_error` adding a multi-step pipeline, the UI needed to show progress in real time. The redesign added the progress strip and session memory sidebar to surface the agent's reasoning visibly.

---

## May 21, 2026 — GitHub OAuth + audit trail + approval gates

**Commits:** `057ae61` `9606707` `446e935` `be06105`

**GitHub OAuth** (Passport.js):

Users sign in with real GitHub accounts. Every action is attributed to a verified GitHub username.

*Why:* Before this, all actions were anonymous. For a tool that writes files, anonymity removes accountability. GitHub OAuth was the right choice — the team already uses GitHub and no new account system is needed.

**Audit trail** (`src/activityLog.js`):

Every agent action logged to `logs/activity.jsonl` — tool calls, writes, approvals, and who triggered what.

*Why JSONL:* One JSON object per line. Appendable without rewriting the file. Grep-able and compatible with `jq`. The standard format used by most production logging systems.

**Write archive** (`src/writeArchive.js`):

Before/after content saved for every `write_file` call.

*Why:* The activity log records that a write happened. The write archive records exactly what changed. Together they provide full traceability — if a file is incorrect after an agent write, the exact before/after diff is available.

**Approval gates:**

`approval_needed` SSE event → browser shows diff modal → user clicks Approve/Deny → `/api/approve` resolves the async Promise → agent continues or stops.

*Why async Promise:* The agent's tool loop runs in Node.js. When it needs human approval, it needs to pause and wait — not poll. An async Promise that resolves on the HTTP callback is exactly how to pause an async loop until an external event arrives.

---

## May 20, 2026 — Week 4: Web UI, 4 new tools, 10 more tools, dispatcher refactor

**Commits:** 20+ commits

**Web UI** (`src/web/`):

Express server + SSE streaming + single `index.html` with no build step. Dark theme, live tool call chips, markdown rendering.

*Why SSE instead of WebSockets:* Server-Sent Events are one-directional (server → client), which is exactly what streaming AI responses need. WebSockets are bidirectional — the added complexity is not justified when only the server needs to stream. SSE also works over standard HTTP with no protocol upgrade.

*Why no build step:* This is a developer tool used by one team. A Vite/webpack pipeline adds setup complexity with no benefit for this use case. A single `index.html` is instantly deployable, immediately inspectable, and runs on any machine with Node.

**4 Week 4 tools:** `git_log`, `health_check`, `lint_file`, `db_query`.

`db_query` — read-only PostgreSQL via SSM tunnel.

*Why read-only enforced:* The connection is to a dev database, but dev databases still contain real data. Read-only means the agent can answer data questions with no risk of accidental modification.

**7 additional tools:** `find_todos`, `check_env_usage`, `summarize_diff`, `detect_dead_code`, `schema_to_api`, `recall_session`, in-memory session store.

*Why many at once:* These tools share a common pattern — scanning the codebase for a specific category of issue. Once shared filesystem utilities (`getAllFiles`, `toRel`, `readSafe`) were extracted, each new tool was straightforward to add. Building shared utilities first enabled the rapid expansion.

**Dispatcher refactor:** Rebuilt from `ALL_TOOLS` registry. No more per-tool import duplication.

*Why registry pattern:* Previously, adding a tool required changes in three places — an import, a case in the dispatcher, and a tool list entry. The registry pattern requires one entry in one place. Maintenance cost drops significantly as the tool count grows.

**Bedrock prompt caching:** System prompt marked `cache_control: ephemeral`.

*Why at this stage:* Caching saves tokens on repeated calls with the same system prompt. In single-call v0.1, caching saved almost nothing. In the multi-turn tool-use loop — where each tool call round trip resends the system prompt — caching reduces input tokens on the cached portion by approximately 60%.

---

## May 18, 2026 — Week 3 complete: trace_error, map_dependencies, explain_route

**Commits:** `6005ff9`

Completed the Week 3 tool set. Tool count reached 9.

`map_dependencies` — given a file path, returns which files it imports and which files import it (both directions).

*Why both directions:* Forward dependencies show what a change could break. Reverse dependencies show the impact radius of a change. One direction alone gives an incomplete picture.

`explain_route` — given an Express/Fastify route, traces the full request flow: middleware chain → controller → service calls → DB queries.

*Why this tool has high value:* New team members spend significant time tracing routes manually. `explain_route` compresses that process into a single call — the highest-leverage onboarding tool in the set.

---

## May 17, 2026 — Dispatcher layer + git_backup + per-task tool scoping

**Commits:** `d24d2bc`

Built the dispatcher — the routing layer that decides which tools Claude receives access to for a given task type.

Different task types need different tool sets:
- `query` (answering questions): read-only tools only
- `review` (code review): read + analysis tools
- `maintenance` (auto-fix): read + write + run_command
- `feature` (new code): full set

*Why scoped tool sets:* If every conversation receives every tool, Claude can call `write_file` in response to a simple question. Scoping prevents tool misuse by category. A smaller tool list per call also reduces context noise, producing more focused responses.

`git_backup` added as an explicit tool (not just internal logic) so Claude can invoke it deliberately in its reasoning chain — making the backup step visible in the tool call log.

---

## May 15, 2026 — Week 3 start: registry dispatcher, error_tracer, explain_route

**Commits:** `34a7df1` `7aac789` `862e653`

**Registry dispatcher** replaced the if-elif chain:

Before: `if task == 'query': return query_tools; elif task == 'review': ...`
After: `TASK_REGISTRY = { query: [...], review: [...] }; return TASK_REGISTRY[task]`

*Why:* The if-elif chain was already 40 lines for 4 task types. Adding a fifth required modifying dispatcher logic. Registry pattern means adding one key to a dictionary — zero change to the routing code.

**error_tracer tool:**

Takes a stack trace, identifies the originating file and line, reads that file and its import chain, and returns a structured root cause analysis.

*Why start Week 3 here:* The most common question when something breaks is "where is this error coming from and why?" A tool that automates the manual trace-through-imports process has immediate utility.

---

## May 13, 2026 — Recursive auto-context loader + structured diff errors

**Commits:** `740d104` `58b5894`

**Recursive auto-context loader (depth 2, circular import guard):**

When Claude reads a file, the agent automatically reads its imports (depth 1 was added May 11). Expanded to depth 2 — imports of imports. Added circular import detection using a visited Set.

*Why depth 2:* Most real bugs span two layers. A component imports a utility which imports a config. Stopping at depth 1 often misses the actual source of a problem. Depth 2 covers the majority of real debugging paths without the token overhead of unlimited depth.

*Why circular import guard:* Some codebases have circular dependencies (A imports B, B imports A). Without a guard, the loader recurses indefinitely. The visited Set prevents this.

**showDiff error format** standardised to `{ error, path, suggestion }`.

*Why structured errors:* Unstructured error strings give Claude nothing to act on. A structured object with `error`, `path`, and `suggestion` tells Claude exactly what is wrong, where, and what to try next — producing more accurate follow-up reasoning.

---

## May 12, 2026 — AWS Bedrock migration + show_diff tool

**Commits:** `c082fb9` `951f9d5`

**AWS Bedrock migration** (Anthropic SDK → `BedrockRuntimeClient`):

Switched from calling `api.anthropic.com` directly to routing through AWS Bedrock.

*Why Bedrock:* TIQ's infrastructure runs on AWS. Bedrock keeps API calls within the AWS network — lower latency, no data leaving the cloud provider, and the same IAM permissions model used by the rest of the infrastructure. The agent can use instance profile credentials already configured on the machine rather than a separate API key.

*Trade-off:* Bedrock adds an AWS dependency. Running outside AWS requires additional setup. Acceptable for an internal tool tied to TIQ's infrastructure.

**`show_diff` tool:**

Shows a before/after comparison for a proposed file change before it is applied. Context-aware — shows `@@ line N @@` headers with 3-line context around changes, not the full file.

*Why context-aware diff:* Changing line 47 of a 300-line file does not require showing all 300 lines. Three lines of context around the change is exactly how a code reviewer reads a diff. This matches `git diff` behaviour by design.

---

## May 11, 2026 — v0.2: Real tool-use loop + write_file + run_command + auto-context

**Commits:** `1e67b05` `5da6321` `d067032` `f5fed21` `2027157`

The largest architectural change of the project. Rebuilt the agent from a text-dumping script into a real tool-use loop.

**Real tool-use loop** (`1e67b05`):

Before: code called Python functions directly, passed results as text context to Claude. Claude made one call and returned.

After: Claude receives a `tools` array. When it needs information, it returns `stop_reason: "tool_use"` with a function name and arguments. The agent runs the function and sends back a `tool_result`. Claude continues — calling more tools or returning a final answer.

*Why this matters:* In the old approach, the code decided what to read and passed it to Claude. Claude had no agency over the loop. In the new approach, Claude decides what to read based on the question. This is the distinction between a wrapper and an agent.

**`write_file` with approval gate** (`d067032`):

Shows diff, requests confirmation, only writes on explicit approval. Git backup runs before every write.

*Why gate before write:* Once a file is written, it must be manually undone. Showing the diff before writing gives the opportunity to stop a bad change before it is applied — the same principle as reviewing before merging.

**`run_command` with allowlist** (`f5fed21`):

Only a defined set of commands can execute. Everything else is blocked.

*Why allowlist over blacklist:* A blacklist of dangerous commands is always incomplete. A whitelist of safe commands is complete by definition — if a command is not in the list, it cannot run. Secure by default.

**Auto-context loader** (`2027157`):

When reading a file, automatically reads its direct imports.

*Why:* Most code questions span multiple files. Auto-loading imports gives Claude the necessary context without requiring the caller to enumerate every relevant file.

---

## May 7, 2026 — Structured tool responses + prompt caching

**Commits:** `cb4d9a0` `6cfb9af` `6516109` `bc2036b`

**Structured response format for all 3 tools:**

Before: `read_file` returned raw file content as a string.
After: returns `{ file_path, line_count, language, content, truncated }`.

Same treatment for `list_files` (added `total_count`, `filtered_count`) and `search_code` (added `match_count`, `files_searched`, per-result `file_path` + `line_number`).

*Why structured:* Raw strings give Claude no metadata. Structured responses allow precise answers: "Line 47 of `src/middleware/auth.js`" instead of "somewhere in auth.js."

**Prompt caching** (`cache_control: ephemeral` on system prompt):

*Why at this stage:* In the multi-turn tool-use loop, the system prompt is sent on every round trip. A 2000-token system prompt across 8 tool calls = 16,000 input tokens per conversation just for the system prompt. With caching, that same prompt costs approximately 200 tokens after the first call — roughly 90% reduction on the cached portion.

---

## May 1, 2026 — Project foundation: CLI agent

**Commits:** `d1b2271`

Built the working v0.1 CLI agent. Three tools: `read_file`, `list_files`, `search_codebase`. Three modes: `--review`, `--ask`, `--health-check`. Interactive chat as default.

*Why start with read-only file tools:* These cover the core use case — reading code and answering questions. Write tools require an approval gate. Git tools add a library dependency. DB tools require SSM tunnel setup. Starting with read-only tools meant something testable on day one.

*Why Python for v0.1:* Faster to prototype. The agent was migrated to Node.js in Week 2 to match the TIQ stack.

---

## April 23–24, 2026 — Architecture planning

**Commits:** (design documents, no code)

Wrote `docs/system-design.md` before writing any v0.2 code. Defined 9 tools, the tool-use architecture, and the human-in-the-loop model.

*Why spend two days on design before coding:* The v0.2 tool-use loop commits to an architecture. Changing it after building on the wrong foundation requires a full rewrite. The design phase ensured that decision was made once, correctly.

*Why DB access is the core differentiator:* Generic AI coding tools have no knowledge of TIQ World's actual data. This agent can answer questions like "which team members haven't logged progress today?" No off-the-shelf tool can do that for this specific context.

*Why human-in-the-loop for writes:* Trust is built incrementally. Starting with read-everything, suggest-anything, write-nothing-without-approval was the right balance for an early prototype. Autonomy expanded as safety mechanisms were proven — git backup, confidence scoring, approval gates, rollback.

---

## April 22, 2026 — Project start

**Commits:** `920c240`

Set up the GitHub repository. Built the first working version — v0.1 with review, Q&A, health-check, and interactive modes.

*Why tool-use over chatbot:* A chatbot answers questions. An agent navigates the codebase. The goal was the latter — something that reads files, traces errors, and proposes fixes without requiring the user to copy-paste code into a chat window. Tool use is the architectural choice that makes that possible.
