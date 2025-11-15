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

// أدوات أمان للتنسيق
function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function stripHtml(s: string) {
  return s.replace(/<[^>]*>/g, '');
}
function truncate(s: string, max = 180) {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

// غلاف إرسال آمن مع fallback
async function safeReply(ctx: any, html: string, extra: any = {}) {
  try {
    return await ctx.reply(html, { parse_mode: 'HTML', ...extra });
  } catch (e) {
    logger.error('Reply HTML failed, sending plain text', { e });
    return await ctx.reply(stripHtml(html), extra);
  }
}
async function safeSendMessage(bot: Telegraf, chatId: number, html: string, extra: any = {}) {
  try {
    return await bot.telegram.sendMessage(chatId, html, { parse_mode: 'HTML', ...extra });
  } catch (e) {
    logger.error('sendMessage HTML failed, sending plain text', { e });
    return await bot.telegram.sendMessage(chatId, stripHtml(html), extra);
  }
}

export function registerHandlers(bot: Telegraf<BotContext>): void {
  // /start
  bot.start(async (ctx) => {
    try {
      const chatId = ctx.chat.id;
      const username = ctx.from.username;
      await createOrUpdateUser(chatId, username);
      const language = ctx.session?.language || 'ar';
      const welcome = escapeHtml(t('welcome', language));
      await safeReply(ctx, welcome, {
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
      await ctx.reply('❌ حدث خطأ. يرجى المحاولة لاحقاً.');
    }
  });

  // /language
  bot.command('language', async (ctx) => {
    await safeReply(ctx, escapeHtml('اختر اللغة / Choose Language:'), {
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

  // تغيير اللغة
  bot.action(/lang_(.+)/, async (ctx) => {
    try {
      const language = ctx.match[1];
      ctx.session = ctx.session || {};
      ctx.session.language = language;
      await updateUserLanguage(ctx.chat!.id, language);
      await ctx.answerCbQuery();
      await safeReply(ctx, escapeHtml(t('welcome', language)));
      logger.info('Language changed', { chatId: ctx.chat!.id, language });
    } catch (error) {
      logger.error('Error changing language', { error });
      await ctx.answerCbQuery('❌ Error');
    }
  });

  // /help (HTML بدل Markdown)
  bot.command('help', async (ctx) => {
    const lang = ctx.session?.language || 'ar';
    const helpHtml = lang === 'ar' ? `
📚 <b>دليل الاستخدام</b>

🔗 <b>إضافة منتج:</b>
أرسل رابط منتج من AliExpress للحصول على:
• رابط أفلييت مخصص
• السعر الأصلي والحالي
• الكوبونات المتاحة
• السعر النهائي بعد الخصومات

🛒 <b>السلة:</b>
/cart - عرض سلة التسوق
/add_to_cart [رابط] - إضافة منتج للسلة
سيتم مراقبة الأسعار تلقائياً وإرسال تنبيهات عند التغيير

🔔 <b>التنبيهات:</b>
/alert [كلمة] - تفعيل تنبيه للكلمة المفتاحية
/my_alerts - عرض تنبيهاتك النشطة

⚙️ <b>الإعدادات:</b>
/language - تغيير اللغة
/stats - إحصائياتك

<b>للمشرفين فقط:</b>
/broadcast [رسالة] - إرسال بث
/admin - لوحة الإدارة
` : `
📚 <b>User Guide</b>

🔗 <b>Add Product:</b>
Send an AliExpress product link to get:
• Custom affiliate link
• Original/current price
• Available coupons
• Final price after discounts

🛒 <b>Cart:</b>
/cart - View cart
/add_to_cart [link] - Add product

🔔 <b>Alerts:</b>
/alert [keyword] - Set alert
/my_alerts - View alerts

⚙️ <b>Settings:</b>
/language - Change language
/stats - Your stats

<b>Admin only:</b>
/broadcast [message]
/admin
`;
    await safeReply(ctx, helpHtml);
  });

  // معالجة روابط AliExpress
  bot.hears(/https?://(www.)?(aliexpress|ae.aliexpress).com/.+/, async (ctx) => {
    try {
      const url = ctx.message.text;
      const chatId = ctx.chat.id;
      const lang = ctx.session?.language || 'ar';

      const processingMsg = await ctx.reply(t('processing', lang));

      const user = await createOrUpdateUser(chatId, ctx.from.username);

      const affiliateData = await affiliateService.convertToAffiliateLink(url, user.id);
      const pricing = await pricingService.calculateFinalPrice(url);
      const product = await affiliateService.getProductDetails(url);

      const rawTitle = product?.product_title || 'منتج';
      const title = escapeHtml(truncate(rawTitle));
      const affUrl = escapeHtml(affiliateData.affiliateUrl);

      // تأكد أن formatPricingInfo تُنتج HTML
      const pricingHtml = pricingService.formatPricingInfo(pricing, lang);

      const messageHtml = `📦 <b>${title}</b>

${pricingHtml}

🔗 <b>${escapeHtml(t('affiliateLink', lang))}:</b>
${affUrl}`;

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

      await ctx.telegram.deleteMessage(chatId, (processingMsg as any).message_id);
      await safeReply(ctx, messageHtml, {
        link_preview_options: { is_disabled: false },
        ...buttons
      });

      // تنبيهات مطابقة
      if (product) {
        const matches = await alertsService.findAlertMatches(
          product.product_title,
          url,
          pricing.finalPrice,
          pricing.savingsPercentage
        );
        for (const match of matches) {
          if (match.chatId !== chatId) {
            const alertHtml = alertsService.formatAlertMessage(match, lang); // اجعلها تُنتج HTML
            await safeSendMessage(bot, match.chatId, `${alertHtml}

${affUrl}`, {
              link_preview_options: { is_disabled: false }
            });
          }
        }
      }

      logger.info('Product link processed', { chatId, url });
    } catch (error) {
      logger.error('Error processing product link', { error });
      await ctx.reply('❌ لم أتمكن من معالجة هذا الرابط. تأكد أنه رابط صحيح من AliExpress.');
    }
  });

  // /cart
  bot.command('cart', async (ctx) => {
    try {
      const chatId = ctx.chat.id;
      const user = await createOrUpdateUser(chatId, ctx.from.username);
      const lang = ctx.session?.language || 'ar';

      const cartItems = await cartService.getUserCart(user.id);
      // عدّل cartService لتُرجع HTML
      const msgHtml = cartService.formatCartMessage(cartItems, lang);

      if (cartItems.length > 0) {
        const buttons = Markup.inlineKeyboard(
          cartItems.slice(0, 10).map((item, index) => [
            Markup.button.callback(
              `${index + 1}. ${truncate(item.title, 30)}`,
              `view_cart_${item.id}`
            )
          ])
        );
        await safeReply(ctx, msgHtml, { ...buttons });
      } else {
        await safeReply(ctx, msgHtml);
      }
    } catch (error) {
      logger.error('Error fetching cart', { error });
      await ctx.reply('❌ حدث خطأ في جلب السلة.');
    }
  });

  // إضافة للسلة (زر)
  bot.action(/add_cart_(.+)/, async (ctx) => {
    try {
      const productId = ctx.match[1];
      const chatId = ctx.chat!.id;
      await createOrUpdateUser(chatId, ctx.from!.username);
      const lang = ctx.session?.language || 'ar';
      await ctx.answerCbQuery(lang === 'ar' ? '✅ تمت الإضافة للسلة' : '✅ Added to cart');
      logger.info('Product added to cart', { chatId, productId });
    } catch (error) {
      logger.error('Error adding to cart', { error });
      await ctx.answerCbQuery('❌ Error');
    }
  });

  // /alert
  bot.command('alert', async (ctx) => {
    try {
      const args = ctx.message.text.split(' ').slice(1);
      const lang = ctx.session?.language || 'ar';

      if (args.length === 0) {
        await safeReply(ctx, lang === 'ar'
          ? '💡 الاستخدام: /alert [كلمة مفتاحية]

مثال: /alert Xiaomi'
          : '💡 Usage: /alert [keyword]

Example: /alert Xiaomi');
        return;
      }

      const keyword = args.join(' ');
      const chatId = ctx.chat.id;
      const user = await createOrUpdateUser(chatId, ctx.from.username);

      await alertsService.createUserAlert(user.id, keyword);
      await safeReply(ctx, escapeHtml(t('alertSet', lang, { keyword })));
      logger.info('Alert created', { chatId, keyword });
    } catch (error) {
      logger.error('Error creating alert', { error });
      await ctx.reply('❌ حدث خطأ في إنشاء التنبيه.');
    }
  });

  // /my_alerts
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

      const header = lang === 'ar'
        ? `🔔 <b>تنبيهاتك النشطة</b> (${alerts.length})

`
        : `🔔 <b>Your Active Alerts</b> (${alerts.length})

`;

      const buttons = alerts.map((alert, index) => [
        Markup.button.callback(
          `${index + 1}. ${truncate(alert.keyword, 40)} ❌`,
          `del_alert_${alert.id}`
        )
      ]);

      await safeReply(ctx, header, { ...Markup.inlineKeyboard(buttons) });
    } catch (error) {
      logger.error('Error fetching alerts', { error });
      await ctx.reply('❌ حدث خطأ في جلب التنبيهات.');
    }
  });

  // حذف تنبيه
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
      await ctx.answerCbQuery('❌ Error');
    }
  });

  // /stats
  bot.command('stats', async (ctx) => {
    try {
      const chatId = ctx.chat.id;
      const user = await createOrUpdateUser(chatId, ctx.from.username);
      const lang = ctx.session?.language || 'ar';

      const cartItems = await cartService.getUserCart(user.id);
      const alerts = await alertsService.getUserAlerts(user.id);

      const message = lang === 'ar' ? `
📊 <b>إحصائياتك</b>

🛒 منتجات في السلة: ${cartItems.length}
🔔 تنبيهات نشطة: ${alerts.length}
👤 معرف المستخدم: ${user.id}
📅 تاريخ الانضمام: ${new Date(user.created_at).toLocaleDateString('ar')}
` : `
📊 <b>Your Statistics</b>

🛒 Cart items: ${cartItems.length}
🔔 Active alerts: ${alerts.length}
👤 User ID: ${user.id}
📅 Join date: ${new Date(user.created_at).toLocaleDateString('en')}
`;

      await safeReply(ctx, escapeHtml(message).replace(/
/g, '
'));
    } catch (error) {
      logger.error('Error fetching stats', { error });
      await ctx.reply('❌ حدث خطأ.');
    }
  });

  // /broadcast (Admins)
  bot.command('broadcast', async (ctx) => {
    try {
      const userId = ctx.from.id;
      const lang = ctx.session?.language || 'ar';
      if (!config.bot.adminIds.includes(userId)) {
        await ctx.reply(t('notAdmin', lang));
        return;
      }
      const message = ctx.message.text.split(' ').slice(1).join(' ');
      if (!message) {
        await safeReply(ctx, lang === 'ar'
          ? '💡 الاستخدام: /broadcast [الرسالة]

مثال: /broadcast عروض جديدة اليوم!'
          : '💡 Usage: /broadcast [message]

Example: /broadcast New deals today!');
        return;
      }
      await safeReply(ctx,
        lang === 'ar'
          ? `⚠️ هل أنت متأكد من إرسال هذا البث لجميع المستخدمين؟

"${escapeHtml(truncate(message, 500))}"`
          : `⚠️ Are you sure you want to broadcast this message to all users?

"${escapeHtml(truncate(message, 500))}"`,
        Markup.inlineKeyboard([
          [
            Markup.button.callback(lang === 'ar' ? '✅ نعم' : '✅ Yes', `confirm_broadcast`),
            Markup.button.callback(lang === 'ar' ? '❌ لا' : '❌ No', `cancel_broadcast`)
          ]
        ])
      );
      ctx.session = ctx.session || {};
      ctx.session.tempData = { broadcastMessage: message };
    } catch (error) {
      logger.error('Error in broadcast command', { error });
      await ctx.reply('❌ حدث خطأ.');
    }
  });

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
      const result = await broadcaster.sendBroadcast({ message, parseMode: 'HTML' });
      const resultMsg =
        lang === 'ar'
          ? `📊 <b>نتيجة البث</b>

✅ نجح: ${result.successCount}
❌ فشل: ${result.failureCount}
📮 الإجمالي: ${result.totalRecipients}
⏱ المدة: ${(result.duration / 1000).toFixed(1)}ث`
          : `📊 <b>Broadcast Results</b>

✅ Success: ${result.successCount}
❌ Failed: ${result.failureCount}
📮 Total: ${result.totalRecipients}
⏱ Duration: ${(result.duration / 1000).toFixed(1)}s`;
      try {
        await ctx.editMessageText(resultMsg, { parse_mode: 'HTML' });
      } catch {
        await ctx.editMessageText(stripHtml(resultMsg));
      }
      logger.info('Broadcast completed by admin', { userId, result });
    } catch (error) {
      logger.error('Error confirming broadcast', { error });
      await ctx.answerCbQuery('❌ Error');
    }
  });

  bot.action('cancel_broadcast', async (ctx) => {
    const lang = ctx.session?.language || 'ar';
    await ctx.answerCbQuery(lang === 'ar' ? '❌ تم الإلغاء' : '❌ Cancelled');
    try { await ctx.deleteMessage(); } catch {}
  });

  // /admin
  bot.command('admin', async (ctx) => {
    try {
      const userId = ctx.from.id;
      const lang = ctx.session?.language || 'ar';
      if (!config.bot.adminIds.includes(userId)) {
        await ctx.reply(t('notAdmin', lang));
        return;
      }
      const { db } = await import('../database/connection');
      const usersCount = await db.query('SELECT COUNT(*) FROM users');
      const activeUsers = await db.query('SELECT COUNT(*) FROM users WHERE is_subscribed = true');
      const cartItems = await db.query('SELECT COUNT(*) FROM cart_items');
      const alerts = await db.query('SELECT COUNT(*) FROM alerts WHERE is_active = true');

      const message = lang === 'ar' ? `
⚙️ <b>لوحة الإدارة</b>

👥 إجمالي المستخدمين: ${usersCount.rows[0].count}
✅ مستخدمون نشطون: ${activeUsers.rows[0].count}
🛒 منتجات في السلال: ${cartItems.rows[0].count}
🔔 تنبيهات نشطة: ${alerts.rows[0].count}

<b>الأوامر المتاحة:</b>
/broadcast [رسالة]
/stats
` : `
⚙️ <b>Admin Panel</b>

👥 Total Users: ${usersCount.rows[0].count}
✅ Active Users: ${activeUsers.rows[0].count}
🛒 Cart Items: ${cartItems.rows[0].count}
🔔 Active Alerts: ${alerts.rows[0].count}

<b>Commands:</b>
/broadcast [message]
/stats
`;
      await safeReply(ctx, escapeHtml(message).replace(/
/g, '
'));
    } catch (error) {
      logger.error('Error in admin command', { error });
      await ctx.reply('❌ حدث خطأ.');
    }
  });

  logger.info('All handlers registered successfully');
}
