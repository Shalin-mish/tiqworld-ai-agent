#!/usr/bin/env python3
"""
TIQ World AI Agent
Claude-powered agent for codebase maintenance and improvement.
"""

import argparse
import json
import os
import sys
from pathlib import Path

import anthropic
from rich.console import Console
from rich.markdown import Markdown
from rich.panel import Panel

sys.path.insert(0, os.path.dirname(__file__))

from prompts import SYSTEM_PROMPT, REVIEW_PROMPT, HEALTH_CHECK_PROMPT
from tools import read_file, get_file_summary, search_codebase, TOOL_DEFINITIONS

console = Console()
client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
MODEL = "claude-sonnet-4-6"


def execute_tool(name: str, inputs: dict) -> str:
    if name == "read_file":
        result = read_file(inputs["filepath"])
    elif name == "list_files":
        from tools import list_files
        result = list_files(inputs["directory"])
    elif name == "search_codebase":
        result = search_codebase(inputs["query"], inputs["directory"])
    else:
        result = {"error": f"Unknown tool: {name}"}
    return json.dumps(result, indent=2)


def run_agent(user_message: str) -> str:
    """
    Real tool-use loop.
    Claude decides which tools to call, agent executes them,
    loop continues until Claude returns a final answer.
    """
    messages = [{"role": "user", "content": user_message}]

    while True:
        response = client.messages.create(
            model=MODEL,
            max_tokens=4096,
            system=[
                {
                    "type": "text",
                    "text": SYSTEM_PROMPT,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            tools=TOOL_DEFINITIONS,
            messages=messages,
        )

        # Claude finished — return final text answer
        if response.stop_reason == "end_turn":
            for block in response.content:
                if hasattr(block, "text"):
                    return block.text
            return ""

        # Claude wants to call tools
        if response.stop_reason == "tool_use":
            # Add Claude's response (with tool_use blocks) to message history
            messages.append({"role": "assistant", "content": response.content})

            # Execute every tool Claude asked for, collect results
            tool_results = []
            for block in response.content:
                if block.type == "tool_use":
                    console.print(f"[dim]→ calling {block.name}({json.dumps(block.input)})[/dim]")
                    output = execute_tool(block.name, block.input)
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": output,
                    })

            # Send tool results back to Claude and loop
            messages.append({"role": "user", "content": tool_results})
            continue

        # Unexpected stop reason
        break

    return "Agent stopped unexpectedly."


def review_file(filepath: str) -> None:
    if not Path(filepath).exists():
        console.print(f"[red]File not found: {filepath}[/red]")
        sys.exit(1)

    console.print(f"[bold blue]Reviewing:[/bold blue] {filepath}\n")
    result_data = read_file(filepath)
    if "error" in result_data:
        console.print(f"[red]{result_data['error']}[/red]")
        sys.exit(1)

    prompt = REVIEW_PROMPT.format(filename=filepath, code=result_data["content"])
    result = run_agent(prompt)
    console.print(Panel(Markdown(result), title="Code Review", border_style="blue"))


def ask_question(question: str, codebase_dir: str = ".") -> None:
    console.print(f"[bold blue]Question:[/bold blue] {question}\n")
    # Pass codebase dir as context so Claude's tools know where to search
    message = (
        f"Codebase directory: {codebase_dir}\n\n"
        f"Question: {question}\n\n"
        "Use the available tools to search and read relevant files, then answer."
    )
    result = run_agent(message)
    console.print(Panel(Markdown(result), title="Answer", border_style="green"))


def health_check(codebase_dir: str = ".") -> None:
    console.print(f"[bold blue]Running health check on:[/bold blue] {codebase_dir}\n")
    summary = get_file_summary(codebase_dir)
    file_list = "\n".join(summary["files"][:50])
    if len(summary["files"]) > 50:
        file_list += f"\n... and {len(summary['files']) - 50} more files"

    prompt = HEALTH_CHECK_PROMPT.format(
        file_count=summary["file_count"],
        languages=summary["languages"],
        file_list=file_list,
    )
    result = run_agent(prompt)
    console.print(Panel(Markdown(result), title="Codebase Health Check", border_style="yellow"))


def interactive_mode() -> None:
    console.print(Panel(
        "[bold green]TIQ World AI Agent[/bold green]\n"
        "Your AI-powered tech team member.\n"
        "Type 'exit' to quit.",
        border_style="green",
    ))
    while True:
        try:
            user_input = console.input("\n[bold]You:[/bold] ").strip()
            if user_input.lower() in ("exit", "quit"):
                break
            if not user_input:
                continue
            result = run_agent(user_input)
            console.print(f"\n[bold blue]Agent:[/bold blue]")
            console.print(Markdown(result))
        except KeyboardInterrupt:
            break
    console.print("\n[dim]Goodbye.[/dim]")


def main():
    parser = argparse.ArgumentParser(description="TIQ World AI Agent")
    parser.add_argument("--review", metavar="FILE", help="Review a specific file")
    parser.add_argument("--ask", metavar="QUESTION", help="Ask a question about the codebase")
    parser.add_argument("--health-check", metavar="DIR", nargs="?", const=".", help="Run codebase health check")
    parser.add_argument("--codebase", metavar="DIR", default=".", help="Codebase root directory")
    args = parser.parse_args()

    if not os.environ.get("ANTHROPIC_API_KEY"):
        console.print("[red]Error: ANTHROPIC_API_KEY environment variable not set.[/red]")
        sys.exit(1)

    if args.review:
        review_file(args.review)
    elif args.ask:
        ask_question(args.ask, args.codebase)
    elif args.health_check is not None:
        health_check(args.health_check)
    else:
        interactive_mode()


if __name__ == "__main__":
    main()
