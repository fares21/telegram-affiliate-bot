import dotenv from 'dotenv';

dotenv.config();

export const config = {
  bot: {
    token: process.env.BOT_TOKEN || '',
    webhookUrl: process.env.WEBHOOK_URL || '',
    webhookPath: process.env.WEBHOOK_PATH || '/webhook',
    adminIds: process.env.ADMIN_IDS?.split(',').map(id => parseInt(id.trim())) || []
  },
  server: {
    port: parseInt(process.env.PORT || '3000')
  },
  database: {
    url: process.env.DATABASE_URL || ''
  },
  redis: {
    url: process.env.REDIS_URL || ''
  },
  aliexpress: {
    appKey: process.env.ALIEXPRESS_APP_KEY || '',
    appSecret: process.env.ALIEXPRESS_APP_SECRET || '',
    trackingId: process.env.ALIEXPRESS_TRACKING_ID || ''
  },
  rateLimiting: {
    maxPerSecond: parseInt(process.env.MAX_BROADCAST_PER_SECOND || '25'),
    retryAttempts: parseInt(process.env.RETRY_ATTEMPTS || '3'),
    retryDelay: parseInt(process.env.RETRY_DELAY_MS || '2000')
  },
  defaultLanguage: process.env.DEFAULT_LANGUAGE || 'ar'
};

// التحقق من المتغيرات الأساسية
if (!config.bot.token) {
  throw new Error('BOT_TOKEN is required in environment variables');
}
