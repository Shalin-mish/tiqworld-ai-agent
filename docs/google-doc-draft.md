# TIQ World AI Agent — Project Documentation
### Google Doc — Full Engineering Record
**Author:** Shalini Mishra
**Period:** April 22, 2026 – June 8, 2026
**Repository:** github.com/Shalin-mish/tiqworld-ai-agent

---

# Table of Contents

1. [Project Overview](#1-project-overview)
2. [Why This Project Exists](#2-why-this-project-exists)
3. [Architecture Decisions — The Thinking Behind Every Major Choice](#3-architecture-decisions)
4. [What Was Built — Week by Week](#4-what-was-built-week-by-week)
5. [The 27 Tools — What They Do and Why](#5-the-27-tools)
6. [Safety Model — How the Agent Is Prevented from Causing Harm](#6-safety-model)
7. [The Maintenance Scheduler — Autonomous Operation](#7-the-maintenance-scheduler)
8. [Full Audit — Every Bug Found and Fixed](#8-full-audit)
9. [Timing Analysis — Proving the Schedule Is Safe](#9-timing-analysis)
10. [Architectural Hardening — June 8 Session](#10-architectural-hardening)
11. [Test Coverage](#11-test-coverage)
12. [Configuration Reference](#12-configuration-reference)
13. [What the Agent Cannot Do — Hard Limits](#13-what-the-agent-cannot-do)
14. [Deployment Checklist](#14-deployment-checklist)
15. [Options Considered and Rejected](#15-options-considered-and-rejected)

---

# 1. Project Overview

The TIQ World AI Agent is a **Claude-powered autonomous software engineering assistant** running on AWS Bedrock. It functions as a senior developer on the TIQ World team — reading code, answering questions, running maintenance scans, detecting bugs, and proposing fixes — all without requiring a developer to be manually present.

**What it is not:** a chatbot, a copilot, or a code completion tool.

**What it is:** a tool-use agent that navigates the codebase autonomously, makes decisions about what to read and what to change, and operates on a schedule while respecting hard safety boundaries.

### Core capabilities
- Answers questions about any part of the codebase with file + line number citations
- Runs nightly deep scans: lint errors, TODO/FIXME tracking, dead code, secret detection, dependency audit
- Auto-fixes safe issues (lint, null checks, unused variables) with confidence ≥ 80%
- Monitors platform health via HTTP probes, log anomaly scan, and process vitals
- Posts automated code reviews on GitHub PRs
- Maintains a full audit trail of every action, every approval, every write

### Numbers at a glance
| Metric | Value |
|--------|-------|
| Tools | 27 |
| Unit tests | 158 (all passing) |
| E2E tests | 28 (all passing) |
| Safety layers | 5 independent |
| Maintenance schedule | 2am IST nightly |
| Auto-fix confidence threshold | 80% |
| Maximum maintenance run | 2 hours (hard abort) |

---

# 2. Why This Project Exists

### The problem

TIQ World's codebase is large and growing. Maintenance tasks — checking for lint errors, tracking TODOs, monitoring for secrets committed by accident, verifying dependencies are up to date — take developer time that could be spent building features. These tasks are also done inconsistently: sometimes a developer remembers to check, sometimes they don't.

### The goal

Build an agent that performs routine maintenance automatically, gives developers an interactive way to understand any part of the codebase instantly, and acts as a first-pass code reviewer on every PR — all without requiring developer attention unless something actually needs a human decision.

### The principle

**Human approval on every write. Full autonomy on reads.** The agent can read anything, analyse anything, and report anything without restriction. Writes — changes to files — always go through a human approval gate (or a PR review in production mode). Autonomy is earned incrementally as trust is established.

---

# 3. Architecture Decisions — The Thinking Behind Every Major Choice

This section explains the key decisions made during the project, why they were made, what alternatives were considered, and what trade-offs were accepted.

---

## Decision 1: Tool-use agent, not a chatbot

**What this means:** Claude receives a `tools` array. When it needs information, it calls a tool. The agent executes the function and sends back the result. Claude continues — calling more tools or returning an answer. This loop continues until Claude has enough information.

**Why:** In a chatbot (v0.1 approach), the code decides what to read and passes it to Claude. Claude makes one call and responds. Claude has no agency over what it reads. In a tool-use agent, Claude decides what to read based on the question being asked. This is the difference between a wrapper and an agent.

**Alternative considered:** Pass all relevant code as context in a single prompt. Rejected: the codebase is too large to pass entirely, and selecting which files to include requires understanding the question — which only Claude can do well.

**Trade-off accepted:** More round trips to Bedrock per question (each tool call is a separate API call). Acceptable — each call is fast, and the answers are dramatically more accurate.

---

## Decision 2: AWS Bedrock instead of the Anthropic API directly

**What this means:** API calls go through AWS Bedrock (`BedrockRuntimeClient`) instead of `api.anthropic.com`.

**Why:** TIQ's infrastructure runs entirely on AWS. Bedrock keeps API traffic within the AWS network — lower latency, no data leaving the cloud provider, and the same IAM credentials model used across TIQ's entire infrastructure. An EC2 instance can use its instance profile — no separate API key to manage or rotate.

**Alternative considered:** Direct Anthropic API. Simpler setup, same model. Rejected: adds a non-AWS credential to manage, data leaves the cloud provider boundary, and TIQ has AWS infrastructure already in place.

**Trade-off accepted:** Bedrock adds an AWS dependency. Running the agent outside AWS requires manual credentials setup. Acceptable for an internal tool.

---

## Decision 3: Prompt caching ON by default

**What this means:** The system prompt is marked `cachePoint: { type: 'default' }` in the Bedrock request. Bedrock caches the system prompt and charges ~10% of normal input tokens for cache hits.

**Why:** In the multi-turn tool-use loop, the full system prompt is sent on every round trip to Bedrock. A 2,000-token system prompt sent across 8 tool calls = 16,000 input tokens just for the system prompt per conversation. With caching, subsequent calls in the same conversation cost approximately 200 tokens for that block — ~90% reduction.

**Why the default was wrong initially:** `ENABLE_PROMPT_CACHE` was set to `false` in `.env.example`. This was found during the June 8 audit and fixed. The correct default is `true`.

**Alternative considered:** Compress the system prompt. Rejected: prompt caching achieves the same saving without reducing the quality of the system context Claude receives.

---

## Decision 4: SSE (Server-Sent Events) instead of WebSockets

**What this means:** The chat endpoint is `GET /api/chat` returning a `text/event-stream` response. The server streams events to the browser; the browser sends new queries via new HTTP requests.

**Why:** Streaming AI responses are unidirectional — server pushes to client. SSE is exactly designed for this. WebSockets are bidirectional, which adds protocol complexity for no benefit here. SSE works over standard HTTP, requires no protocol upgrade, is supported in all modern browsers, and reconnects automatically.

**Alternative considered:** WebSockets. Rejected: bidirectional protocol for a unidirectional use case. Adds a `ws://` connection and upgrade handshake for no benefit.

**Trade-off accepted:** A new HTTP request per user message instead of a single persistent connection. Acceptable — each request opens an SSE stream for its duration.

---

## Decision 5: No build step for the frontend

**What this means:** The entire web UI is a single `src/web/index.html` file. No Vite, no webpack, no npm build. The server serves it as a static file.

**Why:** This is a developer tool for one team. A build pipeline adds setup steps, build artifacts, source maps, and deployment friction — none of which benefit a tool that runs on one server accessed by a handful of developers. A single HTML file is instantly deployable, immediately inspectable, and works on any machine with Node.

**Alternative considered:** React + Vite. Rejected: adds build step, `node_modules` for the frontend, and CI complexity with zero user-facing benefit for this use case.

**Trade-off accepted:** No component isolation, no TypeScript, no hot module replacement. Acceptable for a developer tool at this scale.

---

## Decision 6: Semi-autonomous maintenance — two modes, not one

**What this means:** Night maintenance (2am) has write access and can auto-fix issues. Day scan (9am) is read-only — health check and health monitor only.

**Why:** Writes during working hours should go through the human approval gate — a developer is present to review. Autonomous writes at 2am are appropriate because (a) no developer is present to approve anyway, (b) the git backup + test + rollback chain means any mistake is automatically undone, and (c) the confidence threshold (80%) means only high-confidence fixes are attempted.

The original day scan ran every 2 hours and included lint + TODOs. That was changed to once/day at 9am with only health checks. Lint and TODOs are already checked nightly — running them 12 times a day burned tokens for zero additional value.

**Alternative considered:** Full autonomy always. Rejected: writes during working hours without human review creates accountability gaps.

**Alternative considered:** Human approval required for everything. Rejected: defeats the purpose of a maintenance agent.

---

## Decision 7: Exact-match command allowlist, not a blacklist

**What this means:** `run_command` maintains a list of exactly which commands are allowed. Everything not on the list is blocked.

**Why:** A blacklist of dangerous commands is always incomplete. New dangerous commands will always exist that weren't anticipated. A whitelist is complete by definition — if a command isn't on the list, it cannot run. This is the only approach that is secure by default.

**The bug that validated this decision:** The original implementation used `startsWith('npm run test')`. This would pass `npm run test:staging` or a chained command like `npm run test && npm run deploy`. The exact-match allowlist closes this gap entirely.

---

## Decision 8: Self-protection at the tool level, not just the prompt level

**What this means:** `write_file` and `branch_write` check the target file path against `SELF_PROTECT_PATTERNS` before doing anything. This check happens in the JavaScript code of the tool itself, not in the prompt sent to Claude.

**Why:** Prompt-level instructions can be overridden by sufficiently clever prompt construction. A determined user or a hallucinating model could craft a message that bypasses "please don't modify your own source code" stated as a prompt instruction. A code-level check cannot be bypassed by any prompt. The protection is unconditional.

**The risk this prevents:** Without self-protection, a crafted prompt could instruct the agent to modify `src/tools/writeFile.js` — effectively removing the approval gate. Once an agent can rewrite its own safety rules, every other protection becomes meaningless.

---

## Decision 9: Safety patterns in one file (`src/safetyPatterns.js`)

**What this means:** `SELF_PROTECT_PATTERNS` and `HIGH_RISK_PATTERNS` are defined once in `src/safetyPatterns.js` and imported by the three files that need them.

**Why:** These patterns were previously duplicated in `writeFile.js`, `branchWrite.js`, and `scheduler.js`. By June 8 they had already drifted — `branchWrite.js` was missing `server.js` and `router.js` from its protected list. This meant a file write via `branch_write` had weaker protection than via `write_file`. Consolidation prevents drift.

**The principle:** any critical safety constant that must be consistent across the system belongs in exactly one place.

---

## Decision 10: PM2 fork mode only (`instances: 1`)

**What this means:** The PM2 config now explicitly sets `instances: 1` and `exec_mode: 'fork'`.

**Why:** Two in-memory data structures depend on there being exactly one process:
1. `fileLock` — the file lock Map. Each PM2 worker has its own copy. Two workers could both acquire a lock on the same file simultaneously.
2. `activeSseSessions` Set — used to prevent GC of sessions with live SSE connections. Two workers would each track only their own connections.

Cluster mode would silently break both. The explicit config prevents this from happening accidentally.

---

## Decision 11: `AGENT_BRANCH_WRITES` flag for production use

**What this means:** When `AGENT_BRANCH_WRITES=true`, the agent uses `branch_write` instead of `write_file`. Every change goes to a `agent/fix-*` feature branch. A human merges via PR.

**Why this matters:** `write_file` modifies the working tree directly. In a production environment shared by multiple developers, direct tree modifications can conflict with in-progress work. `branch_write` means every agent-proposed change lives on its own branch — reviewed, not merged until a human approves the PR.

**Why it was broken before:** The flag was mentioned in a comment in `branchWrite.js` but nothing in the codebase read it. The config didn't have it, the agent didn't use it, and the system prompt never mentioned it. The June 8 session wired it end-to-end.

---

# 4. What Was Built — Week by Week

## April 22–30, 2026 — Research and foundation

**What:** Spent two days on architecture planning before writing any production code. Defined the tool-use architecture, the human-in-the-loop write model, and the 9 tools for v0.2.

**Key decision made:** DB access (`db_query`) is the core differentiator. Generic AI coding tools have no knowledge of TIQ World's actual data. This agent can answer questions no off-the-shelf tool can answer.

**First code:** Python v0.1 with three read-only tools (`read_file`, `list_files`, `search_codebase`) and CLI modes (review, ask, health-check). Python chosen for fastest path to something testable. Migrated to Node.js in Week 2 to match TIQ's stack.

---

## May 1–12, 2026 — Core agent architecture

**What:** Rebuilt from Python script into a real Node.js tool-use agent.

**The fundamental change:** v0.1 called functions, passed results as text, made one API call. v0.2 sends Claude a `tools` array, Claude decides which functions to call, the agent executes them, Claude continues. This is what makes it an agent rather than a wrapper.

**Tools added:**
- `write_file` with approval gate and git backup (May 11)
- `run_command` with exact allowlist (May 11)
- `show_diff` with context-aware output (May 12)
- Auto-context loader — reads file imports automatically (May 11, extended to depth 2 on May 13)

**AWS Bedrock migration** (May 12) — replaced Anthropic SDK with `BedrockRuntimeClient`.

**Structured tool responses** (May 7) — all tools return typed objects with metadata, not raw strings. This enables Claude to say "line 47 of `src/middleware/auth.js`" instead of "somewhere in auth.js."

**Prompt caching** (May 7) — system prompt marked `cache_control: ephemeral`. ~90% token reduction on cached portion in multi-turn loops.

---

## May 13–22, 2026 — Analysis tools and UI

**Tools added:** `trace_error`, `map_dependencies`, `explain_route` (Week 3), then `git_log`, `health_check`, `lint_file`, `db_query`, `find_todos`, `check_env_usage`, `summarize_diff`, `detect_dead_code`, `schema_to_api`, `recall_session` (Week 4).

**The rapid expansion was possible because:** shared filesystem utilities (`getAllFiles`, `toRel`, `readSafe`) were extracted into `src/utils/fs.js`. Each new tool reuses the same traversal logic.

**Dispatcher built** (May 17): routes queries to task types (query / review / maintenance / feature) and restricts tool access per type. Without scoping, Claude could call `write_file` when asked a simple question.

**Web UI launched** (May 20): Express + SSE + single HTML file. No build step.

**`fix_error` meta-tool** (May 22): chains multiple tools together — error input → trace files → root cause → confidence score → proposed fix. One call instead of manually coordinating multiple tools.

**UI redesigned** with 3-column layout, TIQ brand palette (dark orange `#E85D26` + teal `#0D9488`), real-time tool call chips.

---

## May 21, 2026 — GitHub OAuth + audit trail + approval gates

**GitHub OAuth:** Passport.js + `passport-github2`. Every write and approval attributed to a verified GitHub username.

**Audit trail:** `logs/activity.jsonl` — append-only JSONL. Every event logged. JSONL chosen because it is appendable without rewriting, grep-able, and compatible with standard log tools.

**Write archive:** Before/after content saved for every accepted `write_file` call. The activity log records that a write happened; the archive records exactly what changed.

**Approval gate flow:** `approval_needed` SSE event → browser shows diff modal → user clicks Approve/Deny → `/api/approve` resolves the async Promise → agent continues or stops. The Promise-based approach is key: the agent's tool loop pauses and waits without polling, resuming exactly when the human makes a decision.

---

## May 23, 2026 — Semi-autonomous maintenance scheduler

**What:** `src/scheduler.js` with cron-driven automation.

**Night cycle (2am):** `fullScan()` → run tests → if passing: auto-fix issues with confidence ≥ threshold → run tests again → rollback on failure → save report → notify.

**Day cycle (every 2h at the time):** health check only, no writes.

**Why pre-fix test baseline:** If tests are already failing before the agent touches anything, auto-fixing could mask the original failure or add new breakage on top of existing breakage. Skipping auto-fix when tests are pre-failing is the safe choice.

---

## May 26–28, 2026 — Production safety hardening

**3 critical fixes:**

1. **Self-protection** — agent can never modify its own source or DB migrations. Without this, the agent could be prompted to disable its own safety gates.

2. **Confidence threshold 55% → 80%** — at 55%, nearly 1 in 2 auto-fixes could be wrong. 80% means only high-confidence changes proceed autonomously.

3. **Command allowlist: prefix-match → exact Set** — `startsWith('npm run test')` would pass `npm run deploy`. Exact Set closes this.

**2 new tools:**

`health_monitor` — HTTP probes + log anomaly scan + Node process vitals. Runs every day cycle. Three signal layers because each covers a different failure mode: a dead server fails the HTTP probe; runtime errors appear in logs; memory leaks show in process vitals.

`credential_guard` — 13 detection rules covering AWS keys, PEM keys, hardcoded passwords, DB connection strings, JWT secrets. Runs as a gate on every `write_file` call — the agent cannot accidentally commit secrets.

**UI overhaul:** bilateral panel toggles, drag-to-resize sidebars, localStorage persistence.

---

## May 29, 2026 — v1.0.0: All documented gaps closed

**`branch_write` tool:** Instead of writing to the working tree directly, creates a `agent/fix-<slug>-<timestamp>` branch, commits there, returns the branch name. A human opens a PR and merges. This is the correct workflow for production — no agent change ever lands on main without human review.

**Session persistence:** Sessions saved to `logs/sessions/{id}.json` after every response. Server restarts no longer wipe conversation history. 24h TTL.

**48 new tests** — scheduler, sessionPersistence, branchWrite. Total: 151 passing.

**Version bump 0.9.0 → 1.0.0** — all documented gaps resolved.

---

## June 1–2, 2026 — UI polish, documentation, any-codebase support

**Right panel collapsed by default.** The admin panel starts at width 0 — user expands when needed. Follows the VS Code pattern for secondary panels.

**Any-codebase design** (`src/projectDiscovery.js`): agent now works on any project without code changes. Detects language (Node.js/TS, Python, Go, Rust, Java, Ruby, PHP), framework, monorepo layout, test commands, README. System prompt built dynamically from discovery result.

**Maintenance timeout abort** via `AbortController`: the timeout now actually kills the running `runAgent()` call by linking the signal into every Bedrock API call. Previously, the timeout set a flag but didn't stop the in-flight call.

**Day scan simplified** to once/day at 9am, health checks only. Lint/TODOs every 2 hours was burning tokens for zero additional value.

---

## June 8, 2026 — Full audit, all bugs fixed, architectural hardening

Full codebase review as a senior developer + Q&A team. 20 issues identified and fixed across four severity levels. See Section 8 for the complete list.

---

# 5. The 27 Tools

## Exploration (4)

| Tool | Purpose | Why it exists |
|------|---------|---------------|
| `list_files` | Directory tree by glob | Codebase map — first step before reading anything |
| `read_file` | File contents + auto-loads imports (depth 2) | Most questions span multiple files; auto-loading imports saves round trips |
| `search_code` | Regex/text search across entire codebase | Find all uses of a function, class, or pattern |
| `recall_session` | This session's files read + tool calls + writes | Prevents re-reading files already in context |

## Analysis (14)

| Tool | Purpose | Why it exists |
|------|---------|---------------|
| `health_check` | Quick snapshot — file counts, TODOs, git status, env gaps | One call for a complete current state |
| `full_scan` | All maintenance checks in parallel | The "what's wrong?" entry point; runs 6 checks at once |
| `trace_error` | Paste a stack trace → reads every file in it | Automates the most common manual debugging step |
| `fix_error` | Error → root cause → confidence score → proposed fix | Meta-tool that chains the full debugging pipeline |
| `map_dependencies` | Import graph: outgoing and incoming | Forward = blast radius; reverse = impact of change |
| `explain_route` | Route → middleware → controller → service | Compresses 20-minute manual trace into one call |
| `find_todos` | TODO/FIXME/BUG/HACK scan with severity | Tracks maintenance debt systematically |
| `check_env_usage` | `.env.example` vs `process.env.*` calls | Catches undocumented env vars and documented-but-unused ones |
| `detect_dead_code` | Files with zero importers | Safe starting point for cleanup |
| `schema_to_api` | Model → CRUD completeness check | Are GET/POST/PUT/DELETE all implemented? |
| `summarize_diff` | Git diff (staged/unstaged/branch) | Code review starting point |
| `git_log` | Commit history, filterable by file/date | "When was this last changed and by whom?" |
| `lint_file` | ESLint structured results | File:line:rule — actionable, not just "there are errors" |
| `db_query` | Read-only SQL via SSM tunnel | The core differentiator — answers questions about real data |

## Security + Dependencies (3)

| Tool | Purpose | Why it exists |
|------|---------|---------------|
| `secret_scanner` | Scan for leaked credentials | AWS keys, JWT secrets, passwords in source are a critical risk |
| `dep_updater` | npm outdated by risk tier | Distinguishes safe patch updates from breaking major updates |
| `credential_guard` | Gate every write for hardcoded secrets | Prevents agent from accidentally writing a file containing credentials |

## Monitoring (1)

| Tool | Purpose | Why it exists |
|------|---------|---------------|
| `health_monitor` | HTTP probes + log scan + process vitals | Three signal layers cover dead server, runtime errors, and memory leaks |

## Write + Verify (5)

| Tool | Purpose | Why it exists |
|------|---------|---------------|
| `git_backup` | Create/restore checkpoint branch | Rollback point before every write — safety net |
| `show_diff` | Preview change before applying | Review before write — same principle as PR review |
| `write_file` | Write with human approval gate (dev/staging) | Direct writes with explicit human sign-off |
| `branch_write` | Write to feature branch (production-safe) | Every agent change goes through PR review in production |
| `run_command` | Execute from exact allowlist only | Verify the fix worked — tests must pass after every write |

---

# 6. Safety Model

The agent has **5 independent safety layers**. Bypassing one does not bypass the others. They cover different threat surfaces.

## Layer 1 — Self-protection (code-level, unconditional)

Every call to `write_file` or `branch_write` checks the target path against `SELF_PROTECT_PATTERNS` from `src/safetyPatterns.js` before doing anything else. If the path matches, the write is blocked and logged immediately — no approval prompt, no override.

**Protected paths include:**
- All agent source files: `src/tools/`, `src/agent.js`, `src/scheduler.js`, `src/config.js`, `src/web/server.js`, `src/web/router.js`
- PM2 config: `ecosystem.config`
- Database migrations: `migrations/`, `migration.*`, `schema.prisma`, `prisma/schema`, `seeds/`, `seeders/`

**Why code-level, not prompt-level:** A prompt instruction can be overridden by a crafted input. A code-level check cannot be bypassed by any prompt.

## Layer 2 — Credential guard (content scan, before every write)

Before writing any file, `credentialGuard` scans the proposed content for 13 credential patterns:
- AWS Access Key ID (`AKIA...` format)
- PEM / SSH private keys
- Hardcoded passwords in assignments
- Database connection strings with embedded credentials
- JWT secret literals
- GCP service account JSON
- Azure storage keys
- Slack/Discord webhook URLs
- Generic `api_key = "..."` patterns

HIGH severity → write blocked entirely. MEDIUM severity → warning logged, write proceeds.

Smart exclusions: `process.env.X` is not blocked (that's correct usage). Comment lines are not blocked. Test mock values are not blocked.

## Layer 3 — High-risk pattern gate (scheduler autonomous mode only)

When the maintenance scheduler is running automatic fixes, a second pattern check runs against `HIGH_RISK_PATTERNS` (a superset of self-protect). This covers routes, models, middleware, config files, auth modules, payment logic, and test files.

The key addition here is **test files**: the agent cannot modify its own test suite. This is the "judge and criminal" problem — an agent that can both make changes and modify the tests that judge those changes is unreliable. Test files are human-written; the CI pipeline (GitHub Actions) is the independent external judge.

## Layer 4 — Human approval gate (write_file)

Every `write_file` call pauses and waits for explicit human approval:
- **Web UI:** An `approval_needed` SSE event fires, a diff modal appears, user clicks Approve or Deny
- **CLI:** readline prompt — "Apply this change? (yes/no)"
- **Auto-reject after 5 minutes** if no response

The 5-minute timeout prevents a hung approval from blocking the agent indefinitely.

## Layer 5 — External Claude Code hooks (settings.json, outside the agent process)

These hooks run at the Claude Code session level, before any tool call. They cannot be bypassed by the agent:

| Hook | Blocks |
|------|--------|
| Bash push guard | `git push origin main/master/production` |
| Bash destructive guard | `git reset --hard`, `git push --force` |
| PostgreSQL MCP query guard | UPDATE, DELETE, INSERT, DROP, TRUNCATE, ALTER |
| GitHub MCP push guard | Direct push to main/master/production |
| GitHub MCP commit guard | Direct commit to main/master/production |

**Why both the code-level gates AND the hooks?** The code-level gates protect the target codebase. The hooks protect the agent's own repository and the development workflow. Different threat surfaces require independent guards.

## The `AGENT_BRANCH_WRITES` mode

When `AGENT_BRANCH_WRITES=true`, every agent write goes to a `agent/fix-<slug>-<timestamp>` feature branch instead of the working tree. This bypasses the approval modal (no one is watching at 2am) but adds mandatory PR review — no change lands on main without human sign-off. Recommended for production deployments.

---

# 7. The Maintenance Scheduler

## Schedule

| Time | Task | Why |
|------|------|-----|
| 2:00 AM IST | Night deep maintenance | Nobody is working; can run long without blocking developers |
| 9:00 AM IST | Day light scan | Health check at start of workday — is the platform up? |
| Monday 9:00 AM IST | Weekly Slack report | Summary of last 7 days for the team |

## Night maintenance flow

```
1.  fullScan() — 6 checks run in parallel
     lint errors + critical TODOs + env gaps + dead code + secret scan + dep audit

2.  runTests() — pre-fix baseline
     Command: always 'npm run test:unit' (not auto-detected)
     Timeout: 120 seconds
     If FAILING: skip all auto-fix, report "pre-existing failures", exit
     WHY: fixing code on top of already-broken tests compounds the problem

3.  For each issue where confidence ≥ 80%:
     a. git_backup  — checkpoint branch created
     b. show_diff   — diff computed and stored in progress log
     c. write_file  — file written (auto-approved in maintenance mode)
     d. run_command — 'npm run test:unit' must pass after every single write
     e. If tests fail: git_backup restore → stop fixing → report

4.  Final test run — post-fix verification

5.  saveMaintenanceReport() → logs/maintenance-{ISO}.json

6.  notify() → Slack/Discord webhook + in-app notification
```

## Hard 2-hour abort (AbortController chain)

The maintenance run has a hard 2-hour ceiling. The abort chain:

```
setTimeout(2h) fires
  → controller.abort()                ← AbortController created per run
       → onOuterAbort listener        ← linked into every Bedrock call
            → Bedrock call throws AbortError
                 → runAgent() throws "Maintenance run aborted by timeout"
                      → scheduler catches → marks done → releases all file locks
```

Without this, a Bedrock call that hangs (slow model, network issue) would hold the maintenance lock indefinitely — blocking the next night's run.

## Why test commands are hardcoded, not auto-detected

`projectDiscovery` scans the target codebase to detect the test command. For the agent's own repository, it detected `pytest` — because `tiq_workplace` (the target codebase, not the agent) has Python files. That caused `runTests()` to call `pytest` which failed, then fall back to `npm test` which runs e2e tests that require a live browser — guaranteed to fail in a headless 2am maintenance run.

The fix: `runTests()` hardcodes `'npm run test:unit'`. Project discovery is for the target codebase; the agent's own test runner should not be subject to discovery.

## Timing safety — all relationships verified

| Relationship | Status |
|-------------|--------|
| Night ends by 4am, day starts at 9am → 5h gap | ✓ Safe |
| `runTests()` capped at 120s × 3 calls = 6 min max | ✓ Safe |
| `runCommand` via agent: 300s × 20 budget = 100 min | ✓ Within 2h ceiling |
| `fileLock` TTL 10 min < maintenance 120 min | ✓ No lock outlasts timeout |
| Bedrock per-call: 180s × 3 retries + backoff ≈ 554s worst case | ✓ One per turn only |
| `activeSseSessions` prevents GC of live connections | ✓ Active |
| Approval auto-reject: 5 min | ✓ Bounded |
| `_maintenanceRunning` flag blocks day scan overlap | ✓ Active |

---

# 8. Full Audit — Every Bug Found and Fixed

A full senior-developer quality review was conducted on June 8, 2026. All 20 issues were fixed in the same session.

## Critical Issues (4)

### C1 — Night maintenance failing every night since May 28

**Root cause:** `projectDiscovery` detected `testCmd = 'pytest'` (wrong). Fallback `'npm test'` runs e2e tests that require a live browser — fails in headless maintenance context.

**Why it wasn't caught sooner:** The maintenance run "succeeded" structurally (it ran, it reported) but logged "pre-existing test failures detected" and skipped auto-fix. This looked like a test problem, not a scheduler configuration problem.

**Fix:** `runTests()` hardcodes `'npm run test:unit'`. No more detection — the correct command is known and explicit.

**Files:** `src/scheduler.js`

---

### C2 — Token usage in the UI was always zero

**Root cause:** `agent.js` was logging token data to console with `console.log(...)` but never calling `onEvent()`. The `token_usage` SSE event was never emitted. Per-session token totals in the right sidebar showed 0/0/0/0 for every conversation.

**Fix:** Added `onEvent?.({ type: 'token_usage', in, out, cacheRead, cacheWrite })` in `agent.js` after the console.log line.

**Files:** `src/agent.js`

---

### C3 — `result.stdout` always undefined in scheduler

**Root cause:** `runCommand` returned `{ output: "..." }` (field named `output`). The scheduler's `runTests()` read `result.stdout`. `undefined` was interpreted as "no output" → `passed = false` → every test run appeared to fail.

**Fix:** Added `stdout` as an alias field in both success and error returns from `runCommand`.

**Files:** `src/tools/runCommand.js`

---

### C4 — Activity log could consume unbounded memory

**Root cause:** `activityLog.js` called `fs.readFileSync(LOG_FILE, 'utf-8')` to read all entries. On a long-running server, `logs/activity.jsonl` could grow to hundreds of MB. One read call = hundreds of MB allocated on the heap.

**Fix:** 64KB tail-read using `fs.openSync / fs.readSync` with a byte offset. Falls back to full read when file is < 128KB. Only the last 64KB (most recent entries) are ever loaded.

**Files:** `src/activityLog.js`

---

## High Issues (5)

### H1 — Double notifications on every day scan

**Root cause:** `healthMonitor.js` called `notify()` internally when it detected issues. `runDayScan` also called `notify()` on DEGRADED/UNHEALTHY result. Every day scan fired two notifications for the same event.

**Fix:** Removed `notify()` and its import from `healthMonitor.js`. Notification responsibility belongs to the caller (`runDayScan`), not the tool.

**Files:** `src/tools/healthMonitor.js`

---

### H2 — Session GC could evict active SSE sessions

**Root cause:** The GC interval ran every 30 minutes and deleted any session idle for >2 hours. An SSE connection could be idle (user not typing) while still open — the server would delete the session mid-stream.

**Fix:** `activeSseSessions` Set exported from `router.js`. Sessions are added on SSE connect, removed on disconnect or normal completion. GC interval skips any session in the set.

**Files:** `src/web/router.js`

---

### H3 — Stale file locks blocked indefinitely

**Root cause:** `fileLock.js` had no TTL on locks. If a maintenance run crashed mid-write (process killed, OOM), the file lock was never released. The next maintenance run would try to acquire the same lock and fail forever.

**Fix:** `LOCK_TTL_MS = 10 * 60 * 1000` (10 minutes). In `acquireLock()`, if an existing lock is older than 10 minutes, it is auto-expired before checking.

**Files:** `src/tools/fileLock.js`

---

### H4 — Dispatcher `/g` flag caused classification bugs on alternating calls

**Root cause:** Regex patterns in `PATTERNS` array used the `/g` (global) flag. In JavaScript, a `/g` regex is stateful — it remembers `lastIndex` between calls. When the same regex is reused across multiple `classify()` calls, alternating calls could get wrong scores depending on where `lastIndex` was left.

**Fix:** Each `classify()` call creates a fresh regex from the pattern's source: `new RegExp(keywords.source, 'gi')`. No shared state between calls.

**Files:** `src/dispatcher.js`

---

### H5 — `branchWrite` left dirty working tree on commit failure

**Root cause:** In `branch_write`, the flow was: checkout new branch → write file → `git add` → `git commit`. If `git commit` failed (e.g. empty commit, pre-commit hook rejection), the file was written and staged but not committed. The working tree was left modified on the feature branch with no clean rollback.

**Fix:** try/catch around the `git add` + `git commit` block. On failure: if new file → `fs.unlinkSync()`. If existing file → `fs.writeFileSync(fullPath, oldContent)` to restore. Then rethrow.

**Files:** `src/tools/branchWrite.js`

---

## Medium Issues (7)

| Issue | Root cause | Fix |
|-------|-----------|-----|
| M1: `ENABLE_PROMPT_CACHE=false` in example | Wrong default — disables 90% token savings | Changed to `true` |
| M2: Duplicate notification routes | `server.js` AND `router.js` both had `GET /api/notifications` and `POST /api/notifications/read-all`. Express matched `server.js` first; `PATCH /:id/read` in router was unreachable | Removed duplicates from `server.js` |
| M3: `runCommand` timeout too loose | 300s × 20 tools = 100 min, approaching 2h ceiling | Added `_timeoutMs` param; scheduler's `runTests()` passes 120s |
| M4: Safety patterns duplicated, drifted | `branchWrite` was missing `server.js`, `router.js` | Created `src/safetyPatterns.js`, all three files import from it |
| M5: `cacheWrite` missing from token struct | Session token struct had `{ in, out, cacheRead }` — missing `cacheWrite` field | Added to struct in `router.js` + `sessionPersistence.js` |
| M6: No SSE timeout | A hanging Bedrock call held an SSE connection open indefinitely | Added `chatAbort` AbortController + `CHAT_TIMEOUT_MS` (10 min default) |
| M7: `prReview.js` called `lintFile` without checking src/ exists | On codebases without a `src/` directory, lint call threw an error and prReview failed entirely | Added existence check before calling `lintFile` |

## Low Issues (2)

| Issue | Fix |
|-------|-----|
| L1: `PATTERNS` property named `re` (unclear) | Renamed to `keywords` |
| L2: `"update the config"` scored as query (0 maintenance points) | Added `update` to maintenance keyword regex |

---

# 9. Timing Analysis — Proving the Schedule Is Safe

The following relationships were computed and verified:

```
Timeline:
──────────────────────────────────────────────────────────────────────
2:00 AM  Night maintenance starts
         ├── fullScan(): ~30s
         ├── runTests() [120s cap]
         ├── runAgent() with maintenance prompt
         │   ├── Up to 20 tool calls
         │   ├── Each runCommand: up to 300s
         │   ├── Worst case: 20 × 300s = 100 min = 1h 40m
         │   └── Bedrock per-call: 3 retries × 180s + backoff ≈ 554s worst case
         └── Hard timeout fires at 4:00 AM → AbortController fires
4:00 AM  Night maintenance ends (latest possible)
         └── 5 hour gap before day scan
9:00 AM  Day scan starts (healthCheck + healthMonitor only, ~30s)
──────────────────────────────────────────────────────────────────────
```

**The marginal risk that was fixed:**
The original `runCommand` had a 300s timeout hardcoded. In maintenance mode with 20 tool budget: 20 × 300s = 100 minutes. That is 83% of the 2h maintenance window, leaving only 20 minutes for everything else.

**Fix applied:** `runTests()` passes `_timeoutMs: 120000` (2 min). This caps the three `runTests()` calls (pre-fix, post-fix, final) at 6 minutes total. The agent's own `runCommand` tool calls retain the 300s default for complex operations (e.g. running a full test suite).

**Other timing invariants:**
- `fileLock` TTL (10 min) < maintenance timeout (120 min) → no lock outlasts the run
- Session TTL (2h) with `activeSseSessions` guard → no live connection is GC'd mid-stream
- Approval auto-reject (5 min) → bounded wait, no indefinite block
- Notification cap (500 entries) → at ~2–3 notifications/day, 6+ months before hitting limit

---

# 10. Architectural Hardening — June 8 Session

Four improvements made to the underlying architecture (not bug fixes, but structural improvements):

## 1. PM2 Fork Mode Enforced

`ecosystem.config.cjs` now explicitly sets:
```javascript
instances:  1,
exec_mode: 'fork',
```

**Why this matters:** Two in-memory structures cannot work correctly in cluster mode:
- `fileLock` — each PM2 worker has its own copy. Two workers can both "acquire" the same lock simultaneously, allowing concurrent writes to the same file.
- `activeSseSessions` — each worker tracks only its own connections. A GC running in worker 1 would evict sessions whose SSE connections are held by worker 2.

Without the explicit config, a misconfigured deployment could silently break both.

## 2. Safety Patterns — Single Source of Truth

Before: three copies of protected path lists across `writeFile.js`, `branchWrite.js`, `scheduler.js`.
After: one file, `src/safetyPatterns.js`, imported by all three.

The drift that had already occurred: `branchWrite.js` was missing `server.js` and `router.js` in its self-protect list. An agent writing to `src/web/server.js` via `branch_write` would NOT have been blocked, while the same write via `write_file` would have been.

## 3. `AGENT_BRANCH_WRITES` Flag — Wired End-to-End

Before:
- Mentioned in a comment in `branchWrite.js`: "Use this when AGENT_BRANCH_WRITES=true"
- Not in `config.js`
- Not read anywhere in the codebase
- System prompt always showed `write_file` instructions

After:
- `config.agentBranchWrites` reads `process.env.AGENT_BRANCH_WRITES === 'true'`
- `buildSystemPrompt()` accepts `{ agentBranchWrites }` option
- System prompt shows `branch_write` instructions and `⚠️ AGENT_BRANCH_WRITES is ON` when enabled
- `executeTool()` in `agent.js` injects `_approvalFn` for both `write_file` and `branch_write`
- `.env.example` documents the flag with the full trade-off explanation

## 4. `executeTool` — `branch_write` Gets `_approvalFn`

Before: `_approvalFn` was only injected for `write_file` calls. `branch_write` calls had no approval function injected.

After: `if ((name === 'write_file' || name === 'branch_write') && approvalFn)`.

This matters for the web UI mode where the scheduler's `makeWriteApprovalFn` function provides approval logic — it now applies equally to both write tools.

---

# 11. Test Coverage

## Unit Tests (Vitest) — 158 tests, 11 files

| File | What is tested |
|------|---------------|
| `dispatcher.test.js` | Task classification for all 4 types, confidence scoring, regex `/g` bug regression |
| `safetyGate.test.js` | `isHighRisk()` — all HIGH_RISK_PATTERNS verified; `isSelfProtected()` — all SELF_PROTECT_PATTERNS |
| `scheduler.test.js` | `getMaintenanceStatus()`, `getLastScan()`, `getSchedulerHealth()` shape + values |
| `sessionPersistence.test.js` | Save/load round-trip, history cap, delete, list, corrupt JSON safety |
| `branchWrite.test.js` | Tool definition schema, self-protect gate (8 paths), credential guard (AWS key, PEM, safe) |
| `credentialGuard.test.js` | All 13 detection rules, false-positive exclusions |
| `config.test.js` | All config fields present with correct types and defaults |
| `writeArchive.test.js` | Archive creation, listing, path format |
| `activityLog.test.js` | Append, read with limit, logStats |
| `notifications.test.js` | notify(), getNotifications(), markAllRead(), unreadCount() |
| `safetyPatterns.test.js` | Exported functions and constants from new safetyPatterns.js |

## E2E Tests (Playwright) — 28 tests

| Group | Tests |
|-------|-------|
| Page load | 4 — title, logo, UI visible, no console errors |
| Identity modal | 4 — shows on load, name input, submit, session established |
| API health | 3 — `/api/status` fields, `/api/scheduler/health` fields, response format |
| 3-column layout | 5 — left sidebar, chat area, right panel, resize handles, toggle buttons |
| Brand colours | 3 — CSS variables, dark theme, button states |
| Chat input | 3 — input present, send button, SSE stream connects |
| Session memory | 3 — `/api/session/:id/memory` endpoint, token fields, write fields |
| Admin panel | 3 — tab switching, maintenance status, scheduler health display |

All 186 tests pass on every run.

---

# 12. Configuration Reference

All configuration via `.env` file.

| Variable | Default | Effect |
|----------|---------|--------|
| `AWS_REGION` | `us-east-2` | Bedrock API region |
| `AWS_ACCESS_KEY_ID` | — | Required. AWS credential. |
| `AWS_SECRET_ACCESS_KEY` | — | Required. AWS credential. |
| `CODEBASE_PATH` | `process.cwd()` | Absolute path to target codebase. Any language, any size. |
| `DB_URL` | — | PostgreSQL connection string. Requires SSM tunnel on localhost:5433. |
| `WEB_PORT` | `3001` | HTTP server port. |
| `ENABLE_PROMPT_CACHE` | `true` | Cache system prompt on Bedrock. ~90% input token reduction on cached block. |
| `BEDROCK_TIMEOUT_MS` | `180000` | Per Bedrock call timeout. 3 retries × this = max wait. |
| `CHAT_TIMEOUT_MS` | `600000` | Overall SSE connection timeout. 10 minutes. |
| `MAINTENANCE_TIMEOUT_MS` | `7200000` | Hard 2-hour ceiling on night maintenance. AbortController fires on expiry. |
| `NIGHT_MAINTENANCE_CRON` | `0 2 * * *` | 2am IST daily. |
| `DAY_LIGHT_SCAN_CRON` | `0 9 * * *` | 9am IST daily. healthCheck + healthMonitor only. |
| `AUTO_FIX_ENABLED` | `true` | Enable autonomous file writes during night maintenance. |
| `AUTO_FIX_MIN_CONFIDENCE` | `80` | Minimum confidence score for auto-fix. Below this → report only. |
| `AGENT_BRANCH_WRITES` | `false` | `true` → all agent writes go to `agent/fix-*` branches (PR required). Recommended for production. |
| `NOTIFICATION_WEBHOOK_URL` | — | Slack or Discord incoming webhook. Empty = in-app notifications only. |
| `HEALTH_MONITOR_URLS` | — | Comma-separated URLs to HTTP-probe on day scan. |
| `GITHUB_CLIENT_ID` | — | GitHub OAuth App client ID. Empty = name-only mode. |
| `GITHUB_CLIENT_SECRET` | — | GitHub OAuth App client secret. |
| `SESSION_SECRET` | `change-me` | Express session secret. **Must change in production.** |
| `GITHUB_WEBHOOK_SECRET` | — | HMAC secret for verifying GitHub webhook signatures. |
| `GITHUB_TOKEN` | — | PAT for posting PR review comments via `@octokit/rest`. |
| `WEEKLY_REPORT_CRON` | `0 9 * * 1` | Weekly Slack report schedule. |

---

# 13. What the Agent Cannot Do — Hard Limits

These are not soft guidelines — they are enforced by code-level gates or external hooks that cannot be overridden by any prompt.

| Cannot do | Enforced by |
|-----------|------------|
| Modify its own source code | `isSelfProtected()` in `write_file` + `branch_write` — code level |
| Modify DB migrations or schema.prisma | Same as above |
| Write hardcoded credentials to any file | `credentialGuard` — runs before every write |
| Auto-push to git remote | No push command in `run_command` allowlist |
| Push directly to main/master/production | Claude Code PreToolUse hook — fires before the tool call |
| Run `npm run deploy` or similar | Not in exact-match command allowlist |
| Run UPDATE/DELETE/INSERT on the database | Claude Code PreToolUse hook on Postgres MCP |
| Auto-fix when pre-existing tests fail | Hardcoded check in `runNightMaintenance()` |
| Auto-fix with confidence < 80% | `config.autoFixMinConfidence` check before each fix |
| Run in PM2 cluster mode | `instances: 1` in `ecosystem.config.cjs` |

---

# 14. Deployment Checklist

### Week 1 — Observe only

- [ ] `CODEBASE_PATH` = real `tiq_workplace` path
- [ ] `DB_URL` = read-only database user
- [ ] `AUTO_FIX_ENABLED=false` — scan and report only, no writes
- [ ] `AGENT_BRANCH_WRITES=true` — if/when auto-fix is enabled, all writes go via PR
- [ ] `NOTIFICATION_WEBHOOK_URL` = team Slack channel
- [ ] `HEALTH_MONITOR_URLS` = real platform endpoints
- [ ] `SESSION_SECRET` changed from default
- [ ] PM2 running: verify `pm2 status` shows `instances: 1`, `exec_mode: fork`
- [ ] Review every nightly maintenance report manually

### Week 2 — Enable auto-fix

- [ ] `AUTO_FIX_ENABLED=true`
- [ ] `AUTO_FIX_MIN_CONFIDENCE=80` (start high, lower only after validating output quality)
- [ ] First auto-fix: verify PR was created on `agent/fix-*` branch, review the diff, merge manually
- [ ] Check `logs/archives/` — before/after diff for every write is stored here

### Ongoing

- [ ] Claude Code hooks verified active (`settings.json` PreToolUse hooks running)
- [ ] `GITHUB_CLIENT_ID/SECRET` configured for audit trail
- [ ] Weekly maintenance reports reviewed by a developer
- [ ] `HEALTH_MONITOR_URLS` updated when platform endpoints change

---

# 15. Options Considered and Rejected

## Agent framework (LangChain, AutoGen, CrewAI) vs. direct tool-use loop

**Considered:** Using LangChain or a similar framework to abstract the agent loop.

**Rejected:** Frameworks add an abstraction layer between the code and the API calls. For debugging, observability, and understanding exactly what is being sent to Bedrock, a direct implementation is clearer. The tool-use loop is not complex — it is about 80 lines of code. Adding a framework dependency for 80 lines of understandable logic would make the system harder to debug, not easier.

## WebSockets vs. SSE

**Considered:** WebSockets for the chat streaming.

**Rejected:** SSE is unidirectional (server → client), which is exactly what streaming AI responses need. WebSockets add bidirectional protocol complexity for no benefit. SSE works over standard HTTP and reconnects automatically.

## Database for session storage vs. flat files

**Considered:** PostgreSQL for session and activity log storage.

**Rejected:** A database adds operational overhead — a running Postgres instance, schema migrations, connection pooling. The agent already depends on a Postgres SSM tunnel for `db_query`. Adding another Postgres dependency for session storage would complicate deployment. JSONL files are appendable, grep-able, immediately inspectable, and require no setup.

## Real-time lint on every file save vs. scheduled scans

**Considered:** Running ESLint on file changes (file watcher mode).

**Rejected:** The agent is a codebase-level tool, not an IDE plugin. File watchers are an IDE feature. Scheduled scans at 2am cover all files in batch, which is the appropriate mode for a maintenance agent. Running lint continuously would consume resources for no additional value over nightly batch runs.

## Confidence scoring via test runs vs. static analysis

**Considered:** Verifying `fix_error` confidence by actually running the fix in a sandbox and checking if tests pass.

**Rejected:** Too slow and complex for the current architecture. The static heuristic (stack trace file coverage + keyword density + function complexity) provides a reasonable signal. The post-fix test run (`run_command`) is the real safety net — if the agent is wrong despite high confidence, the tests will catch it and rollback will restore the original state.

## Auto-push vs. manual push after branch_write

**Considered:** Having `branch_write` automatically push the feature branch to origin.

**Rejected:** Auto-push would require git credentials configured on the server. More importantly, a developer reviewing the branch in the Git UI is the human checkpoint. Requiring a manual push reinforces the review step — the developer must actively go get the branch, not just merge a notification.

---

*Document generated from `docs/devlog.md`, `docs/system-design.md`, `docs/TECHNICAL.md`*
*Repository: github.com/Shalin-mish/tiqworld-ai-agent*
*All 186 tests passing as of June 8, 2026*
