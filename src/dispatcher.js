import { ALL_TOOLS } from './agent.js';

// ---------------------------------------------------------------------------
// Classification — multi-keyword scoring, highest wins
// ---------------------------------------------------------------------------

const PATTERNS = [
  {
    type: 'review',
    keywords: /\b(review|audit|check quality|inspect|analyze|code smell|security|secret|leaked|find todos|dead code|env usage|schema gap|health|full.?scan|maintenance scan|scan|outdated|dependencies)\b/i,
  },
  {
    type: 'maintenance',
    // "update" added — "update dependency/config/handler" should get write tools
    keywords: /\b(fix|bug|revert|update|refactor|clean up|rename|remove|delete|patch|migrate|deprecat|error|exception|crash|trace|stack trace)\b/i,
  },
  {
    type: 'feature',
    keywords: /\b(add|create|build|implement|new route|new component|new endpoint|new page|new feature|scaffold)\b/i,
  },
  {
    type: 'query',
    keywords: /\b(why|explain|what does|how does|describe|what is|where is|show me|walk me|tell me|map|route|diff|todo|log|lint|query|select)\b/i,
  },
];

// Lower number = lower precedence when scores tie.
const TYPE_PRIORITY = { query: 0, review: 1, maintenance: 2, feature: 2 };

export function classify(input) {
  const scores = {};
  for (const { type, keywords } of PATTERNS) {
    // Build a fresh regex each call — avoids lastIndex state bleed from /g flag
    const re = new RegExp(keywords.source, 'gi');
    const matches = (input.match(re) ?? []).length;
    if (matches > 0) scores[type] = (scores[type] ?? 0) + matches;
  }

  if (Object.keys(scores).length === 0) {
    return { type: 'query', confidence: 0, scores: {} };
  }

  const [type] = Object.entries(scores).reduce((best, [type, score]) => {
    const [bestType, bestScore] = best;
    if (score > bestScore) return [type, score];
    if (score === bestScore && TYPE_PRIORITY[type] > TYPE_PRIORITY[bestType]) return [type, score];
    return best;
  }, ['query', 0]);

  const total = Object.values(scores).reduce((s, v) => s + v, 0);
  const confidence = total === 0 ? 0 : Math.round((scores[type] / total) * 100);

  return { type, confidence, scores };
}

export function formatClassification({ type, confidence, scores }) {
  const label = TASK_LABELS[type] ?? type;
  const scoreStr = Object.entries(scores)
    .map(([t, s]) => `${t}:${s}`)
    .join(' ');
  return `  [${label}] confidence: ${confidence}% (${scoreStr || 'no keywords'})`;
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

const WRITE = new Set([...REVIEW_EXTRA, 'git_backup', 'write_file', 'branch_write', 'run_command']);

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
