# TIQ World AI Agent — Dev Log

*Daily progress log for the TIQ World AI Agent  project.*

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
- Returns everything structured so Claude can trace the full failure path without manual searching

Why: Previously the agent could search for a keyword, but errors span multiple files. A real error tracer needs to follow the stack automatically, not wait for Claude to ask for each file one by one.

**2. `map_dependencies` (`src/tools/mapDependencies.js`)**
Builds an import dependency graph for a file or directory:
- Outgoing: what does this file import (recursive, configurable depth 1-4)
- Incoming: which files import this file (scans entire codebase)
- Directory mode: full import map for all files in a folder (1-level, shows the whole wiring)

Why: Before changing a shared file (middleware, utility, model), you need to know its blast radius — who will break if the interface changes. `incoming_importers` answers that instantly instead of grep-and-hope.

**3. `explain_route` (`src/tools/explainRoute.js`)**
Given an Express route path like `/api/auth/login`, traces the complete request pipeline:
- Finds the route definition in routes files (auto-discovers, no path needed)
- Finds where the router is registered in app.js/server.js
- Extracts handler and middleware function names from the route definition
- Finds where each handler function is actually defined (controller/service files)
- Returns related middleware files (auth, validation, etc.)

Why: The most common question on a MERN codebase is "how does this endpoint work end to end?" Previously that required reading 4-5 files manually. Now one tool call returns the entire pipeline.

### Registration
All three tools added to `src/agent.js`:
- Imports added at top
- Added to `toolDefinitions` array (now 9 tools total)
- Added to `executeTool` switch
- System prompt updated with tool descriptions

### Tool count: 6 → 9
`list_files`, `read_file`, `search_code`, `write_file`, `run_command`, `show_diff`, `trace_error`, `map_dependencies`, `explain_route`

### What's next (remaining Week 3 work)
- Test all three tools against the actual TIQ codebase to verify they find real results
- Tune regex patterns if stack trace parsing misses edge cases
- Week 4 starts May 22: session memory + web UI

---

## May 11, 2026 

### What was done today
- Reviewed the current project state end to end: what is built, what is partially done, what hasn't started
- Checked that all code files are committed and pushed to GitHub — found that nothing after the April 22 initial commit had been pushed, fixed that
- Assessed Week 2 progress: tool-use loop is designed but not coded yet, approval gate is planned but not integrated, git tools not started

### What I realized
The commit trail was completely missing. Code was being written and tested locally but never pushed. The Google Doc was also not being updated daily. Both of these are problems because the lead can't see progress if it's only on my machine. Going forward: every day I work, I push a commit and update the doc on the same day.

### Current project status
- v0.1: Complete — CLI with review, Q&A, health check, interactive mode
- v0.2: Designed (system-design.md), not yet built — tool-use loop, approval gate, git tools, DB tools are all pending
- This week's focus: implement the real tool-use loop in agent.py


## May 10, 2026  

## May 9, 2026 (Leave)

### What was done today
- Planned in detail how the real tool-use loop should work in agent.py
- Read Anthropic's tool use documentation carefully — understood the exact message flow:
  1. Send Claude a `tools` array with function definitions
  2. Claude returns `stop_reason: "tool_use"` with a `tool_use` block naming which function to call
  3. Run the function locally, send back `tool_result`
  4. Claude either calls another tool or returns a final answer
- Current agent.py calls Python functions itself and passes results as text — this is NOT how tool use works. This is the main thing to fix in v0.2.
- Wrote notes on the refactor: `ask_claude()` needs to become a loop instead of a single API call

### Key insight today
The difference between v0.1 and a real agent is who controls the loop. In v0.1, my code decides what to search and what to pass as context. In a real tool-use agent, Claude decides — it tells me what it needs, I run it, and it decides what to ask for next. That's what makes it actually intelligent instead of a fancy search wrapper.

### What's next
- Start coding the tool-use loop refactor
- The loop structure: call Claude → check stop_reason → if tool_use, execute and loop → if end_turn, return

---

## May 8, 2026 

### What was done today
- Week 1 retrospective — went through what was actually built vs. what was planned
- Week 1 plan had: CLI working, read tools, basic Q&A, system prompt improvement, prompt caching
- What got done: CLI ✓, read tools ✓, Q&A ✓, system prompt improved ✓ — prompt caching intentionally deferred
- Set up Week 2 goals: show_diff, approval gate for write_file, git tools, run_command
- Designed the approval gate flow: agent proposes change → show diff → user confirms yes/no → only then write happens

### Decision on write approval gate
The gate logic has to be in agent.py, not inside write_file() in tools.py. Tools should be pure functions — they do one thing, no user-facing prompts, no side effects beyond their output. If I put the gate inside write_file(), every test has to simulate user input. If it's in agent.py (the orchestrator), tools stay clean and testable.

---

## May 7, 2026 

### What was done today
- End-of-week cleanup pass on the codebase
- Reviewed tools.py and found: search_codebase returns at most 5 matching lines per file (`matching_lines[:5]`). For a short function this is fine. For a long file with a complex match, this cuts off important context. Made a note to make this limit configurable.
- Tested `--health-check` against the TIQ codebase — correctly identifies language breakdown and file count, correctly flags missing tests directory
- Reviewed config/settings.py — confirmed EXCLUDE_DIRS is working, node_modules not being scanned

### Note on tool response format
The current tools return raw content — read_file returns the full file text, search_codebase returns a list of match dicts. The v0.2 plan says to return structured context: `{ file_path, line_count, language, content }`. This makes it easier for Claude to reference exact locations in its answers. Planning to add this in the tool-use refactor.

---

## May 6, 2026 

### What was done today
- Updated SYSTEM_PROMPT in prompts.py to include TIQ World-specific codebase context
- Before this: Claude gave generic review output — "use environment variables for secrets", "add input validation" — technically correct but not useful for our specific codebase
- After adding TIQ's stack info and module structure: Claude references actual route names and module patterns in its output
- Also tested the QUESTION_PROMPT improvement from last week (added "only reference code from the provided context") — hallucination is noticeably reduced

### What I learned about prompts
A language model is only as useful as the context you give it. If the system prompt is generic, the output is generic. If it knows this is a MERN stack with specific modules, it gives answers relevant to those modules. Every token invested in a good system prompt pays off on every single API call after that.

---

## May 5, 2026

### What was done today
- First real test of the agent against the actual TIQ World codebase at `C:\Users\Shalini Mishra\TIQ`
- Ran `--ask "How does authentication work?"` — found auth.js, gave a reasonable answer
- Ran `--health-check` on the TIQ directory — correct language breakdown, flagged no tests directory
- Ran `--review` on one of the main route files — found some legitimate issues

### Bugs and issues found during testing

**Issue 1 — Import path bug:**
`from prompts import ...` breaks when running from outside the `agent/` directory. Fixed by adding `sys.path.insert(0, os.path.dirname(__file__))` at the top of agent.py. This tells Python to always look in the script's own directory for imports.

**Issue 2 — Hallucination in Q&A:**
Claude was sometimes referencing code that wasn't in the files it was given. It was "filling in" what it thought should be there based on its training. Fixed by adding an explicit constraint to QUESTION_PROMPT: "Only reference code from the context provided. Do not invent or assume code that was not shown to you."

**Issue 3 — Search result overload:**
When a keyword appears in many files, Claude gets too much unstructured text. Need better relevance ranking. Noted for v0.2.

---

## May 3–4, 2026 — Weekend

---

## May 2, 2026 

### What was done today
- Built `config/settings.py` — centralized all project configuration
- Built `requirements.txt` with version-pinned dependencies

Before this, model name and API settings were duplicated in agent.py. If the model name changes (which it will — `claude-sonnet-4-6` today, something else in a few months), I'd have to find every hardcoded reference. Centralizing in settings.py means one change, everywhere updated.

### Config decisions
- `EXCLUDE_DIRS` — skip node_modules, __pycache__, .venv, dist, build. Without this, list_files returns thousands of irrelevant files and the agent wastes tokens scanning them
- `MAX_FILE_SIZE = 100_000` (100KB) — skip huge files. Generated files, minified JS, etc. are not useful for code review and would overflow the context window
- API key is environment variable only — never hardcoded, never in config files. Agent exits with a clear error if key is not set.

Also fixed a bug in get_file_summary(): it was counting .git internal objects as files, making the "health check" show thousands of files instead of the actual source file count.

---

## May 1, 2026 

### What was done today
- First day of actual building — project structure set up, core files created
- Built the foundation: agent.py (CLI orchestrator), tools.py (file functions), prompts.py (prompt templates)

**agent.py:**
Used argparse for the CLI — gives `--help` output automatically and makes each mode independently callable. Interactive mode is a simple while loop, no complex state. Four modes: `--review`, `--ask`, `--health-check`, default interactive.

Used `rich` for terminal output — renders markdown, adds color, wraps in panels. This matters because Claude's review output is in markdown and without rendering it's a wall of symbols.

**tools.py:**
Four functions: read_file, list_files, get_file_summary, search_codebase. Search is simple string matching — not regex, not fuzzy. Most real queries are literal strings. Regex support can be added later if needed, but adding it now is premature.

Deliberately left out write_file — the system design requires a human approval gate before any write happens. Gate isn't built yet, so write shouldn't be available.

**prompts.py:**
Four prompt templates. The REVIEW_PROMPT structure (Critical / Warning / Suggestion) was a deliberate choice — unstructured review output is hard to act on. Severity tiers make it immediately clear what to fix first.

### Why I'm building this in Python
Python has the best ecosystem for this: official Anthropic SDK, rich for output, gitpython for git integration (coming in Week 2). It also matches the kind of tooling work the team likely does, and the Anthropic docs have Python examples for everything.

---

## April 28–30, 2026 — Research & Design (continued)

### What I was doing
- Went deep into the Anthropic documentation — tool use / function calling, system prompts, message structure, token limits
- Understood the difference between v0.1 (pass context as text) and v0.2 (give Claude actual tools to call) — this is the core architectural decision
- Researched gitpython library — understanding how to read git log, diffs, blame programmatically
- Researched psycopg2 for PostgreSQL — understanding how to safely run read-only queries against the TIQ dev DB through the SSM tunnel
- Looked at how other agents handle the "human approval before write" pattern — most use a simple yes/no confirmation loop

### Decision made this week: what the agent should NOT do
This is as important as what it should do. I decided early:
- No auto-push to GitHub
- No delete operations
- No merge without human
- No writing code directly — suggestions only
- Write access only to docs files, not source code

The reason: trust has to be built incrementally. A new team member doesn't get production deploy access on day one. Same principle applies here. Start with read-only, prove it's useful, expand later.

---

## April 25–27, 2026 — Research & Design

### What I was doing
- Started mapping out the full tool list — what does an agent need to actually be useful to a dev team?
- The problem with generic AI tools (Copilot, etc.) is they don't know anything specific about TIQ World's data. Our unique advantage is the database — natural language queries against TIQ's intern/course/progress data is something no off-the-shelf tool can do.
- Researched how Claude's tool use feature works under the hood — the message format, how tool results are sent back, multi-turn tool loops
- Started drafting the system design document (completed and written on April 23 in devlog)

---

## April 23–24, 2026 — Architecture Planning

### What was done
- Designed v0.2 architecture — 9 tools, full feature list, what agent will and won't do
- Wrote complete system design document: `docs/system-design.md`
- Core decisions: tool-use over text-dumping, human-in-the-loop for writes, DB access as the differentiator
- Key realization: the v0.1 approach (search → dump text → ask Claude) is a dead end for complex tasks. Claude needs to control the loop to be truly useful.

---

## April 22, 2026 

### What was done today
- Got project : build a Claude-powered AI agent that acts as a tech team member for TIQ World
- Set up GitHub repository: https://github.com/Shalin-mish/tiqworld-ai-agent
- Created initial project structure
- Built v0.1 foundation: basic CLI, core tool functions, initial prompts

### Why Claude?
The assignment specified Claude. It's also genuinely well-suited for code review — it understands context, reasons about intent, and gives structured output. Not just pattern matching.

### First scope decision
Kept v0.1 to three use cases: file review, codebase Q&A, health check. Left out CI/CD integration, auto-fix, PR hooks — those are for after v0.1 is proven. Three things done well beats seven things half-done.

---
