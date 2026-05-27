import { ALL_TOOLS } from './agent.js';

// ---------------------------------------------------------------------------
// Classification — multi-keyword scoring, highest wins
// ---------------------------------------------------------------------------

const PATTERNS = [
  {
    type: 'review',
    re: /\b(review|audit|check quality|inspect|analyze|code smell|security|secret|leaked|find todos|dead code|env usage|schema gap|health|full.?scan|maintenance scan|scan|outdated|dependencies)\b/gi,
  },
  {
    type: 'maintenance',
    re: /\b(fix|bug|revert|update dependency|refactor|clean up|rename|remove|delete|patch|migrate|deprecat|error|exception|crash|trace|stack trace)\b/gi,
  },
  {
    type: 'feature',
    re: /\b(add|create|build|implement|new route|new component|new endpoint|new page|new feature|scaffold)\b/gi,
  },
  {
    type: 'query',
    re: /\b(why|explain|what does|how does|describe|what is|where is|show me|walk me|tell me|map|route|diff|todo|log|lint|query|select)\b/gi,
  },
];

// Lower number = lower precedence when scores tie.
const TYPE_PRIORITY = { query: 0, review: 1, maintenance: 2, feature: 2 };

export function classify(input) {
  const scores = {};
  for (const { type, re } of PATTERNS) {
    const matches = (input.match(re) ?? []).length;
    if (matches > 0) scores[type] = (scores[type] ?? 0) + matches;
  }

  if (Object.keys(scores).length === 0) return 'query';

  // Pick highest score; on tie prefer the higher-priority type.
  return Object.entries(scores).reduce((best, [type, score]) => {
    const [bestType, bestScore] = best;
    if (score > bestScore) return [type, score];
    if (score === bestScore && TYPE_PRIORITY[type] > TYPE_PRIORITY[bestType]) return [type, score];
    return best;
  }, ['query', 0])[0];
}

// ---------------------------------------------------------------------------
// Tool scopes
// ---------------------------------------------------------------------------

const READ_ONLY = new Set([
  'list_files', 'read_file', 'search_code', 'recall_session',
  'trace_error', 'map_dependencies', 'explain_route',
  'find_todos', 'check_env_usage', 'detect_dead_code', 'schema_to_api',
  'summarize_diff', 'git_log', 'health_check', 'lint_file', 'db_query',
  'full_scan', 'secret_scanner', 'dep_updater',
]);

const REVIEW_EXTRA = new Set([...READ_ONLY, 'show_diff', 'fix_error']);

const WRITE = new Set([...REVIEW_EXTRA, 'git_backup', 'write_file', 'run_command']);

function scopeTools(allowedNames) {
  return {
    definitions: ALL_TOOLS.definitions.filter(d => allowedNames.has(d.name)),
    executors:   Object.fromEntries(
      Object.entries(ALL_TOOLS.executors).filter(([k]) => allowedNames.has(k))
    ),
  };
}

// feature and maintenance share identical tool access — no duplication.
const WRITE_SCOPE = scopeTools(WRITE);

const TOOL_SETS = {
  query:       scopeTools(READ_ONLY),
  review:      scopeTools(REVIEW_EXTRA),
  maintenance: WRITE_SCOPE,
  feature:     WRITE_SCOPE,
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
