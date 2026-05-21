import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { config } from './config.js';
import { recordToolCall } from './session.js';

import { listFilesDefinition,        listFiles        } from './tools/listFiles.js';
import { readFileDefinition,         readFile         } from './tools/readFile.js';
import { searchCodeDefinition,       searchCode       } from './tools/searchCode.js';
import { writeFileDefinition,        writeFile        } from './tools/writeFile.js';
import { runCommandDefinition,       runCommand       } from './tools/runCommand.js';
import { showDiffDefinition,         showDiff         } from './tools/showDiff.js';
import { gitBackupDefinition,        gitBackup        } from './tools/gitBackup.js';
import { traceErrorDefinition,       traceError       } from './tools/traceError.js';
import { mapDependenciesDefinition,  mapDependencies  } from './tools/mapDependencies.js';
import { explainRouteDefinition,     explainRoute     } from './tools/explainRoute.js';
import { findTodosDefinition,        findTodos        } from './tools/findTodos.js';
import { checkEnvUsageDefinition,    checkEnvUsage    } from './tools/checkEnvUsage.js';
import { summarizeDiffDefinition,    summarizeDiff    } from './tools/summarizeDiff.js';
import { detectDeadCodeDefinition,   detectDeadCode   } from './tools/detectDeadCode.js';
import { schemaToApiDefinition,      schemaToApi      } from './tools/schemaToApi.js';
import { recallSessionDefinition,    recallSession    } from './tools/recallSession.js';
import { gitLogDefinition,           gitLog           } from './tools/gitLog.js';
import { healthCheckDefinition,      healthCheck      } from './tools/healthCheck.js';
import { lintFileDefinition,         lintFile         } from './tools/lintFile.js';
import { dbQueryDefinition,          dbQuery          } from './tools/dbQuery.js';
import { fullScanDefinition,         fullScan         } from './tools/fullScan.js';

const client = new BedrockRuntimeClient({
  region: config.awsRegion,
  credentials: {
    accessKeyId:     config.awsAccessKeyId,
    secretAccessKey: config.awsSecretAccessKey,
  },
});

// ---------------------------------------------------------------------------
// Tool registry — add new tools here; dispatcher filters from this.
// ---------------------------------------------------------------------------

export const ALL_TOOLS = {
  definitions: [
    // Read-only exploration
    listFilesDefinition,
    readFileDefinition,
    searchCodeDefinition,
    recallSessionDefinition,
    // Analysis (read-only, no side-effects)
    traceErrorDefinition,
    mapDependenciesDefinition,
    explainRouteDefinition,
    findTodosDefinition,
    checkEnvUsageDefinition,
    detectDeadCodeDefinition,
    schemaToApiDefinition,
    summarizeDiffDefinition,
    gitLogDefinition,
    healthCheckDefinition,
    lintFileDefinition,
    dbQueryDefinition,
    fullScanDefinition,
    // Write + verification (require approval / backup)
    showDiffDefinition,
    gitBackupDefinition,
    writeFileDefinition,
    runCommandDefinition,
  ],
  executors: {
    list_files:       listFiles,
    read_file:        readFile,
    search_code:      searchCode,
    recall_session:   recallSession,
    trace_error:      traceError,
    map_dependencies: mapDependencies,
    explain_route:    explainRoute,
    find_todos:       findTodos,
    check_env_usage:  checkEnvUsage,
    detect_dead_code: detectDeadCode,
    schema_to_api:    schemaToApi,
    summarize_diff:   summarizeDiff,
    git_log:          gitLog,
    health_check:     healthCheck,
    lint_file:        lintFile,
    db_query:         dbQuery,
    full_scan:        fullScan,
    show_diff:        showDiff,
    git_backup:       gitBackup,
    write_file:       writeFile,
    run_command:      runCommand,
  },
};

export const TOOL_COUNT = ALL_TOOLS.definitions.length;

// ---------------------------------------------------------------------------
// Bedrock helpers
// ---------------------------------------------------------------------------

function toBedrockTools(definitions) {
  return definitions.map((def) => ({
    toolSpec: {
      name:        def.name,
      description: def.description,
      inputSchema: { json: def.input_schema },
    },
  }));
}

function toBedrockMessages(messages) {
  return messages.map((msg) => {
    if (typeof msg.content === 'string') {
      return { role: msg.role, content: [{ text: msg.content }] };
    }

    const content = msg.content.map((block) => {
      if (block.type === 'text')        return { text: block.text };
      if (block.type === 'tool_use')    return { toolUse: { toolUseId: block.id, name: block.name, input: block.input } };
      if (block.type === 'tool_result') return { toolResult: { toolUseId: block.tool_use_id, content: [{ text: block.content }] } };
      return { text: JSON.stringify(block) };
    });

    return { role: msg.role, content };
  });
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are an expert AI developer embedded in the TIQ World engineering team. TIQ World is an Intern Training & Assessment Platform built on the MERN stack.

## Codebase layout
- backend/  — Node.js + Express + MongoDB (ES modules)
  - src/controllers/  request handlers
  - src/models/       Mongoose schemas
  - src/routes/       API route definitions
  - src/services/     business logic (AI assessment, roadmap gen)
  - src/middleware/   auth, CSRF, error handling
  - src/validation/   Zod schemas
- frontend/ — React 18 + Vite + Tailwind CSS
  - src/pages/        LoginPage, SignupPage, AdminDashboard, InternDashboard
  - src/components/   reusable UI
  - src/services/api/ API client calls
  - src/state/        React Context auth state

## Features already built
JWT auth with RBAC (ADMIN / INTERN) · Training Tracks → Modules → Tasks hierarchy · Intern submissions (GitHub URL + notes) · AI roadmap generation · AI assessment (score 1-5, feedback) · Certificate issuance

## Tools available (21 total)
### Exploration
- list_files       — directory tree by glob pattern
- read_file        — file contents (auto-reads imports, depth 2 — check recall_session first)
- search_code      — regex keyword search across entire codebase
- recall_session   — everything read/changed this session; always check this before re-reading

### Analysis (read-only, safe anytime)
- health_check     — full codebase snapshot: file counts, todos, env gaps, git status
- trace_error      — paste a stack trace → agent reads every file in the trace automatically
- map_dependencies — outgoing + incoming import graph for any file
- explain_route    — route path → traces router → middleware → controller → service in sequence
- find_todos       — TODO/FIXME/HACK/BUG scan with severity classification
- check_env_usage  — .env.example vs process.env calls diff
- detect_dead_code — files with zero importers across the whole codebase
- schema_to_api    — CRUD completeness check for any Mongoose model
- summarize_diff   — git diff (staged / unstaged / branch comparison)
- git_log          — commit history with file, author, date filters
- lint_file        — ESLint structured results for a file or directory
- db_query         — read-only SQL (SSM tunnel required on localhost:5433). For schema/migration checks only — NOT for analytics (user counts, pass rates, etc.)
- full_scan        — orchestrates ALL maintenance checks in parallel: health + todos + env + dead code + lint + git log. Use for "full scan" or "maintenance report" requests.

### Write + verification (always follow this exact sequence)
1. git_backup   — create a checkpoint first, always
2. show_diff    — preview the change before writing
3. write_file   — write with human approval gate (user must approve in UI)
4. run_command  — verify fix works (npm test), also requires approval in web UI

## Behaviour rules
- Always check recall_session before re-reading a file you may have already read.
- Always run git_backup before any write_file call.
- Always run show_diff immediately before write_file so the user sees what changes.
- Never guess at code — read the file first, cite path + line number.
- When asked to "fix" something: read_file → search_code → show_diff → write_file sequence.
- When asked to "explain" something: read relevant files, trace imports, cite line numbers.
- db_query: dev/schema tasks only. Reject analytics questions (counts, rates, aggregates).
- For write operations, be conservative — prefer minimal targeted changes over large rewrites.`;

// cachePoint after the system prompt text tells Bedrock to cache this across turns.
// Saves ~60% token cost on long sessions. Opt-in via ENABLE_PROMPT_CACHE=true in .env.
const SYSTEM_BLOCKS = config.enablePromptCache
  ? [{ text: SYSTEM_PROMPT }, { cachePoint: { type: 'default' } }]
  : [{ text: SYSTEM_PROMPT }];

// ---------------------------------------------------------------------------
// Agent loop
// ---------------------------------------------------------------------------

async function executeTool(name, input, executors, user = 'unknown', approvalFn = null, commandApprovalFn = null) {
  const fn = executors[name];
  if (!fn) {
    return {
      error:      `Tool "${name}" is not available for this task type.`,
      suggestion: `Available: ${Object.keys(executors).join(', ')}`,
    };
  }
  const extra = { _user: user };
  if (name === 'write_file'  && approvalFn)        extra._approvalFn        = approvalFn;
  if (name === 'run_command' && commandApprovalFn)  extra._commandApprovalFn = commandApprovalFn;
  const result  = await fn({ ...input, ...extra });
  const summary = result?.error
    ? `error: ${result.error}`
    : result?.file_path ?? result?.keyword ?? result?.total ?? result?.message ?? 'ok';
  recordToolCall(name, input, String(summary));
  return result;
}

// onEvent: optional callback for streaming tool-use events to external consumers (web UI).
// Called with: { type: 'tool_call', name: string, input: object }
// CLI ignores it; web server uses it to push SSE events to the browser.
export async function runAgent(userQuestion, conversationHistory = [], tools = null, onEvent = null, user = 'unknown', approvalFn = null, commandApprovalFn = null) {
  const { definitions, executors } = tools ?? ALL_TOOLS;
  const bedrockTools = toBedrockTools(definitions);

  const messages = [
    ...conversationHistory,
    { role: 'user', content: userQuestion },
  ];

  console.log('\n  Thinking...\n');

  while (true) {
    const response = await client.send(new ConverseCommand({
      modelId:         config.model,
      system:          SYSTEM_BLOCKS,
      messages:        toBedrockMessages(messages),
      toolConfig:      { tools: bedrockTools },
      inferenceConfig: { maxTokens: config.maxTokens },
    }));

    const stopReason   = response.stopReason;
    const outputBlocks = response.output?.message?.content ?? [];

    const assistantContent = outputBlocks.map((block) => {
      if (block.text)    return { type: 'text',     text: block.text };
      if (block.toolUse) return { type: 'tool_use', id: block.toolUse.toolUseId, name: block.toolUse.name, input: block.toolUse.input };
      return { type: 'text', text: JSON.stringify(block) };
    });
    messages.push({ role: 'assistant', content: assistantContent });

    if (stopReason === 'end_turn') {
      const textBlock = assistantContent.find((b) => b.type === 'text');
      return { answer: textBlock?.text ?? 'No response generated.', messages };
    }

    if (stopReason === 'tool_use') {
      const toolCalls  = assistantContent.filter((b) => b.type === 'tool_use');
      const toolResults = [];

      for (const call of toolCalls) {
        console.log(`  Using: ${call.name}`);
        if (call.input && Object.keys(call.input).length) {
          const args = Object.entries(call.input).map(([k, v]) => `${k}="${v}"`).join(', ');
          console.log(`    ${args}`);
        }

        onEvent?.({ type: 'tool_call', name: call.name, input: call.input });

        const result = await executeTool(call.name, call.input, executors, user, approvalFn, commandApprovalFn);
        onEvent?.({ type: 'tool_result', name: call.name, result });
        toolResults.push({
          type:        'tool_result',
          tool_use_id: call.id,
          content:     JSON.stringify(result),
        });
      }

      messages.push({ role: 'user', content: toolResults });
    }
  }
}
