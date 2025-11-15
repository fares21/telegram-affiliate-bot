import { Telegraf, Context, session } from 'telegraf';
import { Update } from 'telegraf/types';
import { config } from '../config/environment';
import { logger } from '../utils/logger';

// تعريف صحيح لـ BotContext
export interface BotContext extends Context {
  session?: {
    language?: string;
    awaitingInput?: string;
    tempData?: any;
  };
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
      .catch((err: any) => logger.error('Error sending error message', err));
  });

  return bot;
}
