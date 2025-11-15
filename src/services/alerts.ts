import { createAlert, getActiveAlerts } from '../database/models';
import { db } from '../database/connection';
import { logger } from '../utils/logger';

export interface AlertMatch {
  userId: number;
  chatId: number;
  keyword: string;
  productTitle: string;
  productUrl: string;
  price: number;
  discount: number;
}

class AlertsService {
  // إنشاء تنبيه جديد
  async createUserAlert(userId: number, keyword: string): Promise<any> {
    try {
      const alert = await createAlert(userId, keyword.toLowerCase());
      
      logger.info('Alert created', { userId, keyword });
      
      return {
        success: true,
        alert
      };

    } catch (error) {
      logger.error('Error creating alert', { error, userId, keyword });
      throw error;
    }
  }

  // جلب تنبيهات المستخدم
  async getUserAlerts(userId: number): Promise<any[]> {
    try {
      const result = await db.query(
        'SELECT * FROM alerts WHERE user_id = $1 AND is_active = true ORDER BY created_at DESC',
        [userId]
      );
      
      return result.rows;

    } catch (error) {
      logger.error('Error fetching user alerts', { error, userId });
      throw error;
    }
  }

  // إلغاء تنبيه
  async deactivateAlert(alertId: number): Promise<void> {
    try {
      await db.query('UPDATE alerts SET is_active = false WHERE id = $1', [alertId]);
      logger.info('Alert deactivated', { alertId });
    } catch (error) {
      logger.error('Error deactivating alert', { error, alertId });
      throw error;
    }
  }

  // البحث عن مطابقات للتنبيهات
  async findAlertMatches(productTitle: string, productUrl: string, price: number, discount: number): Promise<AlertMatch[]> {
    try {
      const alerts = await getActiveAlerts();
      const matches: AlertMatch[] = [];
      const titleLower = productTitle.toLowerCase();

      for (const alert of alerts) {
        const keywordLower = alert.keyword.toLowerCase();
        
        // التحقق من وجود الكلمة المفتاحية في العنوان
        if (titleLower.includes(keywordLower)) {
          // جلب معلومات المستخدم
          const userResult = await db.query(
            'SELECT chat_id FROM users WHERE id = $1',
            [alert.user_id]
          );

          if (userResult.rows.length > 0) {
            matches.push({
              userId: alert.user_id,
              chatId: userResult.rows[0].chat_id,
              keyword: alert.keyword,
              productTitle,
              productUrl,
              price,
              discount
            });

            logger.info('Alert match found', { 
              userId: alert.user_id, 
              keyword: alert.keyword, 
              productTitle 
            });
          }
        }
      }

      return matches;

    } catch (error) {
      logger.error('Error finding alert matches', { error });
      return [];
    }
  }

  // تنسيق رسالة التنبيه
  formatAlertMessage(match: AlertMatch, lang: string = 'ar'): string {
    let message = lang === 'ar'
      ? `🔔 **تنبيه: عرض جديد!**\n\n`
      : `🔔 **Alert: New Deal!**\n\n`;

    message += lang === 'ar'
      ? `تم العثور على منتج يطابق الكلمة المفتاحية: **${match.keyword}**\n\n`
      : `Found a product matching your keyword: **${match.keyword}**\n\n`;

    message += `📦 ${match.productTitle}\n\n`;
    message += lang === 'ar'
      ? `💰 السعر: $${match.price.toFixed(2)}\n`
      : `💰 Price: $${match.price.toFixed(2)}\n`;

    if (match.discount > 0) {
      message += lang === 'ar'
        ? `🎉 الخصم: ${match.discount.toFixed(0)}%\n`
        : `🎉 Discount: ${match.discount.toFixed(0)}%\n`;
    }

    return message;
  }
}

export const alertsService = new AlertsService();
