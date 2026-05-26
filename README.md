# TIQ World AI Agent

Claude-powered AI agent embedded in the TIQ World engineering team. Not a chatbot — a tool-use agent that navigates the codebase, diagnoses bugs, runs maintenance, and answers deep questions about code.

## Stack

- **Runtime:** Node.js 20+ (ES modules)
- **AI:** Claude via AWS Bedrock (`us-east-2`)
- **UI:** Express + SSE (no frontend build step)
- **DB:** PostgreSQL read-only via SSM tunnel (localhost:5433)

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
TIQ_CODEBASE_PATH=C:/Users/Shalini Mishra/TIQ
DB_URL=postgresql://...@localhost:5433/tiqworld
```

## Running

```bash
# Web UI (recommended)
npm run web
# → http://localhost:3000        Chat UI
# → http://localhost:3000/admin  Admin panel

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

## Tools (24 total)

| Group | Tools |
|-------|-------|
| Exploration | `list_files`, `read_file`, `search_code`, `recall_session` |
| Analysis | `health_check`, `full_scan`, `trace_error`, `fix_error`, `map_dependencies`, `explain_route`, `find_todos`, `check_env_usage`, `detect_dead_code`, `schema_to_api`, `summarize_diff`, `git_log`, `lint_file`, `db_query` |
| Write + Verify | `git_backup`, `show_diff`, `write_file`, `run_command` |

## Maintenance Schedule

| Cron | Time (IST) | What happens |
|------|-----------|-------------|
| `0 2 * * *` | 2:00 AM | Deep scan + auto-fix (confidence ≥ 55) |
| `0 */2 * * *` | Every 2h | Light scan, no writes |

Admin panel at `/admin` shows live progress, report history, and write approvals.

## Admin Panel

- **One-click maintenance** — start deep or light scan anytime
- **Live progress stream** — watch what the agent is doing in real time
- **Report history** — every past maintenance run with stats
- **Write approval dialog** — approve or deny file writes from the browser
- **Activity log** — every tool call, query, and write

## Architecture

```
User query
  → classify() → task type (query/review/maintenance/feature)
  → getTools()  → restrict tool set by type
  → runAgent()  → Bedrock Converse API loop
  → tool calls executed → results fed back
  → answer streamed via SSE
```

Write sequence (always):
```
git_backup → show_diff → write_file → run_command (verify)
```

---
*Internship project — TIQ World, 2026*
