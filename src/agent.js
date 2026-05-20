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

const client = new BedrockRuntimeClient({
  region: config.awsRegion,
  credentials: {
    accessKeyId: config.awsAccessKeyId,
    secretAccessKey: config.awsSecretAccessKey,
  },
});

// ---------------------------------------------------------------------------
// Tool registry — add new tools here; dispatcher spreads from this.
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
    // Write + verification (require approval/backup)
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
    show_diff:        showDiff,
    git_backup:       gitBackup,
    write_file:       writeFile,
    run_command:      runCommand,
  },
};

// ---------------------------------------------------------------------------
// Bedrock helpers
// ---------------------------------------------------------------------------

function toBedrockTools(definitions) {
  return definitions.map((def) => ({
    toolSpec: {
      name: def.name,
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
      if (block.type === 'tool_use')    return { toolUse: { toolUseId: block.id,        name: block.name,  input: block.input } };
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

## Tools available to you
### Exploration
- list_files        — directory tree
- read_file         — file content + auto-import resolution (depth 2)
- search_code       — keyword search across codebase
- recall_session    — what you already read/changed this session (check before re-reading)

### Analysis (read-only, safe anytime)
- trace_error       — paste stack trace → auto-reads all involved files
- map_dependencies  — outgoing/incoming import graph for a file or directory
- explain_route     — route path → router → middleware → controller → service
- find_todos        — scan for TODO/FIXME/HACK/DEPRECATED/BUG with severity
- check_env_usage   — diff .env.example vs process.env usage in code
- detect_dead_code  — find files with zero importers (orphaned code)
- schema_to_api     — check CRUD completeness for a Mongoose model
- summarize_diff    — git diff output for staged/unstaged/branch changes

### Write + verification (always follow the sequence below)
- git_backup        — create a timestamped backup branch BEFORE any write
- show_diff         — show what will change BEFORE writing
- write_file        — apply change (prompts user for approval at runtime)
- run_command       — verify fix (npm test, git status, etc.)

## Mandatory write sequence
1. git_backup   — never skip, even for small changes
2. show_diff    — user must see the change before it lands
3. write_file   — has built-in approval gate
4. run_command("npm test") — confirm nothing broke

## Rules
- Check recall_session before re-reading a file you likely already read this turn.
- Always cite file path and line number when discussing code.
- Never guess — if unsure, read the file first.
- Be direct and practical, like a senior dev on the team.`;

// ---------------------------------------------------------------------------
// Agent loop
// ---------------------------------------------------------------------------

async function executeTool(name, input, executors) {
  const fn = executors[name];
  if (!fn) {
    return {
      error: `Tool "${name}" is not available for this task type.`,
      suggestion: `Available: ${Object.keys(executors).join(', ')}`,
    };
  }
  const result = await fn(input);

  // Record in session log — store a lightweight summary, not the full result.
  const summary = result?.error
    ? `error: ${result.error}`
    : result?.file_path ?? result?.keyword ?? result?.total ?? result?.message ?? 'ok';
  recordToolCall(name, input, String(summary));

  return result;
}

// tools: { definitions, executors } — injected by dispatcher for scoped access.
export async function runAgent(userQuestion, conversationHistory = [], tools = null) {
  const { definitions, executors } = tools ?? ALL_TOOLS;
  const bedrockTools = toBedrockTools(definitions);

  const messages = [
    ...conversationHistory,
    { role: 'user', content: userQuestion },
  ];

  console.log('\n  Thinking...\n');

  while (true) {
    const response = await client.send(new ConverseCommand({
      modelId: config.model,
      system: [{ text: SYSTEM_PROMPT }],
      messages: toBedrockMessages(messages),
      toolConfig: { tools: bedrockTools },
      inferenceConfig: { maxTokens: config.maxTokens },
    }));

    const stopReason    = response.stopReason;
    const outputBlocks  = response.output?.message?.content ?? [];

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
      const toolCalls = assistantContent.filter((b) => b.type === 'tool_use');
      const toolResults = [];

      for (const call of toolCalls) {
        console.log(`  Using: ${call.name}`);
        if (call.input && Object.keys(call.input).length) {
          const args = Object.entries(call.input).map(([k, v]) => `${k}="${v}"`).join(', ');
          console.log(`    ${args}`);
        }

        const result = await executeTool(call.name, call.input, executors);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: call.id,
          content: JSON.stringify(result),
        });
      }

      messages.push({ role: 'user', content: toolResults });
    }
  }
}
