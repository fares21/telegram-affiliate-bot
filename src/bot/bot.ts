import { Telegraf, session } from 'telegraf';
import { config } from '../config/environment';
import { logger } from '../utils/logger';

export interface BotContext {
  session?: {
    language?: string;
    awaitingInput?: string;
    tempData?: any;
  };
  [key: string]: any;
}

export function createBot(): Telegraf<BotContext> {
  const bot = new Telegraf<BotContext>(config.bot.token);

  // إضافة middleware للجلسة
  bot.use(session());

  // تسجيل جميع الرسائل الواردة
  bot.use(async (ctx, next) => {
    const start = Date.now();
    
    logger.debug('Incoming update', {
      updateType: ctx.updateType,
      chatId: ctx.chat?.id,
      userId: ctx.from?.id,
      username: ctx.from?.username
    });

    await next();

    const duration = Date.now() - start;
    logger.debug('Update processed', { duration });
  });

  // معالجة الأخطاء
  bot.catch((error: any, ctx: BotContext) => {
    logger.error('Bot error', {
      error: error.message,
      stack: error.stack,
      chatId: ctx.chat?.id,
      updateType: ctx.updateType
    });

    ctx.reply('❌ حدث خطأ أثناء معالجة طلبك. يرجى المحاولة لاحقاً.')
      .catch(err => logger.error('Error sending error message', err));
  });

  return bot;
}
