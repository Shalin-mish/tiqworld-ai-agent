import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { config } from './config.js';
import { listFilesDefinition, listFiles } from './tools/listFiles.js';
import { readFileDefinition, readFile } from './tools/readFile.js';
import { searchCodeDefinition, searchCode } from './tools/searchCode.js';
import { writeFileDefinition, writeFile } from './tools/writeFile.js';
import { runCommandDefinition, runCommand } from './tools/runCommand.js';
import { showDiffDefinition, showDiff } from './tools/showDiff.js';

const client = new BedrockRuntimeClient({
  region: config.awsRegion,
  credentials: {
    accessKeyId: config.awsAccessKeyId,
    secretAccessKey: config.awsSecretAccessKey,
  },
});

// Convert Anthropic tool format → Bedrock Converse format
function toBedrockTools(definitions) {
  return definitions.map((def) => ({
    toolSpec: {
      name: def.name,
      description: def.description,
      inputSchema: { json: def.input_schema },
    },
  }));
}

const toolDefinitions = [
  listFilesDefinition,
  readFileDefinition,
  searchCodeDefinition,
  writeFileDefinition,
  runCommandDefinition,
  showDiffDefinition,
];

const bedrockTools = toBedrockTools(toolDefinitions);

async function executeTool(toolName, toolInput) {
  switch (toolName) {
    case 'list_files':    return listFiles(toolInput);
    case 'read_file':     return readFile(toolInput);
    case 'search_code':   return searchCode(toolInput);
    case 'write_file':    return await writeFile(toolInput);
    case 'run_command':   return runCommand(toolInput);
    case 'show_diff':     return showDiff(toolInput);
    default:
      return {
        error: `Unknown tool: ${toolName}`,
        suggestion: 'Available tools: list_files, read_file, search_code, write_file, run_command',
      };
  }
}

const SYSTEM_PROMPT = `You are an expert AI developer and tech team member working on the TIQ World project — an Intern Training & Assessment Platform built with the MERN stack.

The codebase structure:
- backend/ — Node.js + Express + MongoDB (ES modules)
  - src/controllers/ — request handlers
  - src/models/ — Mongoose schemas
  - src/routes/ — API route definitions
  - src/services/ — business logic (AI assessment, roadmap generation)
  - src/middleware/ — auth, CSRF, error handling
  - src/validation/ — Zod schemas
- frontend/ — React 18 + Vite + Tailwind CSS
  - src/pages/ — LoginPage, SignupPage, AdminDashboard, InternDashboard
  - src/components/ — reusable UI components
  - src/services/api/ — API client calls
  - src/state/ — React Context auth state

Key features already built:
- JWT auth with RBAC (ADMIN / INTERN roles)
- Training Tracks → Modules → Tasks hierarchy
- Intern submissions with GitHub URL + notes
- AI-powered roadmap generation (OpenAI-compatible)
- AI assessment (score 1-5, feedback, suggestions)
- Certificate issuance

Your job:
- Answer questions about how the code works
- Find bugs and explain them clearly with file path and line number
- Suggest improvements with concrete code examples
- Review code quality, security, and best practices
- Apply fixes using write_file (always shows diff + requires user approval before writing)
- Verify fixes using run_command (npm test, git status, etc.)

Rules:
- Always reference specific file paths and line numbers
- Be direct and practical — like a senior developer on the team
- If you need to read a file before answering, use the tools
- Never guess — if unsure, read the file first`;

// Convert Anthropic-style messages → Bedrock Converse format
function toBedrockMessages(messages) {
  return messages.map((msg) => {
    if (typeof msg.content === 'string') {
      return { role: msg.role, content: [{ text: msg.content }] };
    }

    const content = msg.content.map((block) => {
      if (block.type === 'text')      return { text: block.text };
      if (block.type === 'tool_use')  return { toolUse: { toolUseId: block.id, name: block.name, input: block.input } };
      if (block.type === 'tool_result') return { toolResult: { toolUseId: block.tool_use_id, content: [{ text: block.content }] } };
      return { text: JSON.stringify(block) };
    });

    return { role: msg.role, content };
  });
}

export async function runAgent(userQuestion, conversationHistory = []) {
  const messages = [
    ...conversationHistory,
    { role: 'user', content: userQuestion },
  ];

  console.log('\n🔍 Agent thinking...\n');

  while (true) {
    const response = await client.send(new ConverseCommand({
      modelId: config.model,
      system: [{ text: SYSTEM_PROMPT }],
      messages: toBedrockMessages(messages),
      toolConfig: { tools: bedrockTools },
      inferenceConfig: { maxTokens: config.maxTokens },
    }));

    const stopReason = response.stopReason;
    const outputBlocks = response.output?.message?.content ?? [];

    // Store assistant response in Anthropic format for history
    const assistantContent = outputBlocks.map((block) => {
      if (block.text)    return { type: 'text', text: block.text };
      if (block.toolUse) return { type: 'tool_use', id: block.toolUse.toolUseId, name: block.toolUse.name, input: block.toolUse.input };
      return { type: 'text', text: JSON.stringify(block) };
    });
    messages.push({ role: 'assistant', content: assistantContent });

    if (stopReason === 'end_turn') {
      const textBlock = assistantContent.find((b) => b.type === 'text');
      return {
        answer: textBlock ? textBlock.text : 'No response generated.',
        messages,
      };
    }

    if (stopReason === 'tool_use') {
      const toolUseBlocks = assistantContent.filter((b) => b.type === 'tool_use');
      const toolResults = [];

      for (const toolCall of toolUseBlocks) {
        console.log(`  📂 Using tool: ${toolCall.name}`);
        if (toolCall.input && Object.keys(toolCall.input).length > 0) {
          const inputStr = Object.entries(toolCall.input)
            .map(([k, v]) => `${k}="${v}"`)
            .join(', ');
          console.log(`     → ${inputStr}`);
        }

        const result = await executeTool(toolCall.name, toolCall.input);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }

      messages.push({ role: 'user', content: toolResults });
    }
  }
}
