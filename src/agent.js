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
import { secretScannerDefinition,    secretScanner    } from './tools/secretScanner.js';
import { depUpdaterDefinition,       depUpdater       } from './tools/depUpdater.js';

const client = new BedrockRuntimeClient({
  region: config.awsRegion,
  credentials: {
    accessKeyId:     config.awsAccessKeyId,
    secretAccessKey: config.awsSecretAccessKey,
  },
});

// ---------------------------------------------------------------------------
// Tool registry — 26 tools
// ---------------------------------------------------------------------------

export const ALL_TOOLS = {
  definitions: [
    // Exploration
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
    // Security + deps
    secretScannerDefinition,
    depUpdaterDefinition,
    // Fix pipeline
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
    secret_scanner:   secretScanner,
    dep_updater:      depUpdater,
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
- recall_session   — files read + changes made this session

### Analysis — read-only, safe at any time
- health_check     — quick codebase snapshot
- full_scan        — runs ALL maintenance checks in parallel
- trace_error      — paste a stack trace → reads every file in the trace
- fix_error        — PREFERRED for fixing bugs. Returns confidence score + pipeline steps.
- map_dependencies — outgoing + incoming import graph for any file
- explain_route    — route path → traces router → middleware → controller → service
- find_todos       — TODO/FIXME/HACK/BUG scan with severity classification
- check_env_usage  — .env.example vs process.env calls diff
- detect_dead_code — files with zero importers
- schema_to_api    — CRUD completeness check for any Mongoose model
- summarize_diff   — git diff (staged / unstaged / branch comparison)
- git_log          — commit history with filters
- lint_file        — ESLint structured results
- db_query         — read-only queries (SSM tunnel required)
- secret_scanner   — scan for accidentally committed API keys, tokens, passwords
- dep_updater      — check outdated npm packages, categorise by risk (patch/minor/major)

### Write + verification — always follow this exact sequence
1. git_backup   — checkpoint first, every time
2. show_diff    — preview the change
3. write_file   — write with human approval gate
4. run_command  — verify (e.g. npm test)

## Decision trees

**"Fix X" / error / stack trace**
→ fix_error(error_text) → if confidence ≥ 55: git_backup → show_diff → write_file → run_command

**"Any secrets leaked?" / security audit**
→ secret_scanner → report findings with file:line citations

**"Check dependencies" / "any outdated packages"**
→ dep_updater → show by risk, give safe_update_command for patches

**"Explain X" / "How does Y work"**
→ read_file(Y) → map_dependencies(Y) if cross-file

**"What’s wrong" / maintenance report**
→ full_scan

## Confidence score (from fix_error)
Always show: Confidence: 87/100 — HIGH — likely a targeted fix
If < 55, ask user to confirm before git_backup.

## Tool budget
Maximum 8 tool calls per user query. If you need more, stop and ask the user to narrow scope.

## What NOT to do
- User asks "what is the Track model?" → DO NOT call read_file. Use search_code or answer from knowledge.
- User asks "full scan" → DO NOT call individual tools. Call full_scan once.
- User pastes a stack trace → Pick fix_error OR trace_error. Never both.
- write_file without git_backup + show_diff first → NEVER.
- Re-read a file mid-conversation → Check recall_session first.

## Behaviour rules
- Never guess at code — read the file first. Always cite path:lineNumber.
- For any write: git_backup → show_diff → write_file. Never skip.
- Prefer minimal targeted edits over large rewrites.
- db_query is for schema inspection only.

## Response format
- Lead with the answer.
- Cite every code reference as path/to/file:lineNumber.
- Use fenced code blocks with language tag.
- After write_file: state exactly what changed, suggest run_command to verify.`;

const SYSTEM_BLOCKS = config.enablePromptCache
  ? [{ text: SYSTEM_PROMPT }, { cachePoint: { type: 'default' } }]
  : [{ text: SYSTEM_PROMPT }];

// ---------------------------------------------------------------------------
// Agent loop
// ---------------------------------------------------------------------------

async function executeTool(name, input, executors, user = 'unknown', approvalFn = null, commandApprovalFn = null, sessionId = 'default') {
  const fn = executors[name];
  if (!fn) {
    return {
      error:      `Tool "${name}" is not available for this task type.`,
      suggestion: `Available: ${Object.keys(executors).join(', ')}`,
    };
  }
  const extra = { _user: user, _sessionId: sessionId };
  if (name === 'write_file'  && approvalFn)        extra._approvalFn        = approvalFn;
  if (name === 'run_command' && commandApprovalFn)  extra._commandApprovalFn = commandApprovalFn;
  const result  = await fn({ ...input, ...extra });
  const summary = result?.error
    ? `error: ${result.error}`
    : result?.total ?? result?.file_path ?? result?.message ?? result?.summary ?? 'ok';
  recordToolCall(name, input, String(summary), sessionId);
  return result;
}

export async function runAgent(userQuestion, conversationHistory = [], tools = null, onEvent = null, user = 'unknown', approvalFn = null, commandApprovalFn = null, sessionId = 'default') {
  const { definitions, executors } = tools ?? ALL_TOOLS;
  const bedrockTools = toBedrockTools(definitions);

  const messages = [
    ...conversationHistory,
    { role: 'user', content: userQuestion },
  ];

  console.log('\n  Thinking...\n');

  let toolCallsThisTurn = 0;
  const TOOL_BUDGET = 8;
  const seenCalls = new Set(); // dedup: skip identical name+input pairs

  async function callBedrock(msgs, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.bedrockTimeoutMs);
      try {
        const result = await client.send(new ConverseCommand({
          modelId:         config.model,
          system:          SYSTEM_BLOCKS,
          messages:        toBedrockMessages(msgs),
          toolConfig:      { tools: bedrockTools },
          inferenceConfig: { maxTokens: config.maxTokens },
        }), { abortSignal: controller.signal });
        clearTimeout(timer);
        return result;
      } catch (err) {
        clearTimeout(timer);
        if (err.name === 'AbortError') throw new Error(`Bedrock call timed out after ${config.bedrockTimeoutMs}ms`);
        const isThrottle = err.name === 'ThrottlingException' || err.$metadata?.httpStatusCode === 429;
        const isTransient = isThrottle || err.name === 'ServiceUnavailableException';
        if (isTransient && attempt < retries) {
          const delay = Math.pow(2, attempt) * 1000;
          console.warn(`[Agent] Bedrock ${err.name} — retry ${attempt}/${retries} in ${delay}ms`);
          await new Promise(r => setTimeout(r, delay));
        } else {
          throw err;
        }
      }
    }
  }

  while (true) {
    const response = await callBedrock(messages);

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
      const toolCalls   = assistantContent.filter((b) => b.type === 'tool_use');
      const toolResults = [];

      toolCallsThisTurn += toolCalls.length;
      if (toolCallsThisTurn > TOOL_BUDGET) {
        const budgetMsg = `Tool budget exceeded (${toolCallsThisTurn}/${TOOL_BUDGET}). Stopping to avoid runaway execution. Please narrow your question.`;
        onEvent?.({ type: 'tool_budget_exceeded', count: toolCallsThisTurn, budget: TOOL_BUDGET });
        return { answer: budgetMsg, messages };
      }

      for (const call of toolCalls) {
        const callKey = `${call.name}:${JSON.stringify(call.input)}`;
        if (seenCalls.has(callKey)) {
          console.log(`  Skipping duplicate: ${call.name}`);
          toolResults.push({
            type:        'tool_result',
            tool_use_id: call.id,
            content:     JSON.stringify({ message: '[duplicate] Result already returned for identical call this turn.' }),
          });
          continue;
        }
        seenCalls.add(callKey);

        console.log(`  Using: ${call.name}`);
        if (call.input && Object.keys(call.input).length) {
          const args = Object.entries(call.input).map(([k, v]) => `${k}="${v}"`).join(', ');
          console.log(`    ${args}`);
        }
        onEvent?.({ type: 'tool_call', name: call.name, input: call.input });
        const result = await executeTool(call.name, call.input, executors, user, approvalFn, commandApprovalFn, sessionId);
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
