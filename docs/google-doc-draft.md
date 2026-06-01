# TIQ World AI Agent — Daily Work Log
**Intern:** Shalini Mishra
**Project:** Claude-powered AI Agent for TIQ World codebase
**Lead:** Manu (TIQ)
**Period:** April 22 – ongoing

---
> NOTE: This document is meant to be hand-typed into your Google Doc.
> Each entry explains WHAT was built and WHY — written for review readability.
---

## June 1, 2026

**Commits:** `b9293aa` `9b0a46d` `96db013` + docs updates

**What I did:**

Three UI changes and a complete technical documentation pass.

**1. Right panel collapsed by default**

The admin/context panel on the right now starts at width 0 on first load. A toggle button sits at the right viewport edge — click to expand, same as left sidebar. State is saved in `localStorage` (`tiq-right-open`) so it persists across reloads. Resize handle is hidden while collapsed.

*Why:* The right panel (Approvals, Writes, Tools, Maintenance, Admin) is reference information, not the primary interface. Forcing it open on every load pushed the chat area into a narrow column and looked cluttered. Collapsing by default gives full width to the chat — the main use case. This is the same pattern VS Code and JetBrains use for secondary panels. The localStorage persistence means users who prefer it open don't have to re-expand every session.

**2. Visual consistency pass**

Standardised button hover states, tab active indicators, sidebar spacing, chat bubble padding. Nothing dramatic individually, but inconsistencies had accumulated across sessions of rapid feature building.

*Why:* A tool that looks inconsistent makes people distrust it. When buttons behave differently in different parts of the UI, users wonder what else is inconsistent. This was deferred polish from all the feature work — now done before review.

**3. Three bug fixes**

- Resize handle showing while panel is collapsed (visual clutter)
- `localStorage` state being overwritten on page load (init order bug)
- Admin tab content not scrollable when panel is narrow

*Why fix these now:* All three were small but visible. Any of them would be the first thing a reviewer notices.

**Also:** Completed `docs/TECHNICAL.md` — full documentation of all 27 tools, API endpoints, UI architecture, deployment checklist. This was a flagged gap from May 29.

---

## May 29, 2026 — v1.0.0: All gaps closed

**Commits:** `branch_write`, `sessionPersistence`, 48 new tests, system-design v4.0

**What I did:**

Closed the last two major gaps from the honest gap analysis (Session 8).

**1. `branch_write` tool** (`src/tools/branchWrite.js`)

Instead of writing directly to the working tree, `branch_write` creates a feature branch `agent/fix-<slug>-<timestamp>`, commits the file on that branch, returns branch name + diff + next steps, then switches back to the original branch. Same safety gates as `write_file`: self-protect → credential_guard → then git.

*Why:* `write_file` writes directly to disk — if something goes wrong, the working tree is modified with no clean rollback path. `branch_write` means every agent-proposed fix lives on its own branch. The human reviews a PR before merging. This is the correct workflow for any team using code review, and it's what makes the agent safe to use on a real shared codebase. Without this, the agent writing files would bypass the whole team's review process.

**2. Session persistence** (`src/sessionPersistence.js`)

Sessions now survive server restarts. After each response, the router saves a snapshot to `logs/sessions/{id}.json`. On `getSession()`, if not in memory, it loads from disk. 24h TTL, corrupt JSON handled safely. Saved per session: history (last 8), filesRead, toolCalls (last 50), writes (last 20).

*Why:* Before this, restarting the server (or a crash) wiped all session context. The user would lose their conversation history and the agent would lose awareness of what files it had already read. For a tool used during active debugging sessions, this was a real usability problem. Disk persistence with a 24h TTL is the right trade-off — keeps recent context, doesn't accumulate forever.

**3. 48 new tests** — scheduler (28), sessionPersistence (12), branchWrite (8). Total: 151 passing.

**Version bump 0.9.0 → 1.0.0** — all documented gaps resolved.

---

## May 28, 2026 — Production safety hardening + health_monitor + credential_guard + UI overhaul

**Commits:** 14 commits across safety, tools, and UI

**What I did (split into areas):**

**Safety hardening (3 critical fixes):**

Fix 1 — Agent self-protection. The agent can now never autonomously modify its own source files or DB migrations. Hard block in both `writeFile.js` and `scheduler.js` (`HIGH_RISK_PATTERNS`).

*Why this is critical:* Without self-protection, a cleverly crafted prompt could convince the agent to modify `src/tools/writeFile.js` itself — effectively disabling the approval gate. Once an agent can rewrite its own safety rules, every other protection becomes meaningless. This is the "jailbreak via tool" threat model. The fix: protected paths are checked before any write, no exceptions.

Fix 2 — Auto-fix confidence threshold raised from 55% to 80%.

*Why:* 55% means almost 1 in 2 auto-fixes could be wrong. The agent was writing code with coin-flip confidence. 80% means only fixes where the agent is genuinely confident proceed automatically. Everything below 80% goes to the user for review. This makes the "autonomous" label actually meaningful.

Fix 3 — Command allowlist changed from prefix-match to exact Set.

*Why:* `startsWith('npm run test')` would pass `npm run test:staging` or `npm run test && rm -rf`. Exact match + strict patterns close this gap entirely.

**New tools:**

`health_monitor` — HTTP probes, log anomaly scan, Node process vitals. Runs every 2h in day cycle, triggers `notify()` on DEGRADED/UNHEALTHY.

*Why:* The agent needs to know if the platform it's monitoring is actually up. Without this, it could report "no issues found" while the server is down. Three signal layers give different failure modes: HTTP probe catches dead server, log scan catches runtime errors, process vitals catch memory leaks.

`credential_guard` — 13 detection rules for AWS keys, PEM keys, passwords, DB strings, JWT secrets, etc. Runs as a write gate on every `write_file`.

*Why:* An agent that can write files is also an agent that could accidentally write a file containing a secret. This happened in real-world AI coding tools. The guard runs before every write — if a secret pattern is detected, the write is blocked and logged regardless of what the agent was asked to do.

**UI overhaul:**

Bilateral panel toggles (`position: fixed`), drag-to-resize both sidebars (persisted in localStorage), Quick Actions button replacing admin widget, Admin tab default on page load.

*Why fixed position for toggles:* They were clipped by `overflow: hidden` on the parent container. Fixed position removes them from the normal flow and places them relative to the viewport — the only reliable way to keep them visible at all sidebar widths.

---

## May 27, 2026 — Deep audit: 6 production bugs fixed, CI added, 50+ commits

**Commits:** 40+ commits — deep audit, fixes, tests, CI, tiq_workplace alignment

**What I did:**

Full production audit day. Found and fixed bugs that had been accumulating, added proper tests, set up external CI, and aligned the agent with the real `tiq_workplace` codebase structure.

**6 production bugs fixed:**

1. `gitBackup` restore was a no-op — `action` parameter was never read. Rollback did nothing silently.
   *Why it matters:* The entire auto-fix safety net depended on rollback working. It didn't.

2. `runCommand` had `npm test` hardcoded — TIQ uses `npm --prefix backend/<service> test`. Every run_command call would fail.

3. `searchCode` only used `includes()` — no regex support, results were uncapped. Added `is_regex` param and `max_results: 100` default.

4. `writeFile` diff showed 500 lines for a 1-line change — context-aware diff with `@@ line N @@` headers added. 3-line context, not full file.

5. Maintenance tool budget was 8 — `git_backup → show_diff → write_file → run_command` = 4 calls minimum. Scheduler now passes `toolBudget: 20`.

6. Scheduler had no `sessionId` — all maintenance calls were polluting the `'default'` session, mixing with user conversations.

**"Judge & Criminal" problem solved:**

Added `HIGH_RISK_PATTERNS` — agent cannot modify its own test files. GitHub Actions CI is the independent external judge that runs tests. Without this, the agent could pass tests by editing them.

*Why this design:* Any system where the same entity that writes fixes also runs the tests that verify them is unreliable. The fix and the judge must be separate. GitHub Actions runs in a clean environment the agent can't touch.

**tiq_workplace alignment:**

System prompt rewritten for TypeScript microservices (Fastify, PostgreSQL, BetterAuth, 7 backend services). runCommand whitelist updated. HIGH_RISK_PATTERNS updated for real file paths.

*Why:* The agent was configured for a MERN stack but the actual review codebase (`tiq_workplace`) is TypeScript microservices. Every suggestion and every protected path was wrong. This had to be corrected before any real use.

---

## May 26, 2026 — Secret scanner, dep updater, notifications, admin panel, UI overhaul

**Commits:** `ec73f91` `b69cbb5` `bc05628` `09f8d1b` `b41c4c7` + merge + fixes

**What I did:**

First big feature day after the maintenance system. Added two new tools, a notification system, rewrote the admin panel, and overhauled the UI.

**`secret_scanner` tool:**

Scans the entire codebase for leaked credentials — API keys, JWT secrets, passwords, private keys, .env content in non-.env files.

*Why:* Secrets committed to git are one of the most common and costly security mistakes in dev teams. An agent that can review code should be able to flag this automatically. The scanner runs on demand from the admin panel or via the maintenance scheduler's nightly scan.

**`dep_updater` tool:**

Checks npm outdated and categorises dependencies by risk level (patch / minor / major). Returns a `safe_update_command` for patches only.

*Why:* Outdated dependencies are a maintenance debt that compounds silently. The categorisation matters — patch updates are safe to auto-suggest, major updates might have breaking changes and need human review. The tool distinguishes these so the agent doesn't suggest `npm update` on everything blindly.

**Notification system** (`src/notifications.js`):

Persistent in-app notifications with bell icon. Webhook support for external alerts.

*Why:* The maintenance scheduler was running silently. If it found issues at 2am, there was no way to know until you opened the admin panel. Notifications give the tool a feedback loop — the agent's findings reach the human.

**Admin panel merged into single-page UI:**

Before this, admin was a separate `/admin` route. Merged it into a tab in the right panel.

*Why:* Separate page meant switching context to check maintenance status. Integrated tab means you can chat with the agent and check admin without leaving the page.

---

## May 23, 2026 — Semi-autonomous maintenance system

**Commits:** `2e2b55a`

**What I did:**

Built the scheduler — the closest the agent gets to true autonomy.

`src/scheduler.js` runs two cycles:
- **Night (2am):** Full scan → if issues found + confidence ≥ threshold → git backup → show diff → write fix → run tests → rollback if tests fail
- **Day (every 2h):** Health check only, no writes

*Why two different cycles:* Night cycle has autonomy because humans aren't around to approve anyway, and the git backup + test + rollback chain makes it safe — if anything goes wrong, it rolls back automatically. Day cycle is read-only because writes during working hours should go through the human approval gate.

*Why confidence threshold:* Not every issue the agent finds is one it should auto-fix. Low-confidence fixes should surface to the human. High-confidence fixes (syntax errors, obvious import issues, dead code) can be auto-applied. The threshold separates "I'm sure about this" from "I think maybe."

*Why git backup before every write:* Even with confidence scoring, the agent can be wrong. Git backup means every auto-fix can be undone in one command. This is the safety net that makes autonomy acceptable.

---

## May 22, 2026 — fix_error tool + UI redesign

**Commits:** `17bc35a` `e88972d` `1c33ded`

**What I did:**

Built `fix_error` — a meta-tool that chains multiple tools together to go from error message to proposed fix.

Flow: paste error → agent reads relevant files → identifies root cause → generates fix → confidence score (0–100) → if ≥ threshold, full pipeline; if below, asks user.

*Why a meta-tool instead of individual steps:* When debugging, a developer doesn't call "read file", then "search code", then "write fix" one by one. They trace the error, understand context, propose a fix. `fix_error` mirrors that natural workflow — one call, full pipeline. The confidence scoring makes the autonomy boundary explicit: the agent self-reports how sure it is, and the threshold determines what gets auto-applied vs. what goes to review.

Also redesigned the UI — TIQ brand palette (dark orange + teal), left sidebar for tool list, right sidebar for session memory, real-time progress strip.

*Why redesign now:* The web interface had been built for functionality first. With `fix_error` adding a multi-step visible pipeline, the UI needed to show progress in real time. The redesign added the progress strip and session memory sidebar to make the agent's reasoning visible.

---

## May 21, 2026 — GitHub OAuth + audit trail + approval gates

**Commits:** `057ae61` `9606707` `446e935` `be06105`

**What I did:**

Three production-readiness features: authentication, logging, and human-in-the-loop enforcement.

**GitHub OAuth** (Passport.js):

Users sign in with real GitHub accounts. Every action is attributed to a real GitHub username.

*Why:* Before this, any action in the UI was anonymous. For a tool that writes files, anonymity is a problem — there's no record of who approved what. GitHub OAuth was the right choice because the team already uses GitHub and the TIQ codebase lives there. No new account system needed.

**Audit trail** (`src/activityLog.js`):

Every agent action logged to `logs/activity.jsonl` — tool calls, writes, approvals, who triggered what.

*Why JSONL format:* One JSON object per line. Appendable without rewriting the file. Grep-able. Tools like `jq` can query it. It's the format used by most production log systems. Easy to pipe into a log aggregator later.

**Write archive** (`src/writeArchive.js`):

Before/after content saved for every `write_file` call.

*Why:* Audit log tells you a write happened. Write archive tells you exactly what changed. Together they give you full traceability — if a file is wrong after an agent write, you can see the exact before/after diff.

**Approval gates:**

`approval_needed` SSE event → browser shows diff modal → user clicks Approve/Deny → `/api/approve` resolves the async Promise → agent continues or stops.

*Why async Promise:* The agent's tool call loop runs in Node.js. When it needs human approval, it can't just stop the process — it needs to pause and wait. An async Promise that resolves on the HTTP callback is exactly how you pause an async loop until an external event. The alternative (polling) would have been messier and slower.

---

## May 20, 2026 — Week 4: Web UI, 4 new tools, 10 more tools (total 24), dispatcher refactor

**Commits:** 20+ commits

**What I did:**

Biggest single day of the project. Week 4 goal was Web UI — ended up being much more.

**Web UI** (`src/web/`):

Express server + SSE streaming + single `index.html` with no build step. Dark theme, live tool call chips, markdown rendering.

*Why SSE instead of WebSockets:* Server-Sent Events are one-directional (server → client) which is exactly what streaming AI responses need. WebSockets are bidirectional — the added complexity isn't justified when you only need the server to stream tokens to the browser. SSE also works over standard HTTP, no protocol upgrade.

*Why no build step (no React/Vite):* This is a developer tool used by one team. A Vite build pipeline adds setup complexity with no benefit for this use case. A single `index.html` is instantly deployable, instantly inspectable, and works on any machine with Node.

**4 Week 4 tools:** `git_log`, `health_check`, `lint_file`, `db_query`.

`db_query` — read-only PostgreSQL via SSM tunnel.

*Why read-only enforcement:* The connection is to a dev database, but dev databases still contain real data (user records, progress, assessments). Read-only means the agent can answer data questions without any risk of accidental modification. This was a non-negotiable constraint from day one.

**7 more tools in one day:** `find_todos`, `check_env_usage`, `summarize_diff`, `detect_dead_code`, `schema_to_api`, `recall_session`, `in-memory session store`.

*Why so many at once:* These tools share a common pattern — they scan the codebase for a specific category of issue. Once the shared filesystem utilities (`getAllFiles`, `toRel`, `readSafe`) were extracted, adding each new tool was fast. Building the shared utils first made the tool explosion possible without duplicating code.

**Dispatcher refactor:** Rebuilt from `ALL_TOOLS` registry. No more per-tool import duplication.

*Why registry pattern:* Each new tool previously required adding an import AND a case in the dispatcher AND an entry in the tool list. Three places. Registry pattern means adding one entry in one place. Maintenance cost drops significantly as tool count grows.

**Bedrock prompt caching:** System prompt marked `cache_control: ephemeral`.

*Why now (not earlier):* Prompt caching saves tokens on repeated calls with the same system prompt. In v0.1 (single API calls), caching saved almost nothing. In the tool-use loop (multiple round trips per conversation, all sharing the same system prompt), caching saves ~60% of input tokens on the cached portion. Week 4's tool-use loop was when caching became worth adding.

---

## May 18, 2026 — Week 3 complete: trace_error, map_dependencies, explain_route

**Commits:** `6005ff9`

**What I did:**

Completed the Week 3 tool trio. `trace_error`, `map_dependencies`, `explain_route` all wired into the agent. Tool count: 9.

`map_dependencies` — given a file path, returns which files it imports and which files import it (both directions). Builds an import graph.

*Why both directions:* Forward dependencies (what this file needs) tell you what could break if you change it. Reverse dependencies (what needs this file) tell you the impact radius of a change. A tool that only shows one direction gives half the picture.

`explain_route` — given an Express route, traces the full request flow: middleware chain → controller → service calls → DB queries.

*Why this tool:* New team members spend hours tracing routes manually — reading the route file, finding the controller, finding the service, finding the model. `explain_route` does it in one call. It's the highest-leverage onboarding tool in the set.

---

## May 17, 2026 — Dispatcher layer + git_backup tool + per-task tool scoping

**Commits:** `d24d2bc`

**What I did:**

Built the dispatcher — the routing layer that decides which tools Claude gets access to for a given task type.

Different task types need different tool sets:
- `query` (answering questions): read-only tools only
- `review` (code review): read + analysis tools
- `maintenance` (auto-fix): read + write + run_command
- `feature` (new code): full set

*Why scoped tool sets:* If every conversation gets every tool, Claude can call `write_file` when asked a simple question. Scoping prevents tool misuse by category. It also reduces the tools list sent to Claude per call — smaller tool list = less distraction, more focused responses.

Also added `git_backup` tool — creates a timestamped backup branch before any write.

*Why git_backup exists as a tool (not just internal logic):* Making it a callable tool means Claude can invoke it explicitly in its reasoning. When the agent says "I'll back up first, then apply the fix," that's Claude using git_backup as a deliberate safety step, not just a hidden side effect. The reasoning is visible in the tool call log.

---

## May 15, 2026 — Week 3 start: registry dispatcher, error_tracer, explain_route

**Commits:** `34a7df1` `7aac789` `862e653`

**What I did:**

Started Week 3. Two architectural changes and two new tools.

**Registry dispatcher** (replaced if-elif chain):

Before: `if task == 'query': return query_tools; elif task == 'review': return review_tools...`
After: `TASK_REGISTRY = { query: [...], review: [...] }; return TASK_REGISTRY[task]`

*Why:* The if-elif chain was already 40 lines for 4 task types. Adding a 5th task type meant touching the dispatcher logic. Registry pattern means adding a key to a dict — zero change to the routing code. This is the open/closed principle: open for extension, closed for modification.

**error_tracer tool:**

Takes a stack trace, identifies the originating file and line, reads that file plus its import chain, returns a structured analysis of likely root cause.

*Why start with error tracing for Week 3:* The most common developer question when something breaks is "where is this error coming from and why?" A tool that automates the manual trace-through-imports process has immediate daily utility. It was the highest-value Week 3 feature.

---

## May 13, 2026 — Recursive auto-context loader + showDiff error format

**Commits:** `740d104` `58b5894`

**What I did:**

Two improvements to existing tools.

**Recursive auto-context loader (depth 2, circular import guard):**

When Claude reads a file, the agent automatically reads its imports too (depth 1 was added May 11). Expanded to depth 2 — imports of imports. Added circular import detection using a visited Set.

*Why depth 2:* Most real bugs span 2 layers. A component imports a utility which imports a config. Stopping at depth 1 often misses the actual source of an issue. Depth 2 covers 90%+ of real debugging paths without the token explosion of unlimited depth.

*Why circular import guard:* Some codebases have circular dependencies (A imports B, B imports A). Without a guard, the auto-loader would recurse infinitely. The visited Set breaks the cycle — if a file has already been loaded in this chain, skip it.

**showDiff error format** — standardised to `{ error, path, suggestion }`.

*Why structured errors:* Unstructured error strings are hard for Claude to act on. `{ error: "file not found", path: "src/auth.js", suggestion: "check if path is relative to project root" }` tells Claude exactly what's wrong, where, and what to try next. Structured errors = better agent reasoning.

---

## May 12, 2026 — AWS Bedrock migration + show_diff tool

**Commits:** `c082fb9` `951f9d5`

**What I did:**

Two significant changes: migrated the AI provider and added the diff tool.

**AWS Bedrock migration** (Anthropic SDK → `BedrockRuntimeClient`):

Switched from calling `api.anthropic.com` directly to routing through AWS Bedrock.

*Why Bedrock:* TIQ's infrastructure is AWS. Using Bedrock means the API calls stay within the AWS network — lower latency, no data leaving the cloud provider, same IAM permissions model the rest of the infrastructure uses. It also means the agent can use the same AWS credentials already configured on the machine (instance profile / SSM) rather than a separate Anthropic API key.

*Trade-off acknowledged:* Bedrock adds an AWS dependency. If the agent needs to run outside AWS, it requires an extra setup step. Acceptable for an internal tool tied to TIQ's infrastructure.

**`show_diff` tool:**

Shows before/after comparison for a proposed file change before it's applied. Context-aware — shows `@@ line N @@` headers with 3-line context around changes, not the full file.

*Why context-aware diff (not full file):* If you're changing line 47 of a 300-line file, showing all 300 lines is noise. 3-line context around the change is exactly what a code reviewer looks at. This matches how `git diff` works by design.

---

## May 11, 2026 — v0.2: Real tool-use loop + write_file + run_command + auto-context

**Commits:** `1e67b05` `5da6321` `d067032` `f5fed21` `2027157`

**What I did:**

The biggest architectural change of the project. Rebuilt the agent from a text-dumping script into a real tool-use loop.

**Real tool-use loop** (`1e67b05`):

Before: agent.py called Python functions itself, passed results as text context to Claude. Claude made one call and returned.

After: Claude gets a `tools` array. When it needs information, it returns `stop_reason: "tool_use"` with the function name and arguments. The agent runs the function and sends back a `tool_result`. Claude continues — calls more tools or returns the final answer.

*Why this matters:* In the old architecture, I decided what files to read and passed them to Claude. Claude had no agency. In the new architecture, Claude decides what to read based on the question. If it needs more context, it calls another tool. This is what makes it an agent rather than a wrapper. The difference is who controls the reasoning loop.

**`write_file` with approval gate** (`d067032`):

Shows diff, asks for user confirmation, only writes on explicit yes. Git backup before every write.

*Why approval gate before write (not after):* Once a file is written, the user has to undo it. Showing the diff before writing gives the user a chance to stop a bad change before it happens. This is the standard code review model — review before merge, not after.

**`run_command` with whitelist** (`f5fed21`):

Only a specific set of commands can be executed. Everything else is blocked.

*Why whitelist (not blacklist):* A blacklist of dangerous commands is always incomplete. There will always be a dangerous command you didn't think to block. A whitelist of safe commands is complete by definition — if it's not in the list, it can't run. Secure by default.

**Auto-context loader** (`2027157`):

When reading a file, automatically reads its direct imports too.

*Why:* Most code questions span multiple files. "Why is this function returning null?" often requires reading both the function and what it calls. Manual "read file A, now read file B" is tedious. Auto-loading imports gives Claude the context it needs without the user having to specify every file.

---

## May 7, 2026 — Structured tool responses + prompt caching

**Commits:** `cb4d9a0` `6cfb9af` `6516109` `bc2036b`

**What I did:**

Two categories of improvement: better tool output format and prompt caching.

**Structured response format for all 3 tools:**

Before: `read_file` returned raw file content as a string.
After: returns `{ file_path, line_count, language, content, truncated }`.

Same for `list_files` (added `total_count`, `filtered_count`) and `search_code` (added `match_count`, `files_searched`, per-result `file_path` + `line_number`).

*Why structured:* Raw strings give Claude no metadata. Claude couldn't say "this file is 847 lines" or "I found 12 matches across 4 files" because it didn't know. Structured responses let Claude give precise answers and reference exact locations. This is the difference between "I found something in auth.js" and "Line 47 of src/middleware/auth.js."

**Prompt caching** (`cache_control: ephemeral` on system prompt):

*Why add caching at the tool-use loop stage:* In the multi-turn tool-use loop, the system prompt is sent on every round trip. A 2000-token system prompt × 8 tool calls = 16,000 input tokens just for the system prompt per conversation. With caching, that same prompt costs ~200 tokens after the first call. ~90% reduction on the cached portion. This compounds with every conversation.

---

## May 1, 2026 — Project foundation: CLI agent

**Commits:** `d1b2271`

**What I did:**

Built the working v0.1 CLI agent. Three tools: `read_file`, `list_files`, `search_codebase`. Three modes: `--review`, `--ask`, `--health-check`. Interactive chat default.

*Why start with just 3 tools:* These three cover the core use case — reading code and answering questions about it. Write tools add approval gate complexity. Git tools add gitpython dependency. DB tools add SSM tunnel requirement. Starting with read-only file tools meant something working and testable on day 1.

*Why Python for v0.1:* The Anthropic SDK, gitpython, and rich library all have first-class Python support. TIQ's backend is Node.js, but for a CLI tool the team will run on their machines, Python was faster to prototype. (Week 2 migrated to Node.js to match the TIQ stack.)

---

## April 23–24, 2026 — Architecture planning

**Commits:** (design docs, no code)

**What I did:**

Wrote `docs/system-design.md` before writing any v0.2 code. Defined 9 tools, the tool-use architecture, and the human-in-the-loop model.

*Why spend 2 days on design before coding:* The v0.1 approach (dump text into prompt, get answer) is a dead end. Once you build a tool-use loop, the architecture commits you — changing it later means rewriting the orchestrator. I wanted to make the decision once, correctly, rather than refactor after building on the wrong foundation.

*Why DB access is the core differentiator:* GitHub Copilot, Cursor, Devin — none of them know anything about TIQ World's actual data. This agent can answer "which interns haven't submitted this week?" or "what's the average assessment score for Track 2?" No off-the-shelf tool can do that for our specific context. DB access is what makes this agent TIQ-specific rather than generic.

*Why human-in-the-loop for writes:* Trust is built incrementally. A new tool should earn trust before getting more autonomy. Starting with read-everything, suggest-anything, write-nothing-without-approval was the right balance for an early prototype. Autonomy expanded as the safety mechanisms were proven (git backup, confidence scoring, approval gates, rollback).

---

## April 22, 2026 — Day 1: Project assigned

**Commits:** `920c240`

Got the project assignment: build a Claude-powered AI agent that acts as a tech team member for TIQ World. Set up the GitHub repo. Built the first working version — v0.1 with review, Q&A, health-check, and interactive modes.

*Why tool-use over chatbot:* A chatbot answers questions. An agent navigates the codebase itself. The goal was the latter — something that can read files, trace errors, and propose fixes without the human having to copy-paste code into a chat window. Tool use is the architectural choice that makes the difference.
