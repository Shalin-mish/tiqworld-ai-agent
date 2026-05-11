#!/usr/bin/env python3
"""
TIQ World AI Agent
Claude-powered agent for codebase maintenance and improvement.
"""

import argparse
import os
import sys
from pathlib import Path

import anthropic
from rich.console import Console
from rich.markdown import Markdown
from rich.panel import Panel

from prompts import SYSTEM_PROMPT, REVIEW_PROMPT, QUESTION_PROMPT, HEALTH_CHECK_PROMPT
from tools import read_file, get_file_summary, search_codebase

console = Console()
client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
MODEL = "claude-sonnet-4-6"


def ask_claude(prompt: str) -> str:
    response = client.messages.create(
        model=MODEL,
        max_tokens=4096,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": prompt}],
    )
    return response.content[0].text


def review_file(filepath: str) -> None:
    if not Path(filepath).exists():
        console.print(f"[red]File not found: {filepath}[/red]")
        sys.exit(1)

    console.print(f"[bold blue]Reviewing:[/bold blue] {filepath}\n")
    code = read_file(filepath)
    prompt = REVIEW_PROMPT.format(filename=filepath, code=code)
    result = ask_claude(prompt)
    console.print(Panel(Markdown(result), title="Code Review", border_style="blue"))


def ask_question(question: str, codebase_dir: str = ".") -> None:
    console.print(f"[bold blue]Question:[/bold blue] {question}\n")
    matches = search_codebase(codebase_dir, question)
    context = ""
    if matches:
        context = "\n".join(
            f"File: {m['file']}\n" + "\n".join(f"  Line {l['line']}: {l['content']}" for l in m["matches"])
            for m in matches[:3]
        )
    else:
        context = "No specific files found related to this question."

    prompt = QUESTION_PROMPT.format(question=question, context=context)
    result = ask_claude(prompt)
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
    result = ask_claude(prompt)
    console.print(Panel(Markdown(result), title="Codebase Health Check", border_style="yellow"))


def interactive_mode() -> None:
    console.print(Panel(
        "[bold green]TIQ World AI Agent[/bold green]\nYour AI-powered tech team member.\nType 'exit' to quit.",
        border_style="green"
    ))
    while True:
        try:
            user_input = console.input("\n[bold]You:[/bold] ").strip()
            if user_input.lower() in ("exit", "quit"):
                break
            if not user_input:
                continue
            result = ask_claude(user_input)
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
