import re
import sys
import os
import glob
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from config.settings import EXCLUDE_DIRS, MAX_FILE_SIZE, SUPPORTED_EXTENSIONS


def read_file(filepath: str) -> dict:
    p = Path(filepath)
    if not p.exists():
        return {"error": f"File not found: {filepath}", "path": filepath, "suggestion": "Check the path and try list_files to browse the directory."}
    if p.stat().st_size > MAX_FILE_SIZE:
        return {"error": f"File too large (>{MAX_FILE_SIZE} bytes): {filepath}", "path": filepath, "suggestion": "Read a specific section or summarize instead."}
    try:
        content = p.read_text(encoding="utf-8", errors="ignore")
        return {
            "filepath": str(filepath),
            "line_count": len(content.splitlines()),
            "language": p.suffix,
            "content": content,
        }
    except Exception as e:
        return {"error": str(e), "path": str(filepath), "suggestion": "File may be binary or unreadable."}


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


def error_tracer(error_message: str, directory: str) -> dict:
    """
    Paste a Node.js or Python error/stack trace → agent finds all relevant files
    across the codebase and returns their content for diagnosis.
    """
    # Extract file paths from Node.js and Python stack traces
    file_pattern = re.compile(
        r'at .+? \((.+?):\d+:\d+\)'     # Node.js: at fn (path:line:col)
        r'|File "(.+?)", line \d+'        # Python: File "path", line N
        r'|at (.+?):\d+:\d+'             # Node.js bare: at path:line:col
    )

    raw_paths = []
    for match in file_pattern.finditer(error_message):
        path = match.group(1) or match.group(2) or match.group(3)
        if path and not path.startswith(("internal", "node:", "<")):
            raw_paths.append(path)

    # Extract identifiers from error first line for keyword search
    first_line = error_message.strip().split("\n")[0]
    noise = {
        "Error", "TypeError", "ReferenceError", "SyntaxError", "Cannot",
        "undefined", "null", "object", "function", "property", "line",
        "file", "module", "require", "import", "from", "default", "true", "false",
    }
    keywords = [
        k for k in re.findall(r'\b([A-Za-z][A-Za-z0-9_]{3,})\b', first_line)
        if k not in noise
    ][:5]

    traced_files = []
    seen_paths = set()

    # Read files directly referenced in stack trace
    for filepath in raw_paths:
        if filepath in seen_paths:
            continue
        seen_paths.add(filepath)
        result = read_file(filepath)
        if "error" not in result:
            traced_files.append({
                "source": "stack_trace",
                "file": filepath,
                "line_count": result["line_count"],
                "content": result["content"],
            })

    # Search codebase for extracted keywords
    keyword_matches = []
    for kw in keywords[:3]:
        search_result = search_codebase(kw, directory)
        for r in search_result.get("results", [])[:2]:
            if r["file"] not in seen_paths:
                seen_paths.add(r["file"])
                keyword_matches.append({
                    "source": f"keyword:{kw}",
                    "file": r["file"],
                    "match_count": r["match_count"],
                    "matches": r["matches"][:5],
                })

    return {
        "error_summary": first_line,
        "stack_trace_files_found": len(traced_files),
        "keywords_extracted": keywords,
        "traced_files": traced_files,
        "keyword_matches": keyword_matches,
        "total_references": len(traced_files) + len(keyword_matches),
    }


def explain_route(route_path: str, directory: str) -> dict:
    """
    Given an Express route (e.g. /api/users/login), trace the full request chain:
    route definition → controller → service → model
    """
    route_results = search_codebase(route_path, directory)

    chain = []
    seen = set()

    # Identify route files
    route_files = []
    for r in route_results.get("results", []):
        fp = r["file"]
        if any(x in fp.lower() for x in ["route", "router", "index"]) or fp.endswith((".js", ".ts")):
            route_files.append(fp)

    # Read route files and extract controller/middleware references
    for filepath in route_files[:3]:
        if filepath in seen:
            continue
        seen.add(filepath)
        result = read_file(filepath)
        if "error" in result:
            continue
        content = result["content"]
        chain.append({
            "layer": "route",
            "file": filepath,
            "content_preview": content[:1500],
        })

        # Find require/import statements pointing to controllers or services
        import_refs = re.findall(
            r'(?:import|require)\s*[({]?\s*[A-Za-z0-9_{}, ]+\s*[)}]?\s*(?:from)?\s*[\'"]([./][^\'"]+)[\'"]',
            content,
        )
        for ref_path in import_refs:
            if any(x in ref_path.lower() for x in ["controller", "handler", "service", "middleware", "auth"]):
                # Resolve relative path from file location
                base = Path(filepath).parent
                resolved = str((base / ref_path).resolve())
                # Try common extensions
                for ext in [".js", ".ts", ""]:
                    candidate = resolved + ext if not resolved.endswith((".js", ".ts")) else resolved
                    if candidate not in seen:
                        seen.add(candidate)
                        sub = read_file(candidate)
                        if "error" not in sub:
                            layer = "controller" if "controller" in ref_path.lower() else \
                                    "service" if "service" in ref_path.lower() else \
                                    "middleware"
                            chain.append({
                                "layer": layer,
                                "file": candidate,
                                "content_preview": sub["content"][:1500],
                            })
                        break

    # Search for model references based on route segment (e.g. /users → User model)
    segments = [s for s in route_path.split("/") if s and s != "api"]
    if segments:
        model_name = segments[-1].rstrip("s").capitalize()  # users → User
        model_results = search_codebase(model_name, directory)
        for r in model_results.get("results", []):
            if "model" in r["file"].lower() and r["file"] not in seen:
                seen.add(r["file"])
                sub = read_file(r["file"])
                if "error" not in sub:
                    chain.append({
                        "layer": "model",
                        "file": r["file"],
                        "content_preview": sub["content"][:1500],
                    })
                break

    return {
        "route_path": route_path,
        "layers_found": len(chain),
        "chain": chain,
        "summary": f"Traced {len(chain)} layers for {route_path}: " + " → ".join(c["layer"] for c in chain),
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
                "filepath": {"type": "string", "description": "Path to the file to read"}
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
                "directory": {"type": "string", "description": "Directory path to scan for source files"}
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
                "query": {"type": "string", "description": "Keyword or phrase to search for"},
                "directory": {"type": "string", "description": "Directory to search in"},
            },
            "required": ["query", "directory"],
        },
    },
    {
        "name": "error_tracer",
        "description": (
            "Given a Node.js or Python error message or stack trace, find all relevant files "
            "across the codebase. Extracts file paths from the stack trace and searches for "
            "related identifiers. Use this when debugging crashes or runtime errors."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "error_message": {"type": "string", "description": "The full error message or stack trace text"},
                "directory": {"type": "string", "description": "Codebase root directory to search in"},
            },
            "required": ["error_message", "directory"],
        },
    },
    {
        "name": "explain_route",
        "description": (
            "Given an Express API route path (e.g. /api/users/login), trace the full request chain: "
            "route definition → controller → service → model. "
            "Use this to understand how a specific endpoint works end-to-end."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "route_path": {"type": "string", "description": "Express route path, e.g. /api/users/login"},
                "directory": {"type": "string", "description": "Codebase root directory to search in"},
            },
            "required": ["route_path", "directory"],
        },
    },
]
