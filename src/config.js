import 'dotenv/config';

export const config = {
  codebasePath:          process.env.TIQ_CODEBASE_PATH   || 'C:/Users/Shalini Mishra/TIQ',
  awsRegion:             process.env.AWS_REGION           || 'us-east-2',
  awsAccessKeyId:        process.env.AWS_ACCESS_KEY_ID,
  awsSecretAccessKey:    process.env.AWS_SECRET_ACCESS_KEY,
  model:                 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
  maxTokens:             16000,
  dbUrl:                 process.env.DB_URL  ?? null,
  webPort:               parseInt(process.env.WEB_PORT, 10) || 3001,
  // Prompt caching is ON by default — set ENABLE_PROMPT_CACHE=false to disable
  enablePromptCache:     process.env.ENABLE_PROMPT_CACHE !== 'false',
  bedrockTimeoutMs:      parseInt(process.env.BEDROCK_TIMEOUT_MS, 10) || 60000,
  scanIntervalMinutes:   parseInt(process.env.SCAN_INTERVAL_MINUTES, 10) || 0,
  nightMaintenanceCron:  process.env.NIGHT_MAINTENANCE_CRON || '0 2 * * *',
  dayLightScanCron:      process.env.DAY_LIGHT_SCAN_CRON    || '0 */2 * * *',
  autoFixEnabled:        process.env.AUTO_FIX_ENABLED !== 'false',
  autoFixMinConfidence:  parseInt(process.env.AUTO_FIX_MIN_CONFIDENCE, 10) || 55,
  notificationWebhookUrl: process.env.NOTIFICATION_WEBHOOK_URL ?? null,
  githubClientId:        process.env.GITHUB_CLIENT_ID     ?? null,
  githubClientSecret:    process.env.GITHUB_CLIENT_SECRET ?? null,
  sessionSecret:         process.env.SESSION_SECRET       ?? 'tiq-agent-dev-secret-change-me',
};
