# TIQ World AI Agent

A Claude-powered AI agent that acts as a member of the TIQ World tech team — helping maintain, review, and improve the codebase.

## What This Does

- Reviews code and suggests improvements
- Detects bugs and potential issues
- Answers questions about the codebase
- Helps maintain code quality and consistency
- Summarizes recent changes and their impact

## Project Structure

```
tiqworld-ai-agent/
├── agent/              # Core agent logic
│   ├── agent.py        # Main agent entry point
│   ├── tools.py        # Agent tools (code review, file search, etc.)
│   └── prompts.py      # System prompts and templates
├── config/             # Configuration
│   └── settings.py
├── tests/              # Test suite
├── docs/               # Documentation and dev log
│   └── devlog.md
└── README.md
```

## Tech Stack

- **AI Model:** Claude (Anthropic API)
- **Language:** Python 3.10+
- **Key Libraries:** anthropic, gitpython, rich

## Setup

```bash
# Install dependencies
pip install -r requirements.txt

# Set your API key
export ANTHROPIC_API_KEY=your_key_here

# Run the agent
python agent/agent.py
```

## Usage

```bash
# Review a specific file
python agent/agent.py --review path/to/file.py

# Ask a question about the codebase
python agent/agent.py --ask "What does the auth module do?"

# Run a full codebase health check
python agent/agent.py --health-check
```

## Project Log

Daily progress is tracked in [docs/devlog.md](docs/devlog.md).

---

*Internship project — TIQ World, April–June 2026*
