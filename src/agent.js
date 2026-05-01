import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';
import { listFilesDefinition, listFiles } from './tools/listFiles.js';
import { readFileDefinition, readFile } from './tools/readFile.js';
import { searchCodeDefinition, searchCode } from './tools/searchCode.js';

const client = new Anthropic({ apiKey: config.anthropicApiKey });

// All available tools
const toolDefinitions = [
  listFilesDefinition,
  readFileDefinition,
  searchCodeDefinition,
];

// Execute the tool Claude chose to call
function executeTool(toolName, toolInput) {
  switch (toolName) {
    case 'list_files':
      return listFiles(toolInput);
    case 'read_file':
      return readFile(toolInput);
    case 'search_code':
      return searchCode(toolInput);
    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

// System prompt — gives Claude the identity of a TIQ team member
const SYSTEM_PROMPT = `You are an expert AI developer and tech team member working on the TIQ World project — an Intern Training & Assessment Platform (ITAP) built with the MERN stack.

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

Rules:
- Always reference specific file paths and line numbers
- Be direct and practical — like a senior developer on the team
- If you need to read a file before answering, use the tools
- Never guess — if unsure, read the file first`;

export async function runAgent(userQuestion, conversationHistory = []) {
  // Add user message to history
  const messages = [
    ...conversationHistory,
    { role: 'user', content: userQuestion },
  ];

  console.log('\n🔍 Agent thinking...\n');

  // Agentic loop — runs until Claude stops calling tools
  while (true) {
    const response = await client.messages.create({
      model: config.model,
      max_tokens: config.maxTokens,
      thinking: { type: 'adaptive' },
      system: SYSTEM_PROMPT,
      tools: toolDefinitions,
      messages,
    });

    // Add assistant response to history
    messages.push({ role: 'assistant', content: response.content });

    // Claude is done — return final answer
    if (response.stop_reason === 'end_turn') {
      const textBlock = response.content.find((b) => b.type === 'text');
      return {
        answer: textBlock ? textBlock.text : 'No response generated.',
        messages, // return updated history for multi-turn
      };
    }

    // Claude wants to call tools
    if (response.stop_reason === 'tool_use') {
      const toolUseBlocks = response.content.filter(
        (b) => b.type === 'tool_use'
      );
      const toolResults = [];

      for (const toolCall of toolUseBlocks) {
        console.log(`  📂 Using tool: ${toolCall.name}`);
        if (toolCall.input && Object.keys(toolCall.input).length > 0) {
          const inputStr = Object.entries(toolCall.input)
            .map(([k, v]) => `${k}="${v}"`)
            .join(', ');
          console.log(`     → ${inputStr}`);
        }

        const result = executeTool(toolCall.name, toolCall.input);

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }

      // Feed tool results back to Claude
      messages.push({ role: 'user', content: toolResults });
    }
  }
}
