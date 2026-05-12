# TIQ World AI Agent — Daily Work Log
**Intern:** Shalini Mishra
**Project:** Claude-powered AI Agent for TIQ World codebase
**Lead:** Manu (TIQ)
**Period:** April 22 – ongoing

---
> NOTE: This document is meant to be hand-typed into your Google Doc.
> Copy the content day by day and write it in your own words.
> The entries below capture what was done — add your own voice and any extra
> context you remember when typing it into the doc.
---

## April 22, 2026 — Day 1

**What I did:**
Got the project assignment from the lead: build a Claude-powered AI agent that can act as a tech team member for TIQ World. The agent should be able to review code, answer questions about the codebase, and help maintain code quality.

Set up the GitHub repository (https://github.com/Shalin-mish/tiqworld-ai-agent) and built the first working version — v0.1. This version has three modes:
- `--review` a file: Claude reads the file and gives structured feedback (Critical / Warning / Suggestion)
- `--ask` a question: searches the codebase for relevant files, then answers
- `--health-check` a directory: gives a structural overview of the codebase
- Default: interactive chat mode

**Decisions I made:**

*Why Python?*
Python has the best tooling for this kind of project — the official Anthropic SDK, gitpython for git integration, and rich for clean terminal output. It also matches the kind of scripting the team likely does.

*Why start with v0.1 without tool use?*
Claude has a "tool use" feature where it can call functions itself rather than just receiving dumped text. That would have been cleaner architecturally, but it adds significant complexity. For v0.1 I want something working I can test. v0.2 will refactor to proper tool use. Better to validate the idea first.

*Why only three features in v0.1?*
I deliberately cut scope. Three things done well is better than seven things half-done. The most immediately useful features are review (saves time on PRs), Q&A (helps new team members understand the codebase), and health check (big picture view). Everything else is v0.2+.

**What I'm doing next:**
Design the full architecture for v0.2 — what tools Claude should have, how the tool-use loop should work, and what TIQ World-specific features make sense (especially database access).

---

## April 23, 2026 — Day 2

**What I did:**
Spent the day designing the full v0.2 architecture before building anything. I wrote the complete system design document (`docs/system-design.md`). This was important to do first because once you start building you commit to an architecture — I wanted to think it through properly before writing code.

The core insight: v0.1 is basically a wrapper. It searches for keywords, dumps text into a prompt, and hopes Claude says something useful. v0.2 needs to give Claude actual tools so it can decide for itself what to read, in what order, and how deep to go. This is what makes the difference between a simple script and an actual agent.

**9 tools I defined for v0.2:**
- `read_file` — read any file in the codebase
- `list_files` — see all files in a directory
- `search_codebase` — search for a keyword across all files
- `git_log` — get recent commits
- `git_diff` — see what changed in a specific commit
- `git_blame` — see who wrote which line
- `db_query` — run a read-only SQL query on TIQ World's database
- `db_schema` — get the database structure
- `write_file` — write to a file (docs only, with human approval)

**Key decision — Human-in-the-loop:**
I made a deliberate choice that the agent can read everything and suggest anything, but can only write to documentation files. All code changes are suggestions that a human applies. This is the right call for a prototype — you build trust with the tool before giving it more autonomy.

**Why DB access is the differentiator:**
Generic AI coding tools (like Devin, GitHub Copilot) don't know anything about TIQ World's data. This agent can be asked "which interns haven't submitted progress today?" and actually answer it. No other tool in the market can do that for our specific context.

**What I'm doing next:**
Start building the tools — first file tools, then git tools, then DB tools.

---

## April 24, 2026 — Day 3

**What I did:**
Built the full agent.py orchestration layer. This is the main file — it handles the CLI, routes commands to the right functions, and manages the conversation with Claude.

Used argparse for the CLI because it gives you `--help` output automatically and makes each mode independently testable. Considered a simpler single `--mode` flag approach but the current API (separate flags per mode) is more natural to use.

Used the `rich` library for terminal output — it renders markdown, adds color, and wraps output in nice panels. This matters because the reviews Claude writes are in markdown format, and without rendering they look cluttered.

**Interactive mode design:**
The default mode (no flags) drops into a loop where you can have a conversation. I made this dead simple — just a while loop with `console.input()`. No complex state, no session history in v0.1. Claude answers each question fresh. Session memory is a v0.2 feature.

**What I left out:**
No tests yet — I want to validate the structure is right before writing tests for it. No error handling beyond basic file-not-found checks. No retry logic on API calls. All of that is cleanup, not core functionality.

---

## April 25 — Day 4

**What I did:**
Built `tools.py` — all the file interaction functions that the agent needs.

The most interesting one to think through was `search_codebase()`. I had a choice: simple string search, or regex. I went with simple string search for v0.1. Most real queries ("where is JWT validated?", "which file has the auth route?") are literal strings, not patterns. If someone needs regex they can ask for it as a feature, but adding it now would be premature.

I also made a deliberate choice: `write_file` is NOT in tools.py yet. The system design says writes need a human approval gate, and that gate isn't built. If I add write now, someone (me) will accidentally call it without the gate and modify a file unintentionally. Keeping it out until the gate is ready is the safer call.

One thing I noticed: `search_codebase` returns at most 5 matching lines per file. This might not be enough for complex queries. Made a note to make this configurable in v0.2.

---

## April 28 — Day 7

**What I did:**
Built `prompts.py` — extracted all prompt templates out of agent.py into a separate file.

This is one of those things that feels like cleanup but is actually important architecture. Prompts change a lot during development — you tweak the wording, add context, restructure the output format. If prompts are buried inside function calls in agent.py, every change is a risk of breaking something. Centralizing them in prompts.py means you can update a prompt without touching the orchestration logic.

The four prompts I wrote:
1. `SYSTEM_PROMPT` — tells Claude it's a senior engineer on the TIQ team, explains how to structure feedback
2. `REVIEW_PROMPT` — organizes review output as Critical / Warning / Suggestion with line references
3. `QUESTION_PROMPT` — injects codebase search results as context, tells Claude to only reference what it was given
4. `HEALTH_CHECK_PROMPT` — gets a structural analysis of the codebase

**On prompt quality:**
The REVIEW_PROMPT structure matters. If you just say "review this code," Claude gives you a flat list of issues. If you say "organize by Critical/Warning/Suggestion," the output is immediately actionable — a team member reading a review can triage it properly. The structure of the prompt determines the structure of the output.

---

## April 29 — Day 8

**What I did:**
Built `config/settings.py` to centralize all configuration. Before this, the model name (`claude-sonnet-4-6`) and max tokens were hardcoded in agent.py. That's a maintenance problem — when the model name changes (and it will), you'd have to find every place it's hardcoded.

The important config items:
- `MODEL` — model name, reads from environment first, then default
- `EXCLUDE_DIRS` — directories to skip when scanning: node_modules, __pycache__, .venv, dist, build
- `MAX_FILE_SIZE` — skip files over 100KB (avoids trying to read huge generated files)

**Security note:**
API key is environment variable only — `os.environ.get("ANTHROPIC_API_KEY")`. Never hardcoded. If no key is set, the agent exits with a clear error message. This is basic credential hygiene but worth noting.

---

## April 30 — Day 9

**What I did:**
End-to-end testing pass on all three CLI modes. Found and fixed two bugs:

Bug 1: `get_file_summary()` was including .git internal files in the count. A "codebase with 4,000 files" is useless if 3,800 of them are .git objects. Fixed by applying EXCLUDE_DIRS filter in list_files.

Bug 2: Interactive mode was crashing on empty input (user presses Enter). Added `if not user_input: continue` before sending to Claude. Simple fix but important — a crash on empty input is not acceptable UX.

Also added `.env.example` with placeholder API key so anyone cloning the repo knows what to set.

---

## May 1 — Day 10

**What I did:**
First real Week 1 work — ran the agent against the actual TIQ World codebase at `C:\Users\Shalini Mishra\TIQ`.

Discovered: import paths in agent.py were broken when running from outside the `agent/` directory. `from prompts import ...` works if you're inside the agent folder, but fails from the project root. Fixed by adding `sys.path.insert(0, os.path.dirname(__file__))` at the top of agent.py. This tells Python to look in the same directory as the script, regardless of where you launched it from.

Small fix but this is the kind of thing that stops people from using a tool. If `python agent/agent.py` fails because of a path issue, you've lost them.

---

## May 2 — Day 11

**What I did:**
Full test run against the TIQ codebase. Results:

`--ask "How does authentication work?"` — gave a reasonable answer. Found auth.js correctly. Answer was accurate for the most part.

`--health-check` — correctly identified the file structure, language breakdown. Flagged no tests directory.

`--review` on the main server file — found some legitimate issues.

**Issues I found:**

Issue 1: The codebase path has to be passed every time. Should be a config option. Made a note to add `TIQ_CODEBASE_PATH` to settings.py.

Issue 2: When search returns many results, Claude gets a wall of text. No prioritization — a file with 20 keyword matches gets the same weight as a file with 1 deep match. Need better relevance ranking in v0.2.

Issue 3: Claude sometimes referenced code that wasn't in the files it was given. Hallucination. Fixed by adding an explicit instruction to QUESTION_PROMPT: "Only reference code from the context provided. Do not invent or assume code that was not shown to you."

---

## May 5 — Day 14

**What I did:**
Updated SYSTEM_PROMPT to include TIQ World-specific codebase structure. Before this, Claude's reviews were generic ("add input validation," "use environment variables for secrets") — technically correct but not specific to our project.

After adding context about the MERN stack, module structure, and key file locations, the reviews became more useful — referencing actual route names and module patterns.

This is a core insight: a language model is only as useful as the context you give it. Generic context → generic output. TIQ-specific context → TIQ-specific output. Investing in the system prompt pays dividends on every single API call.

---

## May 6 — Day 15

**What I did:**
Research day on prompt caching. The Anthropic docs describe `cache_control: ephemeral` — if you mark a message block with this flag, the API caches that block's tokens server-side. Subsequent calls with the same cached content get a ~90% token cost reduction on that block.

The system prompt is the obvious target — it's static, gets sent on every call, and will only grow as I add more TIQ-specific context.

**Why I'm not adding it yet:**
In v0.1, each mode is a single API call. Caching helps most in multi-turn conversations where the same content is sent repeatedly. That's the v0.2 tool-use loop — Claude calls a tool, I send the result back, Claude calls another tool, etc. Each round trip resends the system prompt. That's where caching saves real money. I'll add it when I build the proper tool-use loop.

---

## May 8 — Day 17 (Start of Week 2)

**What I did:**
Week 1 retrospective. What was supposed to happen vs. what happened:

Completed: CLI working ✓, read tools working ✓, basic Q&A working ✓
Partially done: system prompt with TIQ context (done), prompt caching (researched, not implemented — intentional)
Not done: structured tool response format (file path, line count, language metadata)

Week 2 goals: show_diff, approval gate, git_backup, run_command

**Key architectural note:**
The current agent.py is NOT a real tool-use agent. It calls Python functions directly and passes results as text context to Claude. Real tool use means Claude gets a list of tools, Claude decides which to call, Claude returns a `tool_use` block, the agent runs the function, and sends back a `tool_result`. The current approach works for v0.1 but it's a dead end for more complex behavior. Week 2 needs to refactor this.

---

## May 9 — Day 18

**What I did:**
Deep read of Anthropic's tool use documentation. Understood the full message flow:

1. You send Claude a `tools` array describing what's available
2. Claude responds with `stop_reason: "tool_use"` and a `tool_use` content block naming the function and its arguments
3. You run the function locally and send back a `tool_result` message
4. Claude continues — might call another tool, or finish with a final answer

This is fundamentally different from v0.1 where I call Python functions myself and pass results as context. In real tool use, Claude is in control of the loop. It decides what to read and when to stop.

Wrote notes on the refactor needed. The `ask_claude()` function in agent.py currently does one call and returns. For tool use it needs to be a loop: call Claude → if tool_use, execute tool and loop → if end_turn, return answer.

---

## May 10 — Day 19

**What I did:**
Designed the approval gate mechanism for the write_file flow. The gate needs to:

1. Show the user what file will be written
2. Show a diff of what will change (new content vs. current content if file exists)
3. Ask for yes/no confirmation
4. Only write if user says yes

**Architecture decision:**
The gate logic lives in agent.py, not in tools.py. tools.py functions should be pure — they take inputs, return outputs, no side effects, no I/O except reading files. If I put the gate inside write_file(), the tool has user-facing behavior baked in, which makes it harder to test and impossible to use programmatically.

The orchestrator (agent.py) owns the decision loop, so it owns the gate.

**Options I considered:**
- Put gate in write_file() directly — rejected, violates tool purity
- Separate confirm() helper function — possible but overkill for a yes/no
- Inline in agent.py loop — cleanest, went with this

---

## May 11 — Day 20

**What I did:**
Documentation day. Updated the devlog to cover all work from April 22 to today, committed all the v0.1 code that had been built but never committed, and pushed to GitHub.

The lack of daily commits was a problem. Code was being built but there was no commit trail. Today's commit (`5c6f12c`) covers 20 days of work — that's not how it should work going forward.

**Going forward:**
Every day I work, I commit and push. Every day I commit, I update this Google Doc on the same day. The two records should match. If there's a commit without a doc entry, or a doc entry without a commit, something is missing.

**Current project state:**
- v0.1: Complete (CLI, review, Q&A, health check, tools, prompts, config)
- v0.2 in progress: tool-use loop designed but not coded, approval gate designed but not integrated, git tools and DB tools not started
- Week 2 priority: implement real tool-use loop in agent.py

---
