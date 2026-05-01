import readline from 'readline';
import { runAgent } from './agent.js';

// CLI interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

let conversationHistory = [];

console.log('');
console.log('╔════════════════════════════════════════╗');
console.log('║     TIQ World AI Agent  🤖             ║');
console.log('║     Powered by Claude claude-opus-4-7         ║');
console.log('╚════════════════════════════════════════╝');
console.log('');
console.log('TIQ codebase ke baare mein kuch bhi poochho.');
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
      console.log('\nBye! 👋\n');
      rl.close();
      process.exit(0);
    }

    if (userInput.toLowerCase() === 'clear') {
      conversationHistory = [];
      console.log('\n✅ Conversation cleared.\n');
      prompt();
      return;
    }

    try {
      const { answer, messages } = await runAgent(userInput, conversationHistory);
      // Keep conversation history for multi-turn (last 10 exchanges to manage context)
      conversationHistory = messages.slice(-20);
      console.log('\n🤖 Agent:\n');
      console.log(answer);
      console.log('\n' + '─'.repeat(50) + '\n');
    } catch (err) {
      console.error('\n❌ Error:', err.message);
      if (err.status === 401) {
        console.error('   Check your ANTHROPIC_API_KEY in .env file\n');
      }
    }

    prompt();
  });
}

prompt();
