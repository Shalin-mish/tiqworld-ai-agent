import readline from 'readline';
import { runAgent, ALL_TOOLS } from './agent.js';
import { classify, getTools, TASK_LABELS } from './dispatcher.js';
import { clearLog, getLog } from './session.js';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

let conversationHistory = [];
let currentTaskType     = null;

const TOOL_COUNT = ALL_TOOLS.definitions.length;

console.log('');
console.log('╔══════════════════════════════════════════════╗');
console.log(`║  TIQ World AI Agent  (${TOOL_COUNT} tools)              ║`);
console.log('║  Powered by Claude on AWS Bedrock            ║');
console.log('╚══════════════════════════════════════════════╝');
console.log('');
console.log('  Ask anything about the TIQ codebase.');
console.log('  Commands: exit · clear · help');
console.log('');

function printHelp() {
  console.log('');
  console.log('  Commands');
  console.log('  ─────────────────────────────────────────────');
  console.log('  exit          quit');
  console.log('  clear         reset conversation + session log');
  console.log('  help          show this message');
  console.log('');
  console.log('  Task types (auto-detected from your input)');
  console.log('  ─────────────────────────────────────────────');
  console.log('  Query       — read-only Q&A, trace, explain');
  console.log('  Review      — audit, find todos, dead code, env check');
  console.log('  Maintenance — fix, refactor, patch (write access)');
  console.log('  Feature     — add, build, scaffold  (write access)');
  console.log('');
  console.log('  Example queries');
  console.log('  ─────────────────────────────────────────────');
  console.log('  "explain route /api/auth/login"');
  console.log('  "find all TODOs in backend/src"');
  console.log('  "check env usage in backend"');
  console.log('  "detect dead code in backend/src/utils"');
  console.log('  "schema_to_api for Track model"');
  console.log('  "trace this error: [paste stack trace]"');
  console.log('  "fix the missing null check in submissions controller"');
  console.log('');
}

function prompt() {
  rl.question('You: ', async (raw) => {
    const input = raw.trim();
    if (!input) { prompt(); return; }

    const cmd = input.toLowerCase();

    if (cmd === 'exit') {
      console.log('\n  Bye!\n');
      rl.close();
      process.exit(0);
    }

    if (cmd === 'help') {
      printHelp();
      prompt();
      return;
    }

    if (cmd === 'clear') {
      const callCount = getLog().length;
      conversationHistory = [];
      currentTaskType     = null;
      clearLog();
      console.log(`\n  Conversation cleared. (${callCount} tool calls in session)\n`);
      prompt();
      return;
    }

    // Classify only on the first turn — subsequent turns stay in the same scope
    // so the tool set doesn't shift mid-conversation.
    if (!currentTaskType) {
      currentTaskType = classify(input);
      console.log(`\n  [${TASK_LABELS[currentTaskType]}] Task detected.`);
    }

    const tools = getTools(currentTaskType);

    try {
      const { answer, messages } = await runAgent(input, conversationHistory, tools);
      // Keep last 20 message pairs to avoid unbounded history growth.
      conversationHistory = messages.slice(-20);
      console.log('\nAgent:\n');
      console.log(answer);
      console.log('\n' + '─'.repeat(54) + '\n');
    } catch (err) {
      console.error('\n  Error:', err.message);
      if (err.name === 'CredentialsProviderError' || err.message?.includes('credential')) {
        console.error('  Check AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in .env\n');
      } else if (err.message?.includes('throttl') || err.message?.includes('rate')) {
        console.error('  Bedrock rate limit hit — wait a moment and retry.\n');
      }
    }

    prompt();
  });
}

prompt();
