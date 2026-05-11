import os

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
MODEL = "claude-sonnet-4-6"
MAX_TOKENS = 4096

# Files/dirs to exclude from analysis
EXCLUDE_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv", "dist", "build"}
EXCLUDE_FILES = {".env", ".env.local"}

# Max file size to read (in bytes) — skip very large files
MAX_FILE_SIZE = 100_000

SUPPORTED_EXTENSIONS = {".py", ".js", ".ts", ".jsx", ".tsx", ".go", ".java", ".rb", ".php", ".cs"}
