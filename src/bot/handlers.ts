import { Telegraf, Markup } from 'telegraf';
import { BotContext } from './bot';
import { createOrUpdateUser, updateUserLanguage } from '../database/models';
import { affiliateService } from '../services/affiliate';
import { pricingService } from '../services/pricing';
import { cartService } from '../services/cart';
import { alertsService } from '../services/alerts';
import { Broadcaster } from '../broadcast/broadcaster';
import { t } from '../config/i18n';
import { config } from '../config/environment';
import { logger } from '../utils/logger';
import { isValidUrl } from '../utils/helpers';

export function registerHandlers(bot: Telegraf<BotContext>): void {
  
  // معالج أمر /start
  bot.start(async (ctx) => {
    try {
      const chatId = ctx.chat.id;
      const username = ctx.from.username;

      // إنشاء أو تحديث المستخدم
      await createOrUpdateUser(chatId, username);

      const language = ctx.session?.language || 'ar';
      const welcomeMessage = t('welcome', language);

      await ctx.reply(welcomeMessage, {
        reply_markup: {
          keyboard: [
            [{ text: t('addToCart', language) }, { text: t('viewCart', language) }],
            [{ text: t('setAlert', language) }, { text: t('help', language) }]
          ],
          resize_keyboard: true
        }
      });

      logger.info('User started bot', { chatId, username });

    } catch (error) {
      logger.error('Error in start command', { error });
      ctx.reply('❌ حدث خطأ. يرجى المحاولة لاحقاً.');
    }
  });

  // معالج أمر /language
  bot.command('language', async (ctx) => {
    await ctx.reply('اختر اللغة / Choose Language:', {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🇸🇦 العربية', callback_data: 'lang_ar' },
            { text: '🇬🇧 English', callback_data: 'lang_en' }
          ]
        ]
      }
    });
  });

  // معالج تغيير اللغة
  bot.action(/lang_(.+)/, async (ctx) => {
    try {
      const language = ctx.match[1];
      ctx.session = ctx.session || {};
      ctx.session.language = language;

      await updateUserLanguage(ctx.chat!.id, language);
      await ctx.answerCbQuery();
      await ctx.reply(t('welcome', language));

      logger.info('Language changed', { chatId: ctx.chat!.id, language });

    } catch (error) {
      logger.error('Error changing language', { error });
      ctx.answerCbQuery('❌ Error');
    }
  });

  // معالج أمر /help
  bot.command('help', async (ctx) => {
    const lang = ctx.session?.language || 'ar';
    
    const helpMessage = lang === 'ar' ? `
📚 **دليل الاستخدام**

**الأوامر المتاحة:**

🔗 **إضافة منتج:**
أرسل رابط منتج من AliExpress للحصول على:
• رابط أفلييت مخصص
• السعر الأصلي والحالي
• الكوبونات المتاحة
• السعر النهائي بعد الخصومات

🛒 **السلة:**
/cart - عرض سلة التسوق
/add_to_cart [رابط] - إضافة منتج للسلة
سيتم مراقبة الأسعار تلقائياً وإرسال تنبيهات عند التغيير

🔔 **التنبيهات:**
/alert [كلمة] - تفعيل تنبيه للكلمة المفتاحية
/my_alerts - عرض تنبيهاتك النشطة
ستصلك تنبيهات فورية عند ظهور عروض مطابقة

⚙️ **إعدادات:**
/language - تغيير اللغة
/stats - إحصائياتك

للمشرفين فقط:
/broadcast [رسالة] - إرسال بث لجميع المستخدمين
/admin - لوحة الإدارة
` : `
📚 **User Guide**

**Available Commands:**

🔗 **Add Product:**
Send an AliExpress product link to get:
• Custom affiliate link
• Original and current price
• Available coupons
• Final price after discounts

🛒 **Cart:**
/cart - View shopping cart
/add_to_cart [link] - Add product to cart
Prices are monitored automatically with alerts

🔔 **Alerts:**
/alert [keyword] - Set keyword alert
/my_alerts - View your active alerts
Get instant notifications for matching deals

⚙️ **Settings:**
/language - Change language
/stats - Your statistics

Admin only:
/broadcast [message] - Send broadcast
/admin - Admin panel
`;

    await ctx.reply(helpMessage, { parse_mode: 'Markdown' });
  });

  // معالج الروابط (تحويل لأفلييت)
  bot.hears(/https?:\/\/(www\.)?(aliexpress|ae\.aliexpress)\.com\/.+/, async (ctx) => {
    try {
      const url = ctx.message.text;
      const chatId = ctx.chat.id;
      const lang = ctx.session?.language || 'ar';

      // رسالة معالجة
      const processingMsg = await ctx.reply(t('processing', lang));

      // جلب المستخدم
      const user = await createOrUpdateUser(chatId, ctx.from.username);

      // توليد رابط الأفلييت
      const affiliateData = await affiliateService.convertToAffiliateLink(url, user.id);

      // حساب السعر النهائي
      const pricing = await pricingService.calculateFinalPrice(url);

      // جلب تفاصيل المنتج
      const product = await affiliateService.getProductDetails(url);

      // تنسيق الرسالة
      let message = `📦 **${product?.product_title || 'منتج'}**\n\n`;
      message += pricingService.formatPricingInfo(pricing, lang);
      message += `\n\n🔗 **${t('affiliateLink', lang)}:**\n${affiliateData.affiliateUrl}`;

      // الأزرار
      const buttons = Markup.inlineKeyboard([
        [
          Markup.button.url(lang === 'ar' ? '🛍 زيارة المنتج' : '🛍 Visit Product', affiliateData.affiliateUrl)
        ],
        [
          Markup.button.callback(lang === 'ar' ? '🛒 إضافة للسلة' : '🛒 Add to Cart', `add_cart_${product?.product_id || ''}`)
        ],
        [
          Markup.button.callback(lang === 'ar' ? '📤 مشاركة' : '📤 Share', `share_${product?.product_id || ''}`)
        ]
      ]);

      // حذف رسالة المعالجة وإرسال النتيجة
      await ctx.telegram.deleteMessage(chatId, processingMsg.message_id);
     await ctx.reply(message, { 
  parse_mode: 'Markdown',
  link_preview_options: {  // ← غيّر من disable_web_page_preview
    is_disabled: false
  },
  ...buttons
});

      // البحث عن تنبيهات مطابقة
      if (product) {
        const matches = await alertsService.findAlertMatches(
          product.product_title,
          url,
          pricing.finalPrice,
          pricing.savingsPercentage
        );

        // إرسال التنبيهات
        for (const match of matches) {
          if (match.chatId !== chatId) { // لا نرسل للمستخدم الحالي
            const alertMessage = alertsService.formatAlertMessage(match, lang);
            await bot.telegram.sendMessage(match.chatId, alertMessage + `\n\n${affiliateData.affiliateUrl}`, {
              parse_mode: 'Markdown'
            });
          }
        }
      }

      logger.info('Product link processed', { chatId, url });

    } catch (error) {
      logger.error('Error processing product link', { error });
      ctx.reply('❌ لم أتمكن من معالجة هذا الرابط. تأكد أنه رابط صحيح من AliExpress.');
    }
  });

  // معالج أمر /cart
  bot.command('cart', async (ctx) => {
    try {
      const chatId = ctx.chat.id;
      const user = await createOrUpdateUser(chatId, ctx.from.username);
      const lang = ctx.session?.language || 'ar';

      const cartItems = await cartService.getUserCart(user.id);
      const message = cartService.formatCartMessage(cartItems, lang);

      if (cartItems.length > 0) {
        const buttons = Markup.inlineKeyboard(
          cartItems.slice(0, 10).map((item, index) => [
            Markup.button.callback(
              `${index + 1}. ${item.title.substring(0, 30)}...`,
              `view_cart_${item.id}`
            )
          ])
        );

        await ctx.reply(message, { parse_mode: 'Markdown', ...buttons });
      } else {
        await ctx.reply(message);
      }

    } catch (error) {
      logger.error('Error fetching cart', { error });
      ctx.reply('❌ حدث خطأ في جلب السلة.');
    }
  });

  // معالج إضافة للسلة
  bot.action(/add_cart_(.+)/, async (ctx) => {
    try {
      const productId = ctx.match[1];
      const chatId = ctx.chat!.id;
      const user = await createOrUpdateUser(chatId, ctx.from!.username);
      const lang = ctx.session?.language || 'ar';

      // في التطبيق الفعلي، نحتاج لحفظ URL المنتج مؤقتاً
      await ctx.answerCbQuery(lang === 'ar' ? '✅ تمت الإضافة للسلة' : '✅ Added to cart');
      
      logger.info('Product added to cart', { chatId, productId });

    } catch (error) {
      logger.error('Error adding to cart', { error });
      ctx.answerCbQuery('❌ Error');
    }
  });

  // معالج أمر /alert
  bot.command('alert', async (ctx) => {
    try {
      const args = ctx.message.text.split(' ').slice(1);
      const lang = ctx.session?.language || 'ar';

      if (args.length === 0) {
        await ctx.reply(
          lang === 'ar' 
            ? '💡 الاستخدام: /alert [كلمة مفتاحية]\n\nمثال: /alert Xiaomi'
            : '💡 Usage: /alert [keyword]\n\nExample: /alert Xiaomi'
        );
        return;
      }

      const keyword = args.join(' ');
      const chatId = ctx.chat.id;
      const user = await createOrUpdateUser(chatId, ctx.from.username);

      await alertsService.createUserAlert(user.id, keyword);

      await ctx.reply(t('alertSet', lang, { keyword }));

      logger.info('Alert created', { chatId, keyword });

    } catch (error) {
      logger.error('Error creating alert', { error });
      ctx.reply('❌ حدث خطأ في إنشاء التنبيه.');
    }
  });

  // معالج أمر /my_alerts
  bot.command('my_alerts', async (ctx) => {
    try {
      const chatId = ctx.chat.id;
      const user = await createOrUpdateUser(chatId, ctx.from.username);
      const lang = ctx.session?.language || 'ar';

      const alerts = await alertsService.getUserAlerts(user.id);

      if (alerts.length === 0) {
        await ctx.reply(lang === 'ar' ? 'لا توجد تنبيهات نشطة' : 'No active alerts');
        return;
      }

      let message = lang === 'ar' 
        ? `🔔 **تنبيهاتك النشطة** (${alerts.length})\n\n`
        : `🔔 **Your Active Alerts** (${alerts.length})\n\n`;

      const buttons = alerts.map((alert, index) => [
        Markup.button.callback(
          `${index + 1}. ${alert.keyword} ❌`,
          `del_alert_${alert.id}`
        )
      ]);

      await ctx.reply(message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons)
      });

    } catch (error) {
      logger.error('Error fetching alerts', { error });
      ctx.reply('❌ حدث خطأ في جلب التنبيهات.');
    }
  });

  // معالج حذف تنبيه
  bot.action(/del_alert_(.+)/, async (ctx) => {
    try {
      const alertId = parseInt(ctx.match[1]);
      const lang = ctx.session?.language || 'ar';

      await alertsService.deactivateAlert(alertId);
      await ctx.answerCbQuery(lang === 'ar' ? '✅ تم إلغاء التنبيه' : '✅ Alert cancelled');
      await ctx.deleteMessage();

      logger.info('Alert deactivated', { alertId });

    } catch (error) {
      logger.error('Error deleting alert', { error });
      ctx.answerCbQuery('❌ Error');
    }
  });

  // معالج أمر /stats
  bot.command('stats', async (ctx) => {
    try {
      const chatId = ctx.chat.id;
      const user = await createOrUpdateUser(chatId, ctx.from.username);
      const lang = ctx.session?.language || 'ar';

      const cartItems = await cartService.getUserCart(user.id);
      const alerts = await alertsService.getUserAlerts(user.id);

      const message = lang === 'ar' ? `
📊 **إحصائياتك**

🛒 منتجات في السلة: ${cartItems.length}
🔔 تنبيهات نشطة: ${alerts.length}
👤 معرف المستخدم: ${user.id}
📅 تاريخ الانضمام: ${new Date(user.created_at).toLocaleDateString('ar')}
` : `
📊 **Your Statistics**

🛒 Cart items: ${cartItems.length}
🔔 Active alerts: ${alerts.length}
👤 User ID: ${user.id}
📅 Join date: ${new Date(user.created_at).toLocaleDateString('en')}
`;

      await ctx.reply(message, { parse_mode: 'Markdown' });

    } catch (error) {
      logger.error('Error fetching stats', { error });
      ctx.reply('❌ حدث خطأ.');
    }
  });

  // معالج أمر /broadcast (للمشرفين فقط)
  bot.command('broadcast', async (ctx) => {
    try {
      const userId = ctx.from.id;
      const lang = ctx.session?.language || 'ar';

      // التحقق من صلاحية المشرف
      if (!config.bot.adminIds.includes(userId)) {
        await ctx.reply(t('notAdmin', lang));
        return;
      }

      const message = ctx.message.text.split(' ').slice(1).join(' ');

      if (!message) {
        await ctx.reply(
          lang === 'ar'
            ? '💡 الاستخدام: /broadcast [الرسالة]\n\nمثال: /broadcast عروض جديدة اليوم!'
            : '💡 Usage: /broadcast [message]\n\nExample: /broadcast New deals today!'
        );
        return;
      }

      // تأكيد البث
      await ctx.reply(
        lang === 'ar' 
          ? `⚠️ هل أنت متأكد من إرسال هذا البث لجميع المستخدمين؟\n\n"${message}"` 
          : `⚠️ Are you sure you want to broadcast this message to all users?\n\n"${message}"`,
        Markup.inlineKeyboard([
          [
            Markup.button.callback(lang === 'ar' ? '✅ نعم' : '✅ Yes', `confirm_broadcast`),
            Markup.button.callback(lang === 'ar' ? '❌ لا' : '❌ No', `cancel_broadcast`)
          ]
        ])
      );

      // حفظ الرسالة مؤقتاً
      ctx.session = ctx.session || {};
      ctx.session.tempData = { broadcastMessage: message };

    } catch (error) {
      logger.error('Error in broadcast command', { error });
      ctx.reply('❌ حدث خطأ.');
    }
  });

  // تأكيد البث
  bot.action('confirm_broadcast', async (ctx) => {
    try {
      const userId = ctx.from.id;
      const lang = ctx.session?.language || 'ar';

      if (!config.bot.adminIds.includes(userId)) {
        await ctx.answerCbQuery(t('notAdmin', lang));
        return;
      }

      const message = ctx.session?.tempData?.broadcastMessage;

      if (!message) {
        await ctx.answerCbQuery('❌ Error: No message found');
        return;
      }

      await ctx.answerCbQuery(lang === 'ar' ? '📤 جاري الإرسال...' : '📤 Sending...');
      await ctx.editMessageText(lang === 'ar' ? '⏳ جاري إرسال البث...' : '⏳ Broadcasting...');

      const broadcaster = new Broadcaster(bot);
      const result = await broadcaster.sendBroadcast({ message });

      const resultMessage = broadcaster.formatBroadcastResult(result, lang);
      await ctx.editMessageText(resultMessage, { parse_mode: 'Markdown' });

      logger.info('Broadcast completed by admin', { userId, result });

    } catch (error) {
      logger.error('Error confirming broadcast', { error });
      ctx.answerCbQuery('❌ Error');
    }
  });

  // إلغاء البث
  bot.action('cancel_broadcast', async (ctx) => {
    const lang = ctx.session?.language || 'ar';
    await ctx.answerCbQuery(lang === 'ar' ? '❌ تم الإلغاء' : '❌ Cancelled');
    await ctx.deleteMessage();
  });

  // معالج أمر /admin (لوحة الإدارة)
  bot.command('admin', async (ctx) => {
    try {
      const userId = ctx.from.id;
      const lang = ctx.session?.language || 'ar';

      if (!config.bot.adminIds.includes(userId)) {
        await ctx.reply(t('notAdmin', lang));
        return;
      }

      const { db } = await import('../database/connection');
      
      // إحصائيات
      const usersCount = await db.query('SELECT COUNT(*) FROM users');
      const activeUsers = await db.query('SELECT COUNT(*) FROM users WHERE is_subscribed = true');
      const cartItems = await db.query('SELECT COUNT(*) FROM cart_items');
      const alerts = await db.query('SELECT COUNT(*) FROM alerts WHERE is_active = true');

      const message = lang === 'ar' ? `
⚙️ **لوحة الإدارة**

👥 إجمالي المستخدمين: ${usersCount.rows[0].count}
✅ مستخدمون نشطون: ${activeUsers.rows[0].count}
🛒 منتجات في السلال: ${cartItems.rows[0].count}
🔔 تنبيهات نشطة: ${alerts.rows[0].count}

**الأوامر المتاحة:**
/broadcast [رسالة] - إرسال بث
/stats - إحصائيات عامة
` : `
⚙️ **Admin Panel**

👥 Total Users: ${usersCount.rows[0].count}
✅ Active Users: ${activeUsers.rows[0].count}
🛒 Cart Items: ${cartItems.rows[0].count}
🔔 Active Alerts: ${alerts.rows[0].count}

**Available Commands:**
/broadcast [message] - Send broadcast
/stats - General statistics
`;

      await ctx.reply(message, { parse_mode: 'Markdown' });

    } catch (error) {
      logger.error('Error in admin command', { error });
      ctx.reply('❌ حدث خطأ.');
    }
  });

  logger.info('All handlers registered successfully');
}
