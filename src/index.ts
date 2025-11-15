import express from 'express';
import { createBot } from './bot/bot';
import { registerHandlers } from './bot/handlers';
import { initializeDatabase } from './database/models';
import { SchedulerService } from './scheduler/jobs';
import { config } from './config/environment';
import { logger } from './utils/logger';

const app = express();
const bot = createBot();

// Middleware
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Webhook endpoint
app.post(config.bot.webhookPath, (req, res) => {
  bot.handleUpdate(req.body, res);
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'Telegram Affiliate Bot API',
    status: 'running',
    webhook: config.bot.webhookUrl + config.bot.webhookPath
  });
});

// تهيئة وتشغيل البوت
async function startBot() {
  try {
    logger.info('Starting bot initialization...');

    // تهيئة قاعدة البيانات
    await initializeDatabase();
    logger.info('Database initialized');

    // تسجيل معالجات البوت
    registerHandlers(bot);
    logger.info('Bot handlers registered');

    // إعداد Webhook
    const webhookUrl = config.bot.webhookUrl + config.bot.webhookPath;
    await bot.telegram.setWebhook(webhookUrl);
    logger.info('Webhook set', { webhookUrl });

    // بدء المهام المجدولة
    const scheduler = new SchedulerService(bot);
    scheduler.startAllJobs();
    logger.info('Scheduled jobs started');

    // بدء الخادم
    const PORT = config.server.port;
    app.listen(PORT, () => {
      logger.info(`Server started on port ${PORT}`);
      logger.info(`Webhook URL: ${webhookUrl}`);
      logger.info('Bot is ready to receive updates');
    });

    // معالجة الإيقاف النظيف
    process.on('SIGTERM', async () => {
      logger.info('SIGTERM signal received, shutting down gracefully');
      scheduler.stopAllJobs();
      await bot.telegram.deleteWebhook();
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      logger.info('SIGINT signal received, shutting down gracefully');
      scheduler.stopAllJobs();
      await bot.telegram.deleteWebhook();
      process.exit(0);
    });

  } catch (error) {
    logger.error('Failed to start bot', { error });
    process.exit(1);
  }
}

// بدء التطبيق
startBot();
