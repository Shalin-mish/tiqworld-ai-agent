import 'dotenv/config';

export const config = {
  codebasePath:         process.env.TIQ_CODEBASE_PATH   || 'C:/Users/Shalini Mishra/TIQ',
  awsRegion:            process.env.AWS_REGION           || 'us-east-2',
  awsAccessKeyId:       process.env.AWS_ACCESS_KEY_ID,
  awsSecretAccessKey:   process.env.AWS_SECRET_ACCESS_KEY,
  model:                'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
  maxTokens:            16000,
  dbUrl:                process.env.DB_URL  ?? null,
  webPort:              parseInt(process.env.WEB_PORT, 10) || 3001,
  // Bedrock prompt caching — set ENABLE_PROMPT_CACHE=true in .env to activate.
  enablePromptCache:    process.env.ENABLE_PROMPT_CACHE === 'true',
  // Legacy interval mode (0 = disabled, use cron schedules below instead)
  scanIntervalMinutes:  parseInt(process.env.SCAN_INTERVAL_MINUTES, 10) || 0,
  // Semi-autonomous maintenance schedules (cron syntax, IST timezone)
  nightMaintenanceCron: process.env.NIGHT_MAINTENANCE_CRON || '0 2 * * *',
  dayLightScanCron:     process.env.DAY_LIGHT_SCAN_CRON    || '0 */2 * * *',
  // Auto-fix: agent fixes safe issues autonomously in night maintenance
  // Set AUTO_FIX_ENABLED=false to make maintenance scan-only (no writes)
  autoFixEnabled:       process.env.AUTO_FIX_ENABLED !== 'false',
  autoFixMinConfidence: parseInt(process.env.AUTO_FIX_MIN_CONFIDENCE, 10) || 55,
};
