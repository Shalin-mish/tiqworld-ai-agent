# TIQ World AI Agent — System Design & Documentation

**Version:** 2.0 (Planned)
**Date:** April 2026
**Author:** Shalini Mishra
**Purpose:** Prototype AI agent powered by Claude that acts as a tech team member — maintaining, reviewing, and improving the TIQ World codebase autonomously.

---

## 1. What Is This?

A **Claude-powered AI agent** that behaves like a senior software engineer on the TIQ World team.

Instead of a human developer manually reviewing code, writing docs, checking git history, or querying the database — this agent does it automatically when asked, or on its own schedule.

**Lead Requirement (exact):**
> "Create a prototype AI agent, powered by Claude, that can help maintain and improve our codebase and act like it is part of our tech team."

---

## 2. The Problem It Solves

Right now, TIQ World's tech team has to manually:

| Manual Task Today | Time Cost | Agent Will Handle It |
|---|---|---|
| Review every PR for bugs | 30-60 min per PR | Automatic on every commit |
| Answer "how does X work?" | 10-20 min per question | Instant codebase Q&A |
| Write/update documentation | Hours | Auto-generated |
| Check git for risky changes | Manual grep/search | Daily automated report |
| Find security vulnerabilities | Periodic manual audit | Every review, every time |
| Write test cases | Developer time | Auto-suggested per function |
| Query DB for intern stats | Developer writes SQL | Natural language → SQL |

**The agent eliminates most of this toil.**

---

## 3. High-Level Architecture

```
┌─────────────────────────────────────────────────────┐
│                   USER / DEVELOPER                   │
│         (CLI terminal or future web interface)       │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│              ORCHESTRATOR (agent.py)                 │
│                                                      │
│  Receives task → decides which tools Claude needs    │
│  → calls Claude API with tool use → returns result  │
└──────┬───────────┬──────────┬───────────┬───────────┘
       │           │          │           │
       ▼           ▼          ▼           ▼
  ┌─────────┐ ┌────────┐ ┌────────┐ ┌─────────┐
  │  File   │ │  Git   │ │  DB    │ │ GitHub  │
  │  Tools  │ │ Tools  │ │ Tools  │ │  Tools  │
  └─────────┘ └────────┘ └────────┘ └─────────┘
  read_file   git_log    db_query   get_pr
  list_files  git_diff   db_schema  post_review
  search      git_blame             create_issue
```

**The key difference from v0.1:**
Claude does NOT just receive dumped text. Claude is given **tools** and decides itself:
- "I need to read this file first"
- "Let me check the git diff"
- "Let me search for all uses of this function"

This is called **tool use / function calling** — Claude acts like a developer using a terminal.

---

## 4. What the Agent Can Do — Full Feature List

### 4.1 Code Review (`--review`)
**What happens:**
1. User gives a file path
2. Claude reads the file using `read_file` tool
3. Claude analyzes it and reports:
   - **Critical:** bugs, crashes, security holes
   - **Warnings:** bad practices, performance issues
   - **Suggestions:** readability, maintainability

**Example:**
```bash
python agent.py --review server.js
```
**Output:**
```
CRITICAL: SQL query on line 42 is not parameterized — SQL injection risk
WARNING:  No input validation on /api/interns POST route
SUGGESTION: Function registerIntern() is 120 lines — split into smaller functions
```

---

### 4.2 Codebase Q&A (`--ask`)
**What happens:**
1. User asks a natural language question
2. Claude uses `search_codebase` tool to find relevant files
3. Claude reads those files with `read_file`
4. Claude answers with full context

**Example:**
```bash
python agent.py --ask "How does authentication work in this project?"
```
**Output:**
```
Authentication uses JWT tokens. Here's the flow:
1. POST /api/auth/login (routes/auth.js:23) — validates credentials
2. bcryptjs compares password hash (models/User.js:45)
3. JWT token returned, expires in 7 days (config/settings.py:12)
4. Middleware verifies token on protected routes (middleware/auth.js:8)
```

---

### 4.3 Git Intelligence (`--git-summary`)
**What happens:**
1. Agent reads recent git commits using `git_log` tool
2. Reads diffs for flagged commits using `git_diff` tool
3. Claude analyzes and reports risky changes

**Example:**
```bash
python agent.py --git-summary --days 7
```
**Output:**
```
Last 7 days: 23 commits by 4 authors

RISKY CHANGES DETECTED:
- commit a3f92b1 (April 21): Modified auth middleware — security-sensitive file
- commit 9d2c441 (April 20): Deleted validation.js — was it used elsewhere?

SUMMARY:
Most active: routes/interns.js (8 changes)
New files: TrainingPlan.js, trainingPlans.js
Deleted: none
```

---

### 4.4 Health Check (`--health-check`)
**What happens:**
1. Agent scans entire codebase directory
2. Lists all files, languages, structure
3. Claude analyzes and reports structural problems

**Example:**
```bash
python agent.py --health-check ./tiq-intern-mern
```
**Output:**
```
FILES: 47 source files | JS: 31, Python: 8, CSS: 8

STRUCTURAL CONCERNS:
- No /tests directory found — zero test coverage
- README.md exists but has no API documentation
- .env.example missing from tiq-intern-system

MISSING STANDARD FILES:
- .eslintrc (no linting config)
- .prettierrc (no formatting config)
- /docs folder empty

RECOMMENDATIONS:
1. Add Jest tests for routes/auth.js (highest risk file)
2. Add input validation to all POST endpoints
3. Split server.js (currently 340 lines) into route modules
```

---

### 4.5 Documentation Generator (`--generate-docs`)
**What happens:**
1. Agent reads a file or whole directory
2. Claude writes proper documentation for every function/class
3. Optionally writes a full README

**Example:**
```bash
python agent.py --generate-docs routes/auth.js
```
**Output:** Full JSDoc comments for every function, written directly into the file or as a separate doc.

---

### 4.6 Database Query (`--db-ask`) *(TIQ World specific)*
**What happens:**
1. User asks a natural language question about TIQ World data
2. Agent uses `db_schema` tool to get the database schema
3. Claude writes the SQL query
4. Agent runs it via `db_query` tool
5. Result returned in readable format

**Example:**
```bash
python agent.py --db-ask "How many interns submitted daily progress today?"
```
**Output:**
```
SQL Generated:
  SELECT COUNT(*) FROM daily_progress WHERE DATE(created_at) = CURRENT_DATE;

Result: 14 interns submitted progress today out of 31 active interns.
Missing submissions: 17 interns have not logged progress today.
```

---

### 4.7 Interactive Chat Mode (default)
**What happens:**
When no flags given, agent enters a loop — developer can have a full conversation:

```bash
python agent.py
```
```
TIQ World AI Agent — Your tech team member.
Type 'exit' to quit.

You: Why is the login failing for new interns?
Agent: Let me check the auth flow...
[reads routes/auth.js, models/User.js, middleware/auth.js]
Most likely cause: new interns have role='intern' but the JWT middleware
on line 34 checks role === 'Intern' (capital I). Case mismatch.
Fix: Change line 34 to: req.user.role.toLowerCase() === 'intern'

You: Can you write a test for the login route?
Agent: [writes complete Jest test for the login endpoint]
```

---

## 5. How Claude Tool Use Works (Technical)

### v0.1 (current — dumb approach)
```
User asks question
  → Agent does keyword search in files
  → Dumps all matching text into prompt
  → Claude reads it and answers
```
Problem: Claude gets irrelevant text, misses important files, can't go deeper.

### v0.2 (planned — tool use)
```
User asks question
  → Claude receives the question + list of available tools
  → Claude decides: "I need to call search_codebase('authentication')"
  → Agent runs that tool, returns results to Claude
  → Claude decides: "Now I need read_file('routes/auth.js')"
  → Agent runs that, returns file content
  → Claude decides: "I have enough — here's my answer"
  → Final answer returned to user
```

Claude is in control of what it reads. This is like a developer who has access to a terminal and decides what commands to run.

---

## 6. Tools Claude Will Have Access To

```python
tools = [
    {
        "name": "read_file",
        "description": "Read the contents of a file in the codebase",
        "input": { "filepath": "string" }
    },
    {
        "name": "list_files",
        "description": "List all source files in a directory",
        "input": { "directory": "string" }
    },
    {
        "name": "search_codebase",
        "description": "Search all files for a keyword or phrase",
        "input": { "query": "string", "directory": "string" }
    },
    {
        "name": "git_log",
        "description": "Get recent git commits",
        "input": { "days": "number", "max_commits": "number" }
    },
    {
        "name": "git_diff",
        "description": "Get the diff for a specific commit",
        "input": { "commit_hash": "string" }
    },
    {
        "name": "git_blame",
        "description": "See who wrote each line of a file",
        "input": { "filepath": "string" }
    },
    {
        "name": "db_query",
        "description": "Run a read-only SQL query on TIQ World database",
        "input": { "sql": "string" }
    },
    {
        "name": "db_schema",
        "description": "Get the database schema (tables and columns)",
        "input": {}
    },
    {
        "name": "write_file",
        "description": "Write content to a file (for docs generation only)",
        "input": { "filepath": "string", "content": "string" }
    }
]
```

---

## 7. Example: Full Agent Loop (Tool Use Flow)

**User asks:** `"Is there any security issue in the authentication code?"`

**What happens internally:**

```
Step 1: Claude receives question + available tools

Step 2: Claude calls → search_codebase("authentication")
        Agent returns → [auth.js, middleware/auth.js, User.js, Login.js]

Step 3: Claude calls → read_file("routes/auth.js")
        Agent returns → [full file content]

Step 4: Claude calls → read_file("middleware/auth.js")
        Agent returns → [full file content]

Step 5: Claude calls → read_file("models/User.js")
        Agent returns → [full file content]

Step 6: Claude analyzes all 3 files together

Step 7: Claude returns final answer:
        "CRITICAL: JWT secret is hardcoded on line 12 of auth.js
         ('secret123' should be process.env.JWT_SECRET)
         
         WARNING: No rate limiting on /api/auth/login — 
         brute force attack possible
         
         WARNING: Password reset token has no expiry time set"
```

---

## 8. Project File Structure (v0.2 Plan)

```
tiqworld-ai-agent/
│
├── agent/
│   ├── agent.py          ← Main orchestrator, runs tool-use loop
│   ├── tools.py          ← All tool functions (file, git, db)
│   ├── prompts.py        ← All system/user prompts
│   └── __init__.py
│
├── config/
│   └── settings.py       ← API keys, model name, excluded dirs
│
├── docs/
│   ├── devlog.md         ← Daily progress log
│   └── system-design.md  ← This file
│
├── tests/
│   └── test_tools.py     ← Unit tests for tool functions
│
├── requirements.txt      ← anthropic, rich, gitpython
├── .env.example          ← ANTHROPIC_API_KEY=your_key_here
├── .gitignore
└── README.md
```

---

## 9. What This Agent Does NOT Do (Intentional Limits)

| Out of Scope (v0.2) | Why |
|---|---|
| Auto-push code to production | Too risky without human review |
| Delete files automatically | Destructive — needs human approval |
| Merge PRs without review | Human must always approve merges |
| Write new features from scratch | Agent assists, not replaces developer judgment |
| Access external systems beyond DB/GitHub | Security boundary |

**Rule:** Agent can **read everything**, **suggest anything**, but only **write** to docs files. All code changes are suggestions — human applies them.

---

## 10. Technology Stack

| Component | Technology | Why |
|---|---|---|
| AI Model | Claude (claude-sonnet-4-6) | Best for code reasoning, tool use |
| Language | Python 3.11+ | Best SDK support, clean tooling |
| AI SDK | `anthropic` Python SDK | Official, supports tool use |
| Terminal UI | `rich` | Clean formatted output |
| Git Access | `gitpython` | Read commits, diffs, blame |
| Database | PostgreSQL via `psycopg2` | TIQ World dev DB (SSM tunnel) |
| CLI | `argparse` | Standard Python CLI |

---

## 11. How to Run (Once Built)

```bash
# Setup
pip install -r requirements.txt
export ANTHROPIC_API_KEY=your_key_here

# Review a file
python agent/agent.py --review routes/auth.js

# Ask a question  
python agent/agent.py --ask "Where is user password validated?"

# Git summary of last 7 days
python agent/agent.py --git-summary --days 7

# Health check
python agent/agent.py --health-check .

# Ask about database
python agent/agent.py --db-ask "Which interns completed all courses?"

# Interactive chat
python agent/agent.py
```

---

## 12. Why This Qualifies as "Part of the Tech Team"

A tech team member does these things. So does this agent:

| Team Member Behavior | Agent Equivalent |
|---|---|
| Reviews code before merge | `--review` on any file |
| Knows the whole codebase | Tool use across all files |
| Remembers past decisions | Git history + devlog |
| Answers questions instantly | `--ask` with codebase context |
| Flags security problems | Every review checks security |
| Writes documentation | `--generate-docs` |
| Checks database for data | `--db-ask` natural language |
| Reports what changed this week | `--git-summary` |
| Never takes a day off | Runs any time, any file |

---

## 13. Next Steps After This Prototype

Once lead approves v0.2 prototype:

1. **GitHub Actions hook** — auto-review every PR automatically
2. **Scheduled reports** — nightly codebase health email
3. **Web interface** — instead of CLI, a simple chat UI
4. **Multi-agent** — separate specialized agents for each task
5. **Memory** — remember past conversations and decisions

---

*This document will be updated as each phase is built.*
*For daily progress, see: `docs/devlog.md`*
