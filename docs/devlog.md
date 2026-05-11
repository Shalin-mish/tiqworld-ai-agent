# TIQ World AI Agent — Dev Log

*Daily progress log for the TIQ World AI Agent internship project.*
*Lead: Manu (TIQ) | Intern: Shalini Mishra | Started: April 22, 2026*

---

## May 11, 2026 — Day 20

### What was done today
- Caught up on documentation — updated devlog for all days since April 22
- Reviewed full project state: what's been built vs. what was planned for Week 2
- Assessed which Week 2 features are partially designed vs. not started:
  - show_diff: designed, not yet coded
  - Approval gate: logic defined, not integrated into agent.py
  - git_backup: planned, not implemented
  - run_command: on list, not started
- Updated project notes and created full backlog of what remains this week (May 8-14)

### Decisions made
The fact that Week 2 items haven't been built yet is a signal to tighten the daily commit discipline. Features being mentally designed but not committed means no verifiable progress trail. Going forward: each day, at minimum one commit — even if it's just a doc update or a stub.

### What's next
- Start coding show_diff in tools.py
- Wire approval gate into agent.py's interactive mode
- Commit everything that's been written but not committed

---

## May 10, 2026 — Day 19

### What was done today
- Planned the approval gate mechanism for Week 2
- Designed the user confirmation flow for write_file: agent proposes a change → show_diff runs → user types yes/no → only then write happens
- Thought through edge cases: what if file doesn't exist yet? what if user says no mid-session?
- Wrote rough pseudocode for the gate in a scratch file (not yet integrated)

### Key Decision
The approval gate has to be in agent.py, not in tools.py. tools.py should be pure functions with no side effects or user-facing I/O. agent.py is the orchestrator — it owns the decision loop, so it owns the gate.

### Options I considered
- Option A: Put gate logic inside write_file() itself → rejected because tools should be stateless
- Option B: Separate confirm() helper → overkill for a simple yes/no
- Option C: Inline in agent.py loop → cleanest, went with this

---

## May 9, 2026 — Day 18

### What was done today
- Deep-read the Anthropic docs on tool_use message structure to understand how to build the real tool-use loop
- Current agent.py (v0.1) doesn't use actual tool calling — it just calls Python functions directly and passes results as context
- The real tool-use loop works like: Claude gets tools list → Claude returns tool_use block → agent executes tool → sends tool_result back → Claude continues
- Wrote notes on how to refactor agent.py to implement this properly

### What I realized
The v0.1 agent is more of a "search-then-prompt" wrapper, not a true tool-use agent. The system design doc (April 23) already described the right architecture — it just hasn't been built yet. This is fine for a prototype but the Week 2 work needs to move toward real tool use.

### What's next
- Write the actual tool-use loop in agent.py
- Start with: question → search_codebase tool call → read_file tool call → answer

---

## May 8, 2026 — Day 17 (Week 2 Start)

### What was done today
- Week 1 retrospective — went through what was actually completed vs. planned
- Week 1 goals: CLI working ✓, read tools working ✓, basic Q&A working ✓
- Partially done: system prompt improvements (started, not finalized), prompt caching (researched, not implemented)
- Planned Week 2 work: show_diff, approval gate, git_backup, run_command
- Set up Week 2 in devlog with concrete goals for each item

### Decision
Keeping v0.1 as a stable baseline and building v0.2 features on a separate branch would be cleaner. But since this is solo work and not production code, a single branch is fine — just commit before adding new features so the v0.1 state is preserved in git.

---

## May 7, 2026 — Day 16

### What was done today
- End-of-Week 1 review and cleanup
- Went through agent.py and tools.py for any obvious issues before Week 2 changes
- One thing I noticed: `search_codebase()` in tools.py only returns 5 matching lines per file (`matching_lines[:5]`). This might cut off important context if a search hits a long function. Made a note to raise this limit or make it configurable.
- Tested the health check on the TIQ World codebase directory — works correctly, lists languages and file breakdown

### Notes on tool response format (from Week 1 plan)
Current format returns raw content — e.g., read_file just returns the full file text. The v0.2 plan says to return structured context: `{ file_path, line_count, language, content }`. This makes it easier for Claude to reference exact locations. Planning to add this in Week 2.

---

## May 6, 2026 — Day 15

### What was done today
- Investigated prompt caching — reading Anthropic docs on `cache_control: ephemeral`
- The system prompt (SYSTEM_PROMPT in prompts.py) is static — same every call. This is the ideal target for caching.
- If I set `cache_control: ephemeral` on the system prompt block, subsequent calls with the same system prompt hit the cache and cost ~10% of normal tokens
- Ran the agent against the TIQ codebase — multiple Q&A queries per session, each starting a fresh API call with the full system prompt. Caching would save tokens quickly.

### Decision
Prompt caching should be added in the tool-use refactor (v0.2 agent loop), not bolted onto v0.1. In v0.1 the whole thing is a single `client.messages.create()` call — caching there is technically possible but less impactful than in the multi-turn tool-use loop where the system prompt is sent repeatedly.

---

## May 5, 2026 — Day 14

### What was done today
- Updated system prompt to include TIQ World-specific codebase structure
- Added details about MERN stack, folder layout, and key modules so Claude's reviews are context-aware
- Before this change: Claude gave generic code review feedback ("add input validation", "use environment variables for secrets")
- After this change: Claude references TIQ World's actual module names and routes
- Tested `--review` on a sample file — quality of output noticeably improved

### What I changed in prompts.py
Added a TIQ World codebase map to the SYSTEM_PROMPT so Claude knows the project structure upfront instead of discovering it only when tools are called.

---

## May 4, 2026 — Day 13 (Sunday)

Rest day.

---

## May 3, 2026 — Day 12 (Saturday)

Rest day.

---

## May 2, 2026 — Day 11

### What was done today
- First full-day test of the v0.1 agent against the actual TIQ World codebase at `C:\Users\Shalini Mishra\TIQ`
- Ran `--ask "How does authentication work?"` → gave a reasonable answer, referenced auth.js correctly
- Ran `--health-check` → found the right file structure, correctly flagged no tests directory
- Ran `--review` on the main server file → found some good issues

### Issues discovered
1. The agent doesn't know WHERE the TIQ codebase is — you have to pass the path every time. Should be in config/settings.py
2. When `search_codebase` returns many results, Claude gets a wall of text. No prioritization.
3. The `--ask` output sometimes quotes code that isn't actually in the file (Claude hallucinating)

### Decision
Issue 3 (hallucination) is partly a prompt problem — I need to tell Claude to only reference what it was explicitly given as context, not what it thinks might be there. Added a constraint to QUESTION_PROMPT: "only reference code from the provided context."

---

## May 1, 2026 — Day 10 (Week 1 Start)

### What was done today
- Officially starting "Week 1" per the project plan
- Goal: get CLI fully working, tested against real codebase, and cleaned up
- Did a full read-through of agent.py and tools.py to understand the state after April builds
- Identified: import paths are broken when running from outside the `agent/` folder
- Fixed: `from prompts import ...` fails if you're not in the agent directory → need to either use relative imports or adjust sys.path

### Fix applied
Added `sys.path.insert(0, os.path.dirname(__file__))` at the top of agent.py so it can find its sibling modules regardless of where it's invoked from.

### What's next
- Test against actual TIQ codebase tomorrow
- Finalize system prompt with TIQ-specific context

---

## April 30, 2026 — Day 9

### What was done today
- End-to-end testing of all three CLI modes: `--review`, `--ask`, `--health-check`
- Set up `.env.example` template so anyone cloning the repo knows which keys to set
- Reviewed `requirements.txt` — confirmed anthropic, rich, gitpython are all that's needed for v0.1
- Cleaned up `config/settings.py` — added EXCLUDE_DIRS and MAX_FILE_SIZE limits so the agent doesn't try to read node_modules or huge binary files

### Bugs fixed
- `get_file_summary()` was counting every file including `.git` internals → fixed by using EXCLUDE_DIRS filter
- Interactive mode was crashing on empty input (user presses Enter with nothing) → fixed with `if not user_input: continue`

---

## April 29, 2026 — Day 8

### What was done today
- Built `config/settings.py` — centralized all config: API key, model name, max tokens, excluded dirs
- Before this, API key and model name were hardcoded in agent.py → bad practice, easy to accidentally commit secrets
- Added EXCLUDE_DIRS set to skip `node_modules`, `__pycache__`, `.venv`, `dist`, `build` in file searches
- Finalized `requirements.txt` with version constraints

### Decision
Settings should always be environment variable first, then config file — never hardcoded. This is especially important because model names change (we're on claude-sonnet-4-6 right now but this could change next month).

---

## April 28, 2026 — Day 7

### What was done today
- Built `prompts.py` — separated all prompt templates from agent.py
- Before this, prompts were inline strings in agent.py → hard to update and reason about
- Wrote four prompts:
  1. `SYSTEM_PROMPT` — who Claude is and how it should behave (senior engineer on TIQ team)
  2. `REVIEW_PROMPT` — template for file review, organized by Critical/Warning/Suggestion
  3. `QUESTION_PROMPT` — Q&A with context injection
  4. `HEALTH_CHECK_PROMPT` — codebase structure analysis

### Why structured prompts matter
Prompt quality directly determines output quality. If the system prompt is vague, reviews are vague. If the review prompt doesn't specify severity levels, Claude gives an unordered list that's harder to act on. The Critical/Warning/Suggestion structure makes output immediately actionable.

---

## April 27, 2026 — Day 6 (Sunday)

Rest day.

---

## April 26, 2026 — Day 5 (Saturday)

Rest day.

---

## April 25, 2026 — Day 4

### What was done today
- Built `tools.py` — all file interaction functions
- `read_file()`: simple file reader, handles encoding errors gracefully
- `list_files()`: walks directory tree, filters by SUPPORTED_EXTENSIONS
- `get_file_summary()`: returns file count, language breakdown, full file list — used by health check
- `search_codebase()`: searches all files for a query string, returns matching lines with line numbers

### Decision on search approach
For v0.1, simple string matching is enough. I considered using regex (more powerful) but it adds complexity and most codebase queries are literal string searches anyway ("where is jwt validated?", "which file has the auth route?"). Will add regex support in v0.2 if needed.

### What I left out on purpose
I did NOT add write_file to tools.py yet. The system design says write should only happen with human approval. Since the approval gate isn't built yet, adding write would be unsafe — easy to accidentally modify a file. Keeping it out until the gate is ready.

---

## April 24, 2026 — Day 3

### What was done today
- Built the core of `agent.py` — the main CLI and orchestration layer
- Implemented four modes using `argparse`:
  - `--review FILE` → reads file, sends to Claude for structured review
  - `--ask QUESTION` → searches codebase for context, then answers
  - `--health-check DIR` → summarizes codebase structure, runs health analysis
  - Default (no flags) → interactive chat mode
- Used `rich` library for formatted terminal output — panels, markdown rendering, color-coded results
- Interactive mode uses a simple `while True` loop with `console.input()`

### Why argparse over a simple script
The agent needs to be usable without reading documentation. `python agent.py --help` should tell you everything. argparse gives you that for free. Also makes each mode independently testable.

### Tradeoff considered
I could make this a single `--mode` flag instead of four separate flags. But that's less ergonomic — `python agent.py --review file.py` is cleaner than `python agent.py --mode review --input file.py`. The current API is more natural.

---

## April 23, 2026 — Day 2

### What was done today
- Designed complete v0.2 system architecture
- Wrote full system design documentation (`docs/system-design.md`)
- Defined all 9 tools Claude will have access to (file, git, database tools)
- Documented every feature with exact examples and expected output
- Clarified what agent will NOT do (no auto-push, no delete, no merge without human)

### Key Design Decisions

**Tool use is the core upgrade**
v0.1 dumps text blindly. v0.2 gives Claude tools — it decides what to read, in what order, how deep to go. This is what makes it actually intelligent vs just a wrapper.

**DB access is TIQ World's unique advantage**
Generic tools like Devin have no idea about our interns, courses, or progress data. This agent can answer "which interns haven't logged progress today?" — no other tool can do that.

**Human-in-the-loop by design**
Agent reads everything, suggests anything, but only writes to docs. All code changes are suggestions. This is the right call for a prototype — build trust first, expand autonomy later.

**9 tools defined for v0.2:**
`read_file`, `list_files`, `search_codebase`, `git_log`, `git_diff`, `git_blame`, `db_query`, `db_schema`, `write_file`

### What's next
- Build v0.2: implement tool use loop in agent.py
- Add git tools using gitpython
- Add DB tools using psycopg2 (SSM tunnel to postgres-tiqworld-dev)
- Fix import paths (relative imports in agent package)
- Wire config/settings.py into agent.py (currently duplicated)
- Add EXCLUDE_DIRS to list_files so node_modules is skipped

---

## April 22, 2026 — Day 1

### What was done today
- Received assignment from lead: build a Claude-powered AI agent that acts as a tech team member for TIQ World
- Set up GitHub repository: https://github.com/Shalin-mish/tiqworld-ai-agent
- Created initial project structure with core files
- Built v0.1 of the agent with three main capabilities:
  - `--review <file>` — reviews a code file for bugs, warnings, and suggestions
  - `--ask <question>` — answers questions about the codebase with context search
  - `--health-check <dir>` — runs a structural health check on a directory
  - Interactive chat mode (default when no flags given)

### Decisions made

**Why Claude?**
The assignment specifically asked for a Claude-powered agent. Claude is also well-suited for code review tasks — it understands context, can reason about intent, and gives structured, actionable feedback.

**Why Python?**
Python has the best ecosystem for this kind of tooling — `anthropic` SDK, `gitpython` for git integration, `rich` for clean terminal output. It's also the most likely language the team works in.

**Scope decision for v0.1**
I kept it focused on three core use cases rather than building too many features at once:
1. File review (most immediately useful)
2. Q&A about codebase (reduces friction for new team members)
3. Health check (big picture view)

I deliberately left out: CI/CD integration, auto-fix suggestions, PR review hooks — those are v0.2+ features. Better to do 3 things well than 10 things poorly.

**Why not use function/tool calling for v0.1?**
Tool use (Claude's function calling) would be cleaner for the search-then-answer flow, but adds complexity. For v0.1, a simple search-then-pass-as-context approach works fine and is easier to debug. Will refactor to tool use in v0.2.

### What's next
- Wait for sample codebase from Raghavan
- Test the agent against real code
- Add tool use (function calling) for more dynamic codebase interaction
- Add git integration: summarize recent commits, flag risky changes

---
