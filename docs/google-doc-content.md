# TIQ World AI Agent — Daily Work Log
**Intern:** Shalini Mishra
**Project:** Claude-powered AI Agent for TIQ World codebase



## April 22 

Got the project  — build a Claude-powered AI agent that
acts as a tech team member for TIQ World. It should be able to review code,
answer questions about the codebase, and help maintain quality.

Set up the GitHub repo and built the first working version (v0.1) with four modes:
- --review: Claude reads a file and gives structured feedback
- --ask: searches codebase for context, then answers questions
- --health-check: gives structural overview of a directory
- Default: interactive chat mode

**Why Python?**
Best ecosystem for this kind of tooling — official Anthropic SDK,
rich library for terminal output, gitpython for git integration later.

**Why only three features in v0.1?**
I deliberately cut scope. If I try to build everything at once I'll end up
with seven half-done features. Better to do three things well and prove the
concept before expanding.

**Why not use Claude's tool-calling feature in v0.1?**
Tool use is the right architecture but adds significant complexity. For v0.1
I want something working that I can test and show. I'll refactor to proper
tool use in v0.2. Validate the idea first, then optimize the architecture.

---

## April 23–24 — Architecture Planning

Spent these days designing the full v0.2 architecture before writing more code.
This was important — once you start building you commit to an architecture, so
I wanted to think it through first.

Wrote the complete system design document (docs/system-design.md). Defined 9
tools Claude will have access to: read_file, list_files, search_codebase,
git_log, git_diff, git_blame, db_query, db_schema, write_file.

**The core architectural insight:**
v0.1 dumps text into a prompt and hopes Claude says something useful. v0.2
gives Claude actual tools so it can decide what to read, in what order, and
how deep to go. The difference is who controls the loop — in v0.1 my code
does, in v0.2 Claude does. That's what makes it an agent vs. a wrapper.

**Why database access is the differentiator:**
Generic AI tools (Copilot, Devin etc.) don't know anything about TIQ World's
data. This agent can answer "which interns haven't logged progress today?" No
off-the-shelf tool can do that for our specific context.

**Human-in-the-loop decision:**
Agent can read everything, suggest anything, but only writes to docs files.
All code changes are suggestions — a human applies them. This is deliberate.
Build trust with the tool before giving it more autonomy.

---

## April 25–30 — Research Phase

These days were research and learning before the main coding sprint started.

Went deep into Anthropic documentation — tool use / function calling, system
prompt design, message structure, token limits, prompt caching. The goal was
to understand exactly how to implement the tool-use loop properly in v0.2.

Researched gitpython — how to read git log, diffs, blame programmatically.
This is needed for the git tools (git_log, git_diff, git_blame) in v0.2.

Researched psycopg2 for PostgreSQL — understanding how to run read-only
queries safely against TIQ's dev database through the SSM tunnel.

Also thought through what the agent should NOT do, which is as important as
what it should:
- No auto-push to GitHub
- No delete operations without human confirmation
- No merging PRs
- Write access only to docs, not source code

Reason: trust is built incrementally. A new team member doesn't get
production deploy access on day one. Same logic applies here — start with
read-only, prove it's useful, then expand.

---

## May 1 — (Coding starts)

First real coding day. Built the three core files:

**agent.py** — the main CLI and orchestrator. Used argparse because it gives
you --help output automatically and makes each mode independently testable.
Used rich library so Claude's markdown output renders properly in the terminal
instead of showing raw symbols.

**tools.py** — file interaction functions: read_file, list_files,
get_file_summary, search_codebase. Search uses simple string matching — not
regex. Most real queries are literal strings. Adding regex now would be
premature, can always add it if needed.

Deliberately did NOT add write_file yet. The system design requires a human
approval gate before any write. Gate isn't built. If write is available
without the gate, I'll accidentally modify a file. Keep it out until the
gate is ready.

**prompts.py** — separated all prompt templates from agent.py. Prompts
change a lot during development. If they're buried in function calls,
every change risks breaking something else. Centralizing them means I can
update a prompt without touching the orchestration logic.

The REVIEW_PROMPT structure (Critical / Warning / Suggestion) was
deliberate — unstructured review output is hard to act on. Severity tiers
make it immediately clear what needs to be fixed first.

---

## May 2 

Built config/settings.py and finalized requirements.txt.

Model name and API settings were hardcoded in agent.py — bad practice. If
the model name changes (and it will), I'd have to find every hardcoded
reference. One settings file, one place to update.

Key config items:
- EXCLUDE_DIRS: skip node_modules, __pycache__, .venv, dist, build — without
  this the agent scans thousands of irrelevant files
- MAX_FILE_SIZE = 100KB: skip huge generated or minified files that would
  overflow the context window
- API key: environment variable only, never in code. Agent exits with clear
  error if key is not set.

Fixed a bug: get_file_summary() was counting .git internal objects as source
files, making the health check show thousands of files instead of actual
source file count.

---

## May 5 

First test against the actual TIQ World codebase.

Results were mostly good — auth Q&A worked, health check correctly flagged
no tests directory, code review found real issues.

But I found three problems:

**Problem 1 — Import paths:**
`from prompts import ...` breaks when running from outside the agent/
directory. Fixed: added `sys.path.insert(0, os.path.dirname(__file__))` at
top of agent.py so it always finds sibling modules regardless of where it's
launched from. Small fix but a broken import is a tool nobody uses.

**Problem 2 — Hallucination:**
Claude was referencing code that wasn't in the files it was given — it was
"filling in" what it thought should be there based on training. Fixed: added
explicit instruction to QUESTION_PROMPT — "Only reference code from the
context provided. Do not invent or assume code not shown to you."

**Problem 3 — Search overload:**
When a keyword appears in many files, Claude gets too much unstructured text
with no prioritization. A file with 20 keyword matches gets the same weight
as one with a deep, relevant match. This needs proper relevance ranking.
Noted for v0.2.

---

## May 6 

Updated SYSTEM_PROMPT to include TIQ World-specific codebase context.

Before: Claude gave generic output — "add input validation", "use environment
variables for secrets." Technically correct, completely useless for us.

After adding TIQ's stack info (MERN, specific modules, route patterns):
Claude references actual route names and module patterns. The reviews became
actually useful instead of textbook advice.

What I learned: a language model is only as useful as the context you give
it. Generic context → generic output. TIQ-specific context → TIQ-specific
output. Every token you put into a good system prompt pays off on every
single API call after that.

---

## May 7 

End-of-week cleanup and review.

Reviewed tools.py — found: search_codebase returns at most 5 matching lines
per file. Fine for short functions, not enough for complex matches in long
files. Made a note to make this configurable.

Also thought through the tool response format. Right now tools return raw
content — read_file gives back a raw file string. The v0.2 plan calls for
structured context: { file_path, line_count, language, content }. This
makes it easier for Claude to reference exact file locations in its answers.
Will add this in the tool-use refactor.

---

## May 8 

Week 1 retrospective and Week 2 planning.

What got done in Week 1:
- CLI working ✓
- read tools working ✓  
- Q&A working ✓
- System prompt with TIQ context ✓
- Prompt caching — researched but intentionally deferred

Why defer caching: caching helps most in multi-turn conversations where the
same content is sent repeatedly. That's the v0.2 tool-use loop — each tool
call round-trip resends the system prompt. Caching in a single-call v0.1
setup saves almost nothing. I'll add it when building the actual loop.

Week 2 goals: show_diff, approval gate for write_file, git tools, run_command.

Also designed the approval gate:
Agent proposes file change → show diff (new vs current) → user confirms
yes/no → only then write happens.

Gate lives in agent.py, not write_file(). Tools should be pure — no side
effects, no user-facing I/O. Orchestrator owns the confirmation loop.

---

## May 9 

Research day on Anthropic's tool use documentation.

Understood the exact message flow for real tool use:
1. Send Claude a `tools` array describing available functions
2. Claude responds with stop_reason: "tool_use" and names which function to call
3. I run that function locally, send back the result as tool_result
4. Claude either calls another tool or returns the final answer

Current agent.py is NOT doing this. It calls Python functions itself and
passes the results as text context. This is v0.1's shortcut. The real
difference: in proper tool use, Claude is in control of the loop. It decides
what to read, what to search, when it has enough information to answer.

Wrote detailed notes on the refactor. ask_claude() needs to become a loop
instead of a single API call. The loop: call Claude → if stop_reason is
tool_use, execute tool and loop again → if end_turn, return the answer.

---

## May 9 — ## May10   (Leave)


## May11

Documentation day.

Updated the devlog to cover every working day since April 22. Committed all
the v0.1 code that had been built but never pushed to GitHub — everything
from May 1 onwards was only local. That's not how it should work.

Pushed the first real substantive commit: the full v0.1 implementation
including agent.py, tools.py, prompts.py, config/settings.py, the full
system design doc, and the complete devlog.


Current state:
- v0.1: Complete
- v0.2: Designed (system-design.md), coding not yet started
- This week (Week 2): implement the real tool-use loop

---
