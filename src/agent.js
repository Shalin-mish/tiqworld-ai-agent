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
import { fixErrorDefinition,         fixError         } from './tools/fixError.js';

const client = new BedrockRuntimeClient({
  region: config.awsRegion,
  credentials: {
    accessKeyId:     config.awsAccessKeyId,
    secretAccessKey: config.awsSecretAccessKey,
  },
});

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

export const ALL_TOOLS = {
  definitions: [
    // Read-only exploration
    listFilesDefinition,
    readFileDefinition,
    searchCodeDefinition,
    recallSessionDefinition,
    // Analysis
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
    // Diagnosis + fix pipeline
    fixErrorDefinition,
    // Write + verification
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
    fix_error:        fixError,
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

## Tool groups

### Exploration
- list_files       — directory tree by glob pattern
- read_file        — file contents with auto-import resolution (depth 2)
- search_code      — regex keyword search across entire codebase
- recall_session   — files read + changes made this session (check before re-reading a file mid-conversation)

### Analysis — read-only, safe at any time
- health_check     — quick codebase snapshot: file counts, todos, env gaps, git status
- full_scan        — runs ALL maintenance checks in parallel. Use for "full scan" or "maintenance report" only.
- trace_error      — paste a stack trace → automatically reads every file in the trace
- fix_error        — PREFERRED over trace_error when goal is to FIX a bug. Returns confidence score + pipeline steps.
- map_dependencies — outgoing + incoming import graph for any file
- explain_route    — route path → traces router → middleware → controller → service in sequence
- find_todos       — TODO/FIXME/HACK/BUG scan with severity classification
- check_env_usage  — .env.example vs process.env calls diff
- detect_dead_code — files with zero importers across the whole codebase
- schema_to_api    — CRUD completeness check for any Mongoose model
- summarize_diff   — git diff (staged / unstaged / branch comparison)
- git_log          — commit history with file, author, date filters
- lint_file        — ESLint structured results for a file or directory
- db_query         — read-only queries (SSM tunnel required on localhost:5433)

### Write + verification — always follow this exact sequence
1. git_backup   — create a checkpoint first, every time, no exceptions
2. show_diff    — preview the exact change before writing
3. write_file   — write with human approval gate
4. run_command  — verify the fix works (e.g. npm test)

## Decision trees

**"Fix X" / error / stack trace provided**
→ fix_error(error_text) — returns diagnosis + confidence score + pipeline steps
→ if confidence ≥ 55: git_backup → show_diff → write_file → run_command
→ if confidence < 55: share diagnosis, ask user to confirm file before writing

**"Explain X" / "How does Y work"**
→ read_file(Y) → map_dependencies(Y) if cross-file → explain_route if API route

**"What\'s wrong with the codebase" / maintenance report**
→ full_scan

**"Review this file" / "Is this code correct"**
→ read_file → lint_file → find_todos → answer with line citations

**"Add a feature to Z"**
→ map_dependencies(Z) first → read affected files → git_backup → show_diff → write_file

## Confidence score (from fix_error)
Always show the score when reporting a fix diagnosis:
  Confidence: 87/100 — HIGH — likely a targeted fix
If score < 55, say so clearly and ask the user to confirm before proceeding with git_backup.

## Tool budget
Maximum 5 tool calls per user query. If you need more, stop and ask the user to clarify or narrow scope. Never silently call 6+ tools on a single question — it bloats context and slows response.

## What NOT to do — negative examples
- User asks "what is the Track model?" → DO NOT call read_file. Answer from codebase knowledge or call search_code with a narrow regex. read_file is for when you need the full file content to answer.
- User asks "what files are in the backend?" → DO NOT call full_scan. Call list_files with the right glob.
- User pastes a stack trace → DO NOT call trace_error AND fix_error. Pick fix_error if the goal is to fix it. trace_error is only for diagnosis-only tasks.
- User asks to "fix the null check" → DO NOT write_file without git_backup + show_diff first. Always.
- User is mid-conversation about a file you already read → DO NOT re-read it. Check recall_session first.

## Behaviour rules
- Never guess at code — read the file first. Always cite path:lineNumber.
- check recall_session before re-reading a file mid-conversation.
- For any write: git_backup → show_diff → write_file. Never skip or reorder.
- Prefer minimal targeted edits over large rewrites.
- If a tool returns an error, try a narrower input before giving up.
- When map_dependencies shows a file is imported by many others, warn before editing.
- db_query is for schema inspection only.

## Response format
- Lead with the answer, not a preamble.
- Cite every code reference as path/to/file:lineNumber.
- Use fenced code blocks with language tag.
- When fix_error is used: show confidence_score + confidence_label before the fix.
- After write_file completes: state exactly what changed and suggest run_command to verify.`;

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

export async function runAgent(userQuestion, conversationHistory = [], tools = null, onEvent = null, user = 'unknown', approvalFn = null, commandApprovalFn = null) {
  const { definitions, executors } = tools ?? ALL_TOOLS;
  const bedrockTools = toBedrockTools(definitions);

  const messages = [
    ...conversationHistory,
    { role: 'user', content: userQuestion },
  ];

  console.log('\n  Thinking...\n');

  let toolCallsThisTurn = 0;
  const TOOL_BUDGET = 8; // server-side safety net; prompt enforces 5

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

      // Enforce tool budget
      toolCallsThisTurn += toolCalls.length;
      if (toolCallsThisTurn > TOOL_BUDGET) {
        const budgetMsg = `Tool budget exceeded (${toolCallsThisTurn}/${TOOL_BUDGET}). Stopping tool loop to avoid runaway execution. Please narrow your question.`;
        onEvent?.({ type: 'tool_budget_exceeded', count: toolCallsThisTurn, budget: TOOL_BUDGET });
        return { answer: budgetMsg, messages };
      }

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
