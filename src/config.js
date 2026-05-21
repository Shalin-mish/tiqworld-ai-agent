import 'dotenv/config';

export const config = {
  codebasePath:      process.env.TIQ_CODEBASE_PATH || 'C:/Users/Shalini Mishra/TIQ',
  awsRegion:         process.env.AWS_REGION || 'us-east-2',
  awsAccessKeyId:    process.env.AWS_ACCESS_KEY_ID,
  awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  model:             'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
  maxTokens:         16000,
  dbUrl:             process.env.DB_URL ?? null,
  webPort:           parseInt(process.env.WEB_PORT, 10) || 3001,
  // Bedrock prompt caching — set ENABLE_PROMPT_CACHE=true in .env to activate.
  // Caches the system prompt across turns; reduces token cost ~60% on long sessions.
  enablePromptCache:    process.env.ENABLE_PROMPT_CACHE === 'true',
  // Auto-scan on server start. Set SCAN_INTERVAL_MINUTES=30 for repeat scans.
  // 0 = run once at startup only (default).
  scanIntervalMinutes:  parseInt(process.env.SCAN_INTERVAL_MINUTES, 10) || 0,
};
