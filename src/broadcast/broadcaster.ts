import { Telegraf } from 'telegraf';
import { getAllSubscribedUsers, logBroadcast } from '../database/models';
import { RateLimiter } from './rateLimiter';
import { logger } from '../utils/logger';
import { chunkArray } from '../utils/helpers';

export interface BroadcastResult {
  totalRecipients: number;
  successCount: number;
  failureCount: number;
  errors: Record<string, number>;
  duration: number;
}

export interface BroadcastOptions {
  message: string;
  parseMode?: 'Markdown' | 'HTML';
  disableWebPagePreview?: boolean;
  replyMarkup?: any;
}

export class Broadcaster {
  private bot: Telegraf;
  private rateLimiter: RateLimiter;

  constructor(bot: Telegraf) {
    this.bot = bot;
    this.rateLimiter = new RateLimiter();
  }

  // إرسال بث لجميع المشتركين
  async sendBroadcast(options: BroadcastOptions): Promise<BroadcastResult> {
    const startTime = Date.now();
    const users = await getAllSubscribedUsers();
    
    logger.info('Starting broadcast', { totalUsers: users.length });

    const result: BroadcastResult = {
      totalRecipients: users.length,
      successCount: 0,
      failureCount: 0,
      errors: {},
      duration: 0
    };

    // تقسيم المستخدمين لدفعات
    const userChunks = chunkArray(users, 50);

    for (const chunk of userChunks) {
      const promises = chunk.map(user => 
        this.rateLimiter.addToQueue(() => this.sendToUser(user.chat_id, options))
      );

      const results = await Promise.allSettled(promises);

      results.forEach((promiseResult, index) => {
        if (promiseResult.status === 'fulfilled' && promiseResult.value.success) {
          result.successCount++;
        } else {
          result.failureCount++;
          
          if (promiseResult.status === 'rejected') {
            const errorType = this.categorizeError(promiseResult.reason);
            result.errors[errorType] = (result.errors[errorType] || 0) + 1;
            
            logger.debug('Broadcast failed for user', { 
              chatId: chunk[index].chat_id, 
              error: promiseResult.reason 
            });
          }
        }
      });
    }

    result.duration = Date.now() - startTime;

    // حفظ سجل البث
    await logBroadcast(
      options.message,
      result.totalRecipients,
      result.successCount,
      result.failureCount,
      result.errors
    );

    logger.info('Broadcast completed', result);

    return result;
  }

  // إرسال رسالة لمستخدم واحد
  private async sendToUser(
    chatId: number, 
    options: BroadcastOptions
  ): Promise<{ success: boolean; error?: any }> {
    try {
    await this.bot.telegram.sendMessage(chatId, options.message, {
  parse_mode: options.parseMode || 'Markdown',
  link_preview_options: {  // ← غيّر من disable_web_page_preview
    is_disabled: options.disableWebPagePreview || false
  },
  reply_markup: options.replyMarkup
});

      return { success: true };
    } catch (error: any) {
      // إذا كان المستخدم قد حظر البوت، نزيل اشتراكه
      if (error.response?.error_code === 403) {
        await this.unsubscribeUser(chatId);
      }

      return { success: false, error };
    }
  }

  // إلغاء اشتراك مستخدم
  private async unsubscribeUser(chatId: number): Promise<void> {
    try {
      const { db } = await import('../database/connection');
      await db.query(
        'UPDATE users SET is_subscribed = false WHERE chat_id = $1',
        [chatId]
      );
      logger.info('User unsubscribed (blocked bot)', { chatId });
    } catch (error) {
      logger.error('Error unsubscribing user', { error, chatId });
    }
  }

  // تصنيف نوع الخطأ
  private categorizeError(error: any): string {
    if (!error.response) {
      return 'network_error';
    }

    const errorCode = error.response.error_code;
    
    if (errorCode === 403) return 'blocked_bot';
    if (errorCode === 429) return 'rate_limit';
    if (errorCode === 400) return 'bad_request';
    if (errorCode >= 500) return 'server_error';
    
    return 'unknown_error';
  }

  // تنسيق نتيجة البث
  formatBroadcastResult(result: BroadcastResult, lang: string = 'ar'): string {
    const successRate = ((result.successCount / result.totalRecipients) * 100).toFixed(1);
    const durationSeconds = (result.duration / 1000).toFixed(1);

    let message = lang === 'ar'
      ? `📊 **نتيجة البث**\n\n`
      : `📊 **Broadcast Results**\n\n`;

    message += lang === 'ar'
      ? `✅ نجح: ${result.successCount} (${successRate}%)\n`
      : `✅ Success: ${result.successCount} (${successRate}%)\n`;

    message += lang === 'ar'
      ? `❌ فشل: ${result.failureCount}\n`
      : `❌ Failed: ${result.failureCount}\n`;

    message += lang === 'ar'
      ? `📮 الإجمالي: ${result.totalRecipients}\n`
      : `📮 Total: ${result.totalRecipients}\n`;

    message += lang === 'ar'
      ? `⏱ المدة: ${durationSeconds}ث\n\n`
      : `⏱ Duration: ${durationSeconds}s\n\n`;

    if (Object.keys(result.errors).length > 0) {
      message += lang === 'ar' ? `**تفاصيل الأخطاء:**\n` : `**Error Details:**\n`;
      
      Object.entries(result.errors).forEach(([errorType, count]) => {
        const errorName = this.translateErrorType(errorType, lang);
        message += `  • ${errorName}: ${count}\n`;
      });
    }

    return message;
  }

  // ترجمة نوع الخطأ
  private translateErrorType(errorType: string, lang: string): string {
    const translations: Record<string, Record<string, string>> = {
      ar: {
        blocked_bot: 'حظر البوت',
        rate_limit: 'تجاوز الحد',
        bad_request: 'طلب خاطئ',
        server_error: 'خطأ في الخادم',
        network_error: 'خطأ في الشبكة',
        unknown_error: 'خطأ غير معروف'
      },
      en: {
        blocked_bot: 'Blocked Bot',
        rate_limit: 'Rate Limit',
        bad_request: 'Bad Request',
        server_error: 'Server Error',
        network_error: 'Network Error',
        unknown_error: 'Unknown Error'
      }
    };

    return translations[lang]?.[errorType] || errorType;
  }
}
