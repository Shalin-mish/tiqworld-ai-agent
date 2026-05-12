import 'dotenv/config';

export const config = {
  codebasePath: process.env.TIQ_CODEBASE_PATH || 'C:/Users/Shalini Mishra/TIQ',
  awsRegion: process.env.AWS_REGION || 'us-east-2',
  awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID,
  awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  model: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
  maxTokens: 16000,
};
