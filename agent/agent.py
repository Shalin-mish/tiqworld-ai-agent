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
from tools import (
    read_file,
    list_files,
    search_codebase,
    error_tracer,
    explain_route,
    get_file_summary,
    TOOL_DEFINITIONS,
)

console = Console()
client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
MODEL = "claude-sonnet-4-6"

# Registry pattern — add new tools here, no changes needed elsewhere
TOOL_REGISTRY = {
    "read_file":       lambda i: read_file(i["filepath"]),
    "list_files":      lambda i: list_files(i["directory"]),
    "search_codebase": lambda i: search_codebase(i["query"], i["directory"]),
    "error_tracer":    lambda i: error_tracer(i["error_message"], i["directory"]),
    "explain_route":   lambda i: explain_route(i["route_path"], i["directory"]),
}


def execute_tool(name: str, inputs: dict) -> str:
    handler = TOOL_REGISTRY.get(name)
    if not handler:
        return json.dumps({
            "error": f"Unknown tool: {name}",
            "suggestion": f"Available tools: {list(TOOL_REGISTRY.keys())}",
        })
    return json.dumps(handler(inputs), indent=2)


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

        if response.stop_reason == "end_turn":
            for block in response.content:
                if hasattr(block, "text"):
                    return block.text
            return ""

        if response.stop_reason == "tool_use":
            messages.append({"role": "assistant", "content": response.content})

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

            messages.append({"role": "user", "content": tool_results})
            continue

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
    message = (
        f"Codebase directory: {codebase_dir}\n\n"
        f"Question: {question}\n\n"
        "Use the available tools to search and read relevant files, then answer."
    )
    result = run_agent(message)
    console.print(Panel(Markdown(result), title="Answer", border_style="green"))


def trace_error(error_text: str, codebase_dir: str = ".") -> None:
    console.print(f"[bold red]Tracing error:[/bold red] {error_text[:80]}...\n")
    message = (
        f"Codebase directory: {codebase_dir}\n\n"
        f"I got this error. Use the error_tracer tool to find all relevant files, "
        f"then explain the root cause and suggest a fix.\n\nError:\n{error_text}"
    )
    result = run_agent(message)
    console.print(Panel(Markdown(result), title="Error Analysis", border_style="red"))


def explain_route_cmd(route_path: str, codebase_dir: str = ".") -> None:
    console.print(f"[bold blue]Explaining route:[/bold blue] {route_path}\n")
    message = (
        f"Codebase directory: {codebase_dir}\n\n"
        f"Use the explain_route tool to trace the full request chain for this Express route, "
        f"then describe each layer clearly.\n\nRoute: {route_path}"
    )
    result = run_agent(message)
    console.print(Panel(Markdown(result), title=f"Route: {route_path}", border_style="cyan"))


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
    parser.add_argument("--review",      metavar="FILE",     help="Review a specific file")
    parser.add_argument("--ask",         metavar="QUESTION", help="Ask a question about the codebase")
    parser.add_argument("--trace-error", metavar="ERROR",    help="Trace a stack trace / error message")
    parser.add_argument("--explain-route", metavar="ROUTE",  help="Explain a route end-to-end, e.g. /api/users/login")
    parser.add_argument("--health-check", metavar="DIR", nargs="?", const=".", help="Run codebase health check")
    parser.add_argument("--codebase",    metavar="DIR", default=".", help="Codebase root directory")
    args = parser.parse_args()

    if not os.environ.get("ANTHROPIC_API_KEY"):
        console.print("[red]Error: ANTHROPIC_API_KEY environment variable not set.[/red]")
        sys.exit(1)

    if args.review:
        review_file(args.review)
    elif args.ask:
        ask_question(args.ask, args.codebase)
    elif args.trace_error:
        trace_error(args.trace_error, args.codebase)
    elif args.explain_route:
        explain_route_cmd(args.explain_route, args.codebase)
    elif args.health_check is not None:
        health_check(args.health_check)
    else:
        interactive_mode()


if __name__ == "__main__":
    main()
