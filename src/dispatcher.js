import { ALL_TOOLS } from './agent.js';

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

const PATTERNS = [
  { type: 'review',      re: /\b(review|audit|check quality|inspect|analyze|code smell|security check|find todos|dead code|env usage|schema gap)\b/i },
  { type: 'maintenance', re: /\b(fix|bug|revert|update dependency|refactor|clean up|rename|remove|delete|patch|migrate|deprecat)\b/i },
  { type: 'feature',     re: /\b(add|create|build|implement|new route|new component|new endpoint|new page|new feature|scaffold)\b/i },
  { type: 'query',       re: /\b(why|explain|what does|how does|describe|what is|where is|show me|walk me|tell me|trace|map|route|diff|todo)\b/i },
];

export function classify(input) {
  for (const { type, re } of PATTERNS) {
    if (re.test(input)) return type;
  }
  return 'query';
}

// ---------------------------------------------------------------------------
// Tool scopes — pick subsets of ALL_TOOLS by name.
// Keeps dispatcher lean: just an allowlist, no repeated imports.
// ---------------------------------------------------------------------------

const READ_ONLY = new Set([
  'list_files', 'read_file', 'search_code', 'recall_session',
  'trace_error', 'map_dependencies', 'explain_route',
  'find_todos', 'check_env_usage', 'detect_dead_code', 'schema_to_api', 'summarize_diff',
]);

const REVIEW_EXTRA = new Set([...READ_ONLY, 'show_diff']);

const WRITE = new Set([...REVIEW_EXTRA, 'git_backup', 'write_file', 'run_command']);

function scopeTools(allowedNames) {
  return {
    definitions: ALL_TOOLS.definitions.filter(d => allowedNames.has(d.name)),
    executors:   Object.fromEntries(
      Object.entries(ALL_TOOLS.executors).filter(([k]) => allowedNames.has(k))
    ),
  };
}

const TOOL_SETS = {
  query:       scopeTools(READ_ONLY),
  review:      scopeTools(REVIEW_EXTRA),
  maintenance: scopeTools(WRITE),
  feature:     scopeTools(WRITE),
};

export function getTools(taskType) {
  return TOOL_SETS[taskType] ?? TOOL_SETS.query;
}

export const TASK_LABELS = {
  query:       'Query',
  maintenance: 'Maintenance',
  feature:     'Feature',
  review:      'Review',
};
