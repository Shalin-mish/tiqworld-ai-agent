import readline from 'readline';
import { runAgent } from './agent.js';
import { classify, getTools, TASK_LABELS } from './dispatcher.js';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

let conversationHistory = [];
let currentTaskType = null;

console.log('');
console.log('╔════════════════════════════════════════╗');
console.log('║     TIQ World AI Agent                 ║');
console.log('║     Powered by Claude on Bedrock       ║');
console.log('╚════════════════════════════════════════╝');
console.log('');
console.log('Ask anything about the TIQ codebase.');
console.log('Type "exit" to quit | "clear" to reset conversation');
console.log('');

function prompt() {
  rl.question('You: ', async (input) => {
    const userInput = input.trim();

    if (!userInput) {
      prompt();
      return;
    }

    if (userInput.toLowerCase() === 'exit') {
      console.log('\nBye!\n');
      rl.close();
      process.exit(0);
    }

    if (userInput.toLowerCase() === 'clear') {
      conversationHistory = [];
      currentTaskType = null;
      console.log('\nConversation cleared.\n');
      prompt();
      return;
    }

    // Only classify on the first turn of a conversation.
    // Subsequent turns stay in the same task context so tool scope is stable.
    if (!currentTaskType) {
      currentTaskType = classify(userInput);
      console.log(`\n[${TASK_LABELS[currentTaskType]}] Task detected — tools scoped accordingly.`);
    }

    const tools = getTools(currentTaskType);

    try {
      const { answer, messages } = await runAgent(userInput, conversationHistory, tools);
      conversationHistory = messages.slice(-20);
      console.log('\nAgent:\n');
      console.log(answer);
      console.log('\n' + '─'.repeat(50) + '\n');
    } catch (err) {
      console.error('\nError:', err.message);
      if (err.name === 'CredentialsProviderError' || err.message?.includes('credential')) {
        console.error('   Check AWS credentials in your .env file\n');
      }
    }

    prompt();
  });
}

prompt();
