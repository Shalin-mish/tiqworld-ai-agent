import 'dotenv/config';

export const config = {
  codebasePath:        process.env.TIQ_CODEBASE_PATH || 'C:/Users/Shalini Mishra/TIQ',
  awsRegion:           process.env.AWS_REGION || 'us-east-2',
  awsAccessKeyId:      process.env.AWS_ACCESS_KEY_ID,
  awsSecretAccessKey:  process.env.AWS_SECRET_ACCESS_KEY,
  model:               'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
  maxTokens:           16000,
  dbUrl:               process.env.DB_URL ?? null,
  webPort:             parseInt(process.env.WEB_PORT, 10) || 3001,
  enablePromptCache:   process.env.ENABLE_PROMPT_CACHE === 'true',
  scanIntervalMinutes: parseInt(process.env.SCAN_INTERVAL_MINUTES, 10) || 0,
};
