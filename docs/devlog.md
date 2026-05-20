# TIQ World AI Agent — Dev Log

*Daily progress log for the TIQ World AI Agent project.*

---

## May 20, 2026

### Part 1 — Dispatcher bug fix (morning)

Found and fixed a silent wiring bug: `trace_error`, `map_dependencies`, `explain_route` (all built May 18) were in `DEFAULT_TOOLS` inside agent.js, but every real code path goes through the dispatcher which returns a scoped tool set. None of the four task types included Week 3 tools. Fixed by adding them to all scopes and extracting a shared `ANALYSIS_TOOLS` constant.

---

### Part 2 — 7 new tools + architecture refactor (afternoon)

Major expansion of the agent. Tool count: 9 → 16.

#### New file: `src/utils/fs.js`
Extracted a shared filesystem utility module — `getAllFiles`, `toRel`, `readSafe`, `SKIP_DIRS`, `CODE_EXTS`, `CONTENT_EXTS`. Before this, every tool had its own copy of the directory-walking logic with slightly different skip lists and extension filters. That's the kind of silent divergence that causes bugs — one tool scans `.json` files, another doesn't; one skips `.cache`, another doesn't.

The shared util is the single source of truth. Adding a new directory to skip (e.g. `.turbo`) happens in one place and instantly applies to all tools.

#### New tool: `find_todos` (`src/tools/findTodos.js`)
Scans the entire codebase for `TODO`, `FIXME`, `HACK`, `DEPRECATED`, `BUG`, `OPTIMIZE`, `XXX`, `NOTE` comments. Groups results by file with line numbers. Each hit has a severity level: `critical` (FIXME/BUG), `warning` (HACK/DEPRECATED), `info` (TODO/OPTIMIZE). Also accepts a `tags` filter so you can ask for only FIXME items.

Why: Technical debt is invisible until someone asks "what's broken or half-done?" This tool makes it answerable in one question. It's also a good thing to show a lead — it proves the agent can surface real, actionable information from the codebase, not just answer abstract questions.

#### New tool: `check_env_usage` (`src/tools/checkEnvUsage.js`)
Compares `.env.example` with actual `process.env.X` calls in code. Returns two lists:
- `missing_from_example` — keys used in code but not documented (onboarding hazard — new devs won't know to set them)
- `documented_but_unused` — keys in `.env.example` with no corresponding code usage (dead config)

Why: This is a real problem on any growing project. Env vars get added in a rush, the example file doesn't get updated, someone clones the repo and the server fails with a cryptic `undefined` error. One tool call catches this category of problem permanently.

#### New tool: `summarize_diff` (`src/tools/summarizeDiff.js`)
Runs `git diff` in three modes — staged, unstaged, or all commits ahead of a base branch — and returns the output. Used by Claude when writing commit messages or PR descriptions so the summary is grounded in actual changed lines, not memory.

Why: Without this, if you ask "write me a commit message", Claude has to guess from context. With this, it reads the actual diff and writes an accurate message. The `branch` mode (all commits since main) is specifically for PR description generation.

#### New tool: `detect_dead_code` (`src/tools/detectDeadCode.js`)
Builds a reverse import map of the entire codebase — which files are imported by which other files. Any file with zero importers is flagged as potentially dead. Entry-point files (index/main/server/app/cli/seed) are excluded since they're expected to have no importers.

Why: Codebases accumulate orphaned files over time — a utility that got refactored away, a component that was replaced, a helper that nobody deleted. This surfaces them so you can decide whether to delete or re-wire them.

#### New tool: `schema_to_api` (`src/tools/schemaToApi.js`)
Given a Mongoose model name (e.g. "Track"), checks which standard CRUD operations are implemented — GET list, GET by ID, POST create, PUT update, DELETE. Scans all route and controller files for verb patterns matching the model name. Returns `found` / `missing` status for each operation.

Why: TIQ has a consistent pattern for entities. When adding a new model, the question is always "what routes do I still need to write?" This tool answers that in one call instead of manually grepping for each verb. It also catches gaps in existing models — maybe GET by ID exists but DELETE was never implemented.

#### New tool: `recall_session` (`src/tools/recallSession.js`) + `src/session.js`
Two-part feature:
- `session.js` — a lightweight in-memory log that records every tool call (name, input, result summary, timestamp) for the current process lifetime
- `recall_session` tool — Claude can call this to see what it already read or changed this session before deciding to call `read_file` again

Why: Without this, if Claude reads `auth.controller.js` at the start of a multi-turn conversation and you ask a follow-up question later, it either re-reads the file (wastes a tool call and tokens) or guesses from memory (may hallucinate stale details). `recall_session` gives it accurate, cheap access to session history. It's the difference between a developer who takes notes and one who doesn't.

---

### Architecture improvements

**`agent.js` — `ALL_TOOLS` registry**
Replaced `DEFAULT_TOOLS` with a properly named `ALL_TOOLS` export. All 16 tools are registered here in one place, organized by category (exploration / analysis / write+verify). The dispatcher and index.js import from this registry instead of maintaining their own import lists.

**`dispatcher.js` — allowlist-based scoping**
The old dispatcher duplicated every tool import and manually built four identical-looking tool sets. The new version uses three named allowlist Sets (`READ_ONLY`, `REVIEW_EXTRA`, `WRITE`) and a single `scopeTools()` function that filters `ALL_TOOLS` by name. Adding a new tool now requires only one line in `ALL_TOOLS` and one line in the relevant allowlist — the dispatcher gets it automatically.

Before: adding a new read-only tool required edits in 5 places (agent.js imports, DEFAULT_TOOLS definitions, DEFAULT_TOOLS executors, dispatcher imports, dispatcher all four task sets).
After: 2 places (ALL_TOOLS definitions, ALL_TOOLS executors).

**`index.js` — CLI improvements**
- `help` command added — shows task types, tool count, and example queries
- Tool count displayed in banner (auto-updates when tools are added)
- `clear` now reports how many tool calls were in the session before resetting
- Better error messages for rate limiting vs credential errors

---

### Tool count progression
| Week | Tools | New additions |
|------|-------|---------------|
| 1    | 3     | list_files, read_file, search_code |
| 2    | 6     | write_file, run_command, show_diff |
| 3    | 9     | trace_error, map_dependencies, explain_route |
| 3 (late) | 10 | git_backup + dispatcher registry |
| Today | 16  | find_todos, check_env_usage, summarize_diff, detect_dead_code, schema_to_api, recall_session + shared fs utils + architecture refactor |

### What's next (Week 4: May 22–31)
- Web UI — Express server + React frontend, move out of CLI
- `db_query` tool — natural language → SQL via postgres MCP tunnel
- Session memory persistence across process restarts (optional — low priority vs web UI)

---

## May 18, 2026

### What was done today

Built three new tools for Week 3 (code review mode + bug detection):

**1. `trace_error` (`src/tools/traceError.js`)**
Given a Node.js/Express error message or stack trace, this tool:
- Parses the stack trace to extract file paths and line numbers
- Reads those files automatically with context around the error line (8 lines before/after)
- Extracts identifiers (controller names, route paths, function names) from the error text
- Searches the codebase for those identifiers to find all related code

**2. `map_dependencies` (`src/tools/mapDependencies.js`)**
Builds an import dependency graph for a file or directory (outgoing + incoming).

**3. `explain_route` (`src/tools/explainRoute.js`)**
Given an Express route path, traces route → middleware → controller → service.

### Tool count: 6 → 9

---

## May 11, 2026

### What was done today
- Reviewed the current project state end to end
- Pushed all local commits that had never been pushed to GitHub
- Assessed Week 2 progress: tool-use loop is designed but not coded yet

### What I realized
The commit trail was completely missing. Going forward: every day I work, I push a commit and update the doc on the same day.

---

## May 9, 2026 (Leave)

### What was done today
- Planned the real tool-use loop in detail
- Read Anthropic's tool use documentation: send `tools` array → Claude returns `stop_reason: "tool_use"` → run function → send `tool_result` → loop

### Key insight
The difference between v0.1 and a real agent is who controls the loop. Claude must decide what it needs, not my code.

---

## May 8, 2026

### What was done today
- Week 1 retrospective
- Set up Week 2 goals: show_diff, approval gate, git tools, run_command
- Designed approval gate flow: propose → diff → confirm → write

---

## May 7, 2026

### What was done today
- End-of-week cleanup pass
- Found search_codebase truncates at 5 matching lines — noted for v0.2
- Confirmed EXCLUDE_DIRS working, node_modules not scanned

---

## May 6, 2026

### What was done today
- Updated SYSTEM_PROMPT with TIQ-specific codebase context
- Hallucination noticeably reduced after adding "only reference code from context"

---

## May 5, 2026

### What was done today
- First real test against actual TIQ codebase
- Found and fixed: import path bug, hallucination in Q&A, search result overload

---

## May 2, 2026

### What was done today
- Built `config/settings.py` — centralized all configuration
- `EXCLUDE_DIRS`, `MAX_FILE_SIZE`, API key from env only
- Fixed bug in get_file_summary() counting .git objects as source files

---

## May 1, 2026

### What was done today
- First day of building: agent.py, tools.py, prompts.py
- Four CLI modes: --review, --ask, --health-check, interactive
- Deliberately left out write_file until approval gate is designed

---

## April 28–30, 2026 — Research & Design

- Anthropic tool use docs, message flow, token limits
- gitpython, psycopg2 research
- Decision: no auto-push, no delete, no merge without human

---

## April 25–27, 2026 — Research & Design

- Mapped full tool list
- Our unique advantage: the database — natural language against TIQ data

---

## April 23–24, 2026 — Architecture Planning

- Designed v0.2 architecture — system-design.md written
- Core decision: tool-use over text-dumping

---

## April 22, 2026

- Got project assignment
- Set up GitHub repo
- Built v0.1 foundation
