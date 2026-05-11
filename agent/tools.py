import os
import glob
from pathlib import Path

SUPPORTED_EXTENSIONS = {".py", ".js", ".ts", ".jsx", ".tsx", ".go", ".java", ".rb", ".php", ".cs"}


def read_file(filepath: str) -> str:
    with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
        return f.read()


def list_files(root_dir: str) -> list[str]:
    files = []
    for ext in SUPPORTED_EXTENSIONS:
        files.extend(glob.glob(f"{root_dir}/**/*{ext}", recursive=True))
    return sorted(files)


def get_file_summary(root_dir: str) -> dict:
    files = list_files(root_dir)
    languages = {}
    for f in files:
        ext = Path(f).suffix
        languages[ext] = languages.get(ext, 0) + 1
    return {
        "file_count": len(files),
        "languages": languages,
        "files": files,
    }


def search_codebase(root_dir: str, query: str) -> list[dict]:
    """Search for files/content matching a query string."""
    results = []
    files = list_files(root_dir)
    query_lower = query.lower()
    for filepath in files:
        try:
            content = read_file(filepath)
            if query_lower in content.lower():
                # Find matching lines
                matching_lines = [
                    {"line": i + 1, "content": line.strip()}
                    for i, line in enumerate(content.splitlines())
                    if query_lower in line.lower()
                ]
                results.append({"file": filepath, "matches": matching_lines[:5]})
        except Exception:
            continue
    return results
