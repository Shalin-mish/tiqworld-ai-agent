import readline from 'readline';
import { runAgent, ALL_TOOLS, projectInfo } from './agent.js';
import { classify, getTools, TASK_LABELS, formatClassification } from './dispatcher.js';
import { clearLog, getLog } from './session.js';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

let conversationHistory = [];
let currentTaskType     = null;

const TOOL_COUNT   = ALL_TOOLS.definitions.length;
const PROJECT_NAME = projectInfo?.name ?? 'Codebase';

console.log('');
console.log('╔══════════════════════════════════════════════╗');
console.log(`║  AI Agent · ${PROJECT_NAME.slice(0, 20).padEnd(20)} (${TOOL_COUNT} tools)  ║`);
console.log('║  Powered by Claude on AWS Bedrock            ║');
console.log('╚══════════════════════════════════════════════╝');
console.log('');
console.log(`  Target: ${projectInfo?.name} · ${projectInfo?.language} · ${projectInfo?.framework}`);
console.log('  Commands: exit · clear · help · override <type>');
console.log('');

function printHelp() {
  console.log('');
  console.log('  Commands');
  console.log('  ─────────────────────────────────────────────');
  console.log('  exit                      quit');
  console.log('  clear                     reset conversation + session log');
  console.log('  help                      show this message');
  console.log('  override <type>           force task type for this session');
  console.log('                            types: query | review | maintenance | feature');
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
  console.log('  "find all TODOs in src/"');
  console.log('  "check env usage"');
  console.log('  "detect dead code in src/utils"');
  console.log('  "are any secrets committed?"');
  console.log('  "trace this error: [paste stack trace]"');
  console.log('  "fix the missing null check in [file]"');
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

    // override <type> — force task type for current session
    if (cmd.startsWith('override ')) {
      const requested = cmd.split(' ')[1]?.trim();
      const valid = ['query', 'review', 'maintenance', 'feature'];
      if (valid.includes(requested)) {
        currentTaskType = requested;
        console.log(`\n  Overridden → [${TASK_LABELS[currentTaskType]}]. Conversation reset.\n`);
        conversationHistory = [];
      } else {
        console.log(`\n  Unknown type "${requested}". Valid: ${valid.join(' | ')}\n`);
      }
      prompt();
      return;
    }

    // Classify only on the first turn — subsequent turns stay in the same scope
    // so the tool set doesn't shift mid-conversation.
    if (!currentTaskType) {
      const result = classify(input);
      currentTaskType = result.type;
      console.log(`\n${formatClassification(result)}`);
    }

    const tools = getTools(currentTaskType);

    const sessionTokens = { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 };
    try {
      const { answer, messages } = await runAgent(
        input, conversationHistory, tools,
        (event) => {
          if (event.type === 'token_usage') {
            sessionTokens.in         += event.in         ?? 0;
            sessionTokens.out        += event.out        ?? 0;
            sessionTokens.cacheRead  += event.cacheRead  ?? 0;
            sessionTokens.cacheWrite += event.cacheWrite ?? 0;
          }
        },
      );
      conversationHistory = messages.slice(-8);
      console.log('\nAgent:\n');
      console.log(answer);
      const t = sessionTokens;
      const cacheNote = t.cacheRead ? ` | cache_read:${t.cacheRead}` : '';
      const writeNote = t.cacheWrite ? ` cache_write:${t.cacheWrite}` : '';
      console.log(`\n  [Tokens] in:${t.in} out:${t.out}${cacheNote}${writeNote}`);
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
