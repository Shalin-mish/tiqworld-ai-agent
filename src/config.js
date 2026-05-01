import 'dotenv/config';
import path from 'path';

export const config = {
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  codebasePath: process.env.TIQ_CODEBASE_PATH || 'C:/Users/Shalini Mishra/TIQ',
  model: 'claude-opus-4-7',
  maxTokens: 16000,
};

// Validate on startup
if (!config.anthropicApiKey) {
  console.error('ERROR: ANTHROPIC_API_KEY missing in .env file');
  process.exit(1);
}
