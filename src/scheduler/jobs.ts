import cron from 'node-cron';
import { getAllSubscribedUsers } from '../database/models';
import { cartService } from '../services/cart';
import { logger } from '../utils/logger';
import { Telegraf } from 'telegraf';

export class SchedulerService {
  private bot: Telegraf;
  private jobs: Map<string, cron.ScheduledTask> = new Map();

  constructor(bot: Telegraf) {
    this.bot = bot;
  }

  // بدء جميع المهام المجدولة
  startAllJobs(): void {
    this.scheduleCartPriceCheck();
    this.scheduleInactiveUserCleanup();
    logger.info('All scheduled jobs started');
  }

  // إيقاف جميع المهام
  stopAllJobs(): void {
    this.jobs.forEach((job, name) => {
      job.stop();
      logger.info('Job stopped', { name });
    });
    this.jobs.clear();
  }

  // فحص أسعار السلة كل 6 ساعات
  private scheduleCartPriceCheck(): void {
    const job = cron.schedule('0 */6 * * *', async () => {
      logger.info('Starting scheduled cart price check');
      
      try {
        const users = await getAllSubscribedUsers();

        for (const user of users) {
          try {
            const changes = await cartService.checkPriceChanges(user.id);

            // إرسال تنبيه للمستخدم إذا كان هناك تغييرات
            if (changes.length > 0) {
              for (const change of changes) {
                const message = cartService.formatPriceChangeAlert(change, user.language);
                
                await this.bot.telegram.sendMessage(user.chat_id, message, {
                  parse_mode: 'Markdown'
                });

                logger.info('Price change alert sent', { 
                  userId: user.id, 
                  chatId: user.chat_id 
                });
              }
            }

          } catch (userError) {
            logger.error('Error checking cart for user', { 
              userId: user.id, 
              error: userError 
            });
          }
        }

        logger.info('Scheduled cart price check completed');

      } catch (error) {
        logger.error('Error in scheduled cart price check', { error });
      }
    });

    this.jobs.set('cartPriceCheck', job);
    logger.info('Cart price check job scheduled (every 6 hours)');
  }

  // تنظيف المستخدمين الغير نشطين كل أسبوع
  private scheduleInactiveUserCleanup(): void {
    const job = cron.schedule('0 0 * * 0', async () => {
      logger.info('Starting inactive users cleanup');
      
      try {
        const { db } = await import('../database/connection');
        
        // حذف المستخدمين الذين لم يتفاعلوا منذ 90 يوم
        const result = await db.query(`
          DELETE FROM users 
          WHERE is_subscribed = false 
          AND created_at < NOW() - INTERVAL '90 days'
        `);

        logger.info('Inactive users cleanup completed', { 
          deletedCount: result.rowCount 
        });

      } catch (error) {
        logger.error('Error in inactive users cleanup', { error });
      }
    });

    this.jobs.set('inactiveUserCleanup', job);
    logger.info('Inactive user cleanup job scheduled (weekly)');
  }

  // جدولة بث مخصص
  scheduleCustomBroadcast(
    cronExpression: string, 
    message: string, 
    name: string
  ): void {
    const job = cron.schedule(cronExpression, async () => {
      logger.info('Starting scheduled broadcast', { name });
      
      try {
        const { Broadcaster } = await import('../broadcast/broadcaster');
        const broadcaster = new Broadcaster(this.bot);
        
        const result = await broadcaster.sendBroadcast({ message });
        
        logger.info('Scheduled broadcast completed', { name, result });

      } catch (error) {
        logger.error('Error in scheduled broadcast', { name, error });
      }
    });

    this.jobs.set(`custom_broadcast_${name}`, job);
    logger.info('Custom broadcast scheduled', { name, cronExpression });
  }

  // إلغاء مهمة مخصصة
  cancelJob(name: string): boolean {
    const job = this.jobs.get(name);
    
    if (job) {
      job.stop();
      this.jobs.delete(name);
      logger.info('Job cancelled', { name });
      return true;
    }

    return false;
  }

  // الحصول على قائمة المهام النشطة
  getActiveJobs(): string[] {
    return Array.from(this.jobs.keys());
  }
}
