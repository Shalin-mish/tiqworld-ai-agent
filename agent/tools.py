import sys
import os
import glob
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from config.settings import EXCLUDE_DIRS, MAX_FILE_SIZE, SUPPORTED_EXTENSIONS


def read_file(filepath: str) -> dict:
    p = Path(filepath)
    if not p.exists():
        return {"error": f"File not found: {filepath}"}
    if p.stat().st_size > MAX_FILE_SIZE:
        return {"error": f"File too large (>{MAX_FILE_SIZE} bytes): {filepath}"}
    try:
        content = p.read_text(encoding="utf-8", errors="ignore")
        return {
            "filepath": str(filepath),
            "line_count": len(content.splitlines()),
            "language": p.suffix,
            "content": content,
        }
    except Exception as e:
        return {"error": str(e), "filepath": str(filepath)}


def list_files(directory: str) -> dict:
    files = []
    by_language = {}
    for ext in SUPPORTED_EXTENSIONS:
        matches = glob.glob(f"{directory}/**/*{ext}", recursive=True)
        for f in matches:
            parts = Path(f).parts
            if any(ex in parts for ex in EXCLUDE_DIRS):
                continue
            files.append(f)
            by_language[ext] = by_language.get(ext, 0) + 1
    files = sorted(files)
    return {
        "directory": directory,
        "file_count": len(files),
        "by_language": by_language,
        "files": files,
    }


def get_file_summary(root_dir: str) -> dict:
    result = list_files(root_dir)
    return {
        "file_count": result["file_count"],
        "languages": result["by_language"],
        "files": result["files"],
    }


def search_codebase(query: str, directory: str) -> dict:
    results = []
    file_data = list_files(directory)
    query_lower = query.lower()
    for filepath in file_data["files"]:
        try:
            content = Path(filepath).read_text(encoding="utf-8", errors="ignore")
            if query_lower in content.lower():
                matching_lines = [
                    {"line": i + 1, "content": line.strip()}
                    for i, line in enumerate(content.splitlines())
                    if query_lower in line.lower()
                ]
                results.append({
                    "file": filepath,
                    "match_count": len(matching_lines),
                    "matches": matching_lines[:10],
                })
        except Exception:
            continue
    return {
        "query": query,
        "directory": directory,
        "total_files_matched": len(results),
        "results": results,
    }


TOOL_DEFINITIONS = [
    {
        "name": "read_file",
        "description": (
            "Read the contents of a file in the codebase. "
            "Returns file path, line count, language, and full content."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "filepath": {
                    "type": "string",
                    "description": "Path to the file to read",
                }
            },
            "required": ["filepath"],
        },
    },
    {
        "name": "list_files",
        "description": (
            "List all source files in a directory. "
            "Returns file paths grouped by language. Skips node_modules, __pycache__, etc."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "directory": {
                    "type": "string",
                    "description": "Directory path to scan for source files",
                }
            },
            "required": ["directory"],
        },
    },
    {
        "name": "search_codebase",
        "description": (
            "Search all source files in a directory for a keyword or phrase. "
            "Returns matching files with line numbers and matching content."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Keyword or phrase to search for",
                },
                "directory": {
                    "type": "string",
                    "description": "Directory to search in",
                },
            },
            "required": ["query", "directory"],
        },
    },
]
