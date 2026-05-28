# TIQ World AI Agent

Claude-powered AI agent embedded in the TIQ World engineering team. Not a chatbot — a tool-use agent that navigates the codebase, diagnoses bugs, runs maintenance, and answers deep questions about code.

## Stack

- **Runtime:** Node.js 20+ (ES modules)
- **AI:** Claude via AWS Bedrock (`us-east-2`)
- **UI:** Express + SSE (no frontend build step)
- **DB:** PostgreSQL read-only via SSM tunnel (localhost:5433)
- **Target codebase:** `tiq_workplace` — TypeScript microservices (Fastify + PostgreSQL, 7 backend services + 2 React frontends)

## Setup

```bash
npm install

# Copy and fill in your credentials
cp .env.example .env
```

Required `.env` variables:
```
AWS_REGION=us-east-2
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
TIQ_CODEBASE_PATH=C:/Users/Shalini Mishra/tiq_workplace
DB_URL=postgresql://...@localhost:5433/tiqworld
```

## Running

```bash
# Web UI (recommended)
npm run web
# → http://localhost:3001        Chat UI (single-page: chat + admin tabs)

# CLI (interactive terminal)
npm run start

# Development (auto-reload)
npm run dev
npm run web:dev
```

## Always-On with PM2 (Recommended for Night Maintenance)

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup    # auto-start on Windows boot

# Useful commands
pm2 status
pm2 logs tiq-agent
pm2 restart tiq-agent
```

Once PM2 is set up, the agent stays alive through reboots. Night maintenance at 2 AM IST fires automatically.

## Verify Commands (tiq_workplace microservices)

The agent runs tests and builds **per service** — there is no top-level `npm test` in `tiq_workplace`.

```bash
# Run tests for a service
npm --prefix backend/auth-service test
npm --prefix backend/training-service test
npm --prefix backend/assessment-service test

# Build (TypeScript compile check)
npm --prefix backend/auth-service run build

# Frontend
npm --prefix consumer-app test
npm --prefix admin-app test

# Lint
npm --prefix backend/auth-service run lint
npx eslint backend/auth-service/src
```

Services: `auth-service`, `training-service`, `assessment-service`, `inference-service`, `notification-service`, `job-posting-service`, `payment-service`

## Tools (26 total)

| Group | Tools |
|-------|-------|
| Exploration | `list_files`, `read_file`, `search_code`, `recall_session` |
| Analysis | `health_check`, `full_scan`, `trace_error`, `fix_error`, `map_dependencies`, `explain_route`, `find_todos`, `check_env_usage`, `detect_dead_code`, `schema_to_api`, `summarize_diff`, `git_log`, `lint_file`, `db_query` |
| Security + Deps | `secret_scanner`, `dep_updater`, `credential_guard` |
| Monitoring | `health_monitor` |
| Write + Verify | `git_backup`, `show_diff`, `write_file`, `run_command` |

### `health_monitor`
Probes the platform without touching any code. Three signal layers:
1. **HTTP synthetic probes** — GET critical URLs, checks status codes and response time (<3s threshold)
2. **Log anomaly scan** — scans agent logs for ERROR/CRITICAL/FATAL patterns in the last N minutes
3. **Process vitals** — Node heap usage, uptime, event-loop lag

Results appear in the Admin tab → "Platform Health" section. Configure URLs via `HEALTH_MONITOR_URLS` env var (comma-separated). Also runs automatically on every day scan cycle.

### `credential_guard`
**Automatic write-gate** — every `write_file` call passes through this guard before touching disk:
- Blocks writes that contain hardcoded passwords, API keys, AWS credentials, private keys (PEM), JWT secrets, DB connection strings with embedded credentials
- Blocks writes to protected filenames: `.env`, `.env.*`, `secrets.json`, `id_rsa`, etc.
- Also callable explicitly by the agent before proposing a change
- Does **not** block `process.env.VARIABLE` usage — that is the correct pattern

## Maintenance Schedule

| Cron | Time (IST) | What happens |
|------|-----------|-------------|
| `0 2 * * *` | 2:00 AM | Deep scan + auto-fix (confidence ≥ 55) |
| `0 */2 * * *` | Every 2h | Light scan + health monitor probe |

Admin panel is embedded in the main UI at `http://localhost:3001` (Admin tab) — shows live progress, report history, write approvals, and platform health.

## Admin Panel

- **One-click maintenance** — start deep or light scan anytime
- **Live progress stream** — watch what the agent is doing in real time
- **Report history** — every past maintenance run with stats
- **Write approval dialog** — approve or deny file writes from the browser
- **Activity log** — every tool call, query, and write
- **Platform Health** — run `health_monitor` on demand, see URL probe results, log errors, process vitals

## Architecture

```
User query
  → classify() → task type (query/review/maintenance/feature)
  → getTools()  → restrict tool set by type
  → runAgent()  → Bedrock Converse API loop
  → tool calls executed → results fed back (capped at 3000 chars each)
  → answer streamed via SSE
```

Write sequence (always):
```
credential_guard (blocks hardcoded secrets)
  ↓ if clean
git_backup → show_diff → write_file → run_command (verify)
                                           ↓ if tests fail
                                       git_backup restore
```

Day scan cycle (every 2h):
```
lint + findTodos + healthCheck + healthMonitor (parallel)
  ↓ if health DEGRADED/UNHEALTHY
notify() → in-app notification + webhook (Slack/Discord)
```

## Token Optimisations

Every Bedrock call logs token usage to the console:
```
[Tokens] in:1240 out:312 cache_read:890
```
- System prompt is cached via `cachePoint: default`
- Tool results are capped at 3 000 chars each
- Conversation history is capped at 8 messages (4 turns)

## Note on `agent/` folder

The `agent/` directory contains an early Python prototype built with the Anthropic SDK directly. It is **archived** — not run, not tested, not maintained. All active development is in `src/`.

---
*Internship project — TIQ World, 2026*
