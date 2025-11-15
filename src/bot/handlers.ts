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

// دوال مساعدة للتنسيق الآمن
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, '');
}

function truncate(s: string, max: number = 180): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

// إرسال آمن مع fallback
async function safeReply(ctx: any, html: string, extra: any = {}): Promise<any> {
  try {
    return await ctx.reply(html, { parse_mode: 'HTML', ...extra });
  } catch (e) {
    logger.error('safeReply HTML failed, sending plain text', { e });
    return await ctx.reply(stripHtml(html), extra);
  }
}

async function safeSendMessage(
  bot: Telegraf,
  chatId: number,
  html: string,
  extra: any = {}
): Promise<any> {
  try {
    return await bot.telegram.sendMessage(chatId, html, {
      parse_mode: 'HTML',
      ...extra
    });
  } catch (e) {
    logger.error('safeSendMessage HTML failed, sending plain text', { e });
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
            [
              { text: t('addToCart', language) },
              { text: t('viewCart', language) }
            ],
            [
              { text: t('setAlert', language) },
              { text: t('help', language) }
            ]
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
    const txt = 'اختر اللغة / Choose Language:';
    await safeReply(ctx, escapeHtml(txt), {
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

  // /help
  bot.command('help', async (ctx) => {
    const lang = ctx.session?.language || 'ar';

    const helpHtmlAr = '📚 <b>دليل الاستخدام</b>

' +
      '🔗 <b>إضافة منتج:</b>
' +
      'أرسل رابط منتج من AliExpress للحصول على:
' +
      '• رابط أفلييت مخصص
' +
      '• السعر الأصلي والحالي
' +
      '• الكوبونات المتاحة
' +
      '• السعر النهائي بعد الخصومات

' +
      '🛒 <b>السلة:</b>
' +
      '/cart - عرض سلة التسوق
' +
      '/add_to_cart [رابط] - إضافة منتج للسلة
' +
      'سيتم مراقبة الأسعار تلقائياً وإرسال تنبيهات عند التغيير

' +
      '🔔 <b>التنبيهات:</b>
' +
      '/alert [كلمة] - تفعيل تنبيه للكلمة المفتاحية
' +
      '/my_alerts - عرض تنبيهاتك النشطة

' +
      '⚙️ <b>الإعدادات:</b>
' +
      '/language - تغيير اللغة
' +
      '/stats - إحصائياتك

' +
      '<b>للمشرفين فقط:</b>
' +
      '/broadcast [رسالة]
' +
      '/admin';

    const helpHtmlEn = '📚 <b>User Guide</b>

' +
      '🔗 <b>Add Product:</b>
' +
      'Send an AliExpress product link to get:
' +
      '• Custom affiliate link
' +
      '• Original/current price
' +
      '• Available coupons
' +
      '• Final price after discounts

' +
      '🛒 <b>Cart:</b>
' +
      '/cart - View cart
' +
      '/add_to_cart [link] - Add product

' +
      '🔔 <b>Alerts:</b>
' +
      '/alert [keyword] - Set alert
' +
      '/my_alerts - View alerts

' +
      '⚙️ <b>Settings:</b>
' +
      '/language - Change language
' +
      '/stats - Your stats

' +
      '<b>Admin only:</b>
' +
      '/broadcast [message]
' +
      '/admin';

    const helpHtml = lang === 'ar' ? helpHtmlAr : helpHtmlEn;
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
      const pricingHtml = pricingService.formatPricingInfo(pricing, lang); // يجب أن تكون HTML

      const header = '📦 <b>' + title + '</b>

';
      const footer = '

' +
        '🔗 <b>' + escapeHtml(t('affiliateLink', lang)) + ':</b>
' +
        affUrl;

      const messageHtml = header + pricingHtml + footer;

      const buttons = Markup.inlineKeyboard([
        [
          Markup.button.url(
            lang === 'ar' ? '🛍 زيارة المنتج' : '🛍 Visit Product',
            affiliateData.affiliateUrl
          )
        ],
        [
          Markup.button.callback(
            lang === 'ar' ? '🛒 إضافة للسلة' : '🛒 Add to Cart',
            'add_cart_' + (product?.product_id || '')
          )
        ],
        [
          Markup.button.callback(
            lang === 'ar' ? '📤 مشاركة' : '📤 Share',
            'share_' + (product?.product_id || '')
          )
        ]
      ]);

      await ctx.telegram.deleteMessage(chatId, (processingMsg as any).message_id);
      await safeReply(ctx, messageHtml, {
        link_preview_options: { is_disabled: false },
        ...buttons
      });

      if (product) {
        const matches = await alertsService.findAlertMatches(
          product.product_title,
          url,
          pricing.finalPrice,
          pricing.savingsPercentage
        );

        for (const match of matches) {
          if (match.chatId !== chatId) {
            const alertHtml = alertsService.formatAlertMessage(match, lang); // HTML
            const fullAlert = alertHtml + '

' + affUrl;
            await safeSendMessage(bot, match.chatId, fullAlert, {
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
      const msgHtml = cartService.formatCartMessage(cartItems, lang); // HTML

      if (cartItems.length > 0) {
        const buttons = Markup.inlineKeyboard(
          cartItems.slice(0, 10).map((item: any, index: number) => {
            const label = (index + 1).toString() + '. ' + truncate(item.title, 30);
            return [
              Markup.button.callback(
                label,
                'view_cart_' + item.id
              )
            ];
          })
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

      await ctx.answerCbQuery(
        lang === 'ar' ? '✅ تمت الإضافة للسلة' : '✅ Added to cart'
      );

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
        const txtAr = '💡 الاستخدام: /alert [كلمة مفتاحية]

مثال: /alert Xiaomi';
        const txtEn = '💡 Usage: /alert [keyword]

Example: /alert Xiaomi';
        await safeReply(ctx, lang === 'ar' ? txtAr : txtEn);
        return;
      }

      const keyword = args.join(' ');
      const chatId = ctx.chat.id;
      const user = await createOrUpdateUser(chatId, ctx.from.username);

      await alertsService.createUserAlert(user.id, keyword);

      const msg = t('alertSet', lang, { keyword });
      await safeReply(ctx, escapeHtml(msg));

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

      const headerAr = '🔔 <b>تنبيهاتك النشطة</b> (' + alerts.length.toString() + ')

';
      const headerEn = '🔔 <b>Your Active Alerts</b> (' + alerts.length.toString() + ')

';

      const header = lang === 'ar' ? headerAr : headerEn;

      const buttons = alerts.map((alert: any, index: number) => {
        const label = (index + 1).toString() + '. ' + truncate(alert.keyword, 40) + ' ❌';
        return [
          Markup.button.callback(
            label,
            'del_alert_' + alert.id.toString()
          )
        ];
      });

      await safeReply(ctx, header, { ...Markup.inlineKeyboard(buttons) });
    } catch (error) {
      logger.error('Error fetching alerts', { error });
      await ctx.reply('❌ حدث خطأ في جلب التنبيهات.');
    }
  });

  // حذف تنبيه
  bot.action(/del_alert_(.+)/, async (ctx) => {
    try {
      const alertId = parseInt(ctx.match[1], 10);
      const lang = ctx.session?.language || 'ar';

      await alertsService.deactivateAlert(alertId);
      await ctx.answerCbQuery(
        lang === 'ar' ? '✅ تم إلغاء التنبيه' : '✅ Alert cancelled'
      );
      try {
        await ctx.deleteMessage();
      } catch (e) {
        logger.warn('Failed to delete alert message', { e });
      }

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

      const ar =
        '📊 <b>إحصائياتك</b>

' +
        '🛒 منتجات في السلة: ' + cartItems.length.toString() + '
' +
        '🔔 تنبيهات نشطة: ' + alerts.length.toString() + '
' +
        '👤 معرف المستخدم: ' + user.id.toString() + '
' +
        '📅 تاريخ الانضمام: ' + new Date(user.created_at).toLocaleDateString('ar');

      const en =
        '📊 <b>Your Statistics</b>

' +
        '🛒 Cart items: ' + cartItems.length.toString() + '
' +
        '🔔 Active alerts: ' + alerts.length.toString() + '
' +
        '👤 User ID: ' + user.id.toString() + '
' +
        '📅 Join date: ' + new Date(user.created_at).toLocaleDateString('en');

      const message = lang === 'ar' ? ar : en;

      await safeReply(ctx, escapeHtml(message).replace(/
/g, '
'));
    } catch (error) {
      logger.error('Error fetching stats', { error });
      await ctx.reply('❌ حدث خطأ.');
    }
  });

  // /broadcast
  bot.command('broadcast', async (ctx) => {
    try {
      const userId = ctx.from.id;
      const lang = ctx.session?.language || 'ar';

      if (!config.bot.adminIds.includes(userId)) {
        await ctx.reply(t('notAdmin', lang));
        return;
      }

      const parts = ctx.message.text.split(' ').slice(1);
      const msg = parts.join(' ');

      if (!msg) {
        const ar = '💡 الاستخدام: /broadcast [الرسالة]

مثال: /broadcast عروض جديدة اليوم!';
        const en = '💡 Usage: /broadcast [message]

Example: /broadcast New deals today!';
        await safeReply(ctx, lang === 'ar' ? ar : en);
        return;
      }

      const preview = truncate(msg, 500);
      const questionAr =
        '⚠️ هل أنت متأكد من إرسال هذا البث لجميع المستخدمين؟

"' +
        escapeHtml(preview) +
        '"';
      const questionEn =
        '⚠️ Are you sure you want to broadcast this message to all users?

"' +
        escapeHtml(preview) +
        '"';

      const question = lang === 'ar' ? questionAr : questionEn;

      await safeReply(ctx, question, Markup.inlineKeyboard([
        [
          Markup.button.callback(lang === 'ar' ? '✅ نعم' : '✅ Yes', 'confirm_broadcast'),
          Markup.button.callback(lang === 'ar' ? '❌ لا' : '❌ No', 'cancel_broadcast')
        ]
      ]));

      ctx.session = ctx.session || {};
      ctx.session.tempData = { broadcastMessage: msg };
    } catch (error) {
      logger.error('Error in broadcast command', { error });
      await ctx.reply('❌ حدث خطأ.');
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

      const temp = ctx.session?.tempData;
      const msg: string | undefined = temp?.broadcastMessage;

      if (!msg) {
        await ctx.answerCbQuery('❌ Error: No message found');
        return;
      }

      await ctx.answerCbQuery(lang === 'ar' ? '📤 جاري الإرسال...' : '📤 Sending...');
      await ctx.editMessageText(lang === 'ar' ? '⏳ جاري إرسال البث...' : '⏳ Broadcasting...');

      const broadcaster = new Broadcaster(bot);
      const result = await broadcaster.sendBroadcast({
        message: msg,
        parseMode: 'HTML'
      });

      const dur = (result.duration / 1000).toFixed(1);

      const textAr =
        '📊 <b>نتيجة البث</b>

' +
        '✅ نجح: ' + result.successCount.toString() + '
' +
        '❌ فشل: ' + result.failureCount.toString() + '
' +
        '📮 الإجمالي: ' + result.totalRecipients.toString() + '
' +
        '⏱ المدة: ' + dur + 'ث';

      const textEn =
        '📊 <b>Broadcast Results</b>

' +
        '✅ Success: ' + result.successCount.toString() + '
' +
        '❌ Failed: ' + result.failureCount.toString() + '
' +
        '📮 Total: ' + result.totalRecipients.toString() + '
' +
        '⏱ Duration: ' + dur + 's';

      const finalTxt = lang === 'ar' ? textAr : textEn;

      try {
        await ctx.editMessageText(finalTxt, { parse_mode: 'HTML' });
      } catch (e) {
        logger.warn('editMessageText HTML failed', { e });
        await ctx.editMessageText(stripHtml(finalTxt));
      }

      logger.info('Broadcast completed by admin', { userId, result });
    } catch (error) {
      logger.error('Error confirming broadcast', { error });
      await ctx.answerCbQuery('❌ Error');
    }
  });

  // إلغاء البث
  bot.action('cancel_broadcast', async (ctx) => {
    const lang = ctx.session?.language || 'ar';
    await ctx.answerCbQuery(lang === 'ar' ? '❌ تم الإلغاء' : '❌ Cancelled');
    try {
      await ctx.deleteMessage();
    } catch (e) {
      logger.warn('Failed to delete broadcast message', { e });
    }
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

      const ar =
        '⚙️ <b>لوحة الإدارة</b>

' +
        '👥 إجمالي المستخدمين: ' + usersCount.rows[0].count + '
' +
        '✅ مستخدمون نشطون: ' + activeUsers.rows[0].count + '
' +
        '🛒 منتجات في السلال: ' + cartItems.rows[0].count + '
' +
        '🔔 تنبيهات نشطة: ' + alerts.rows[0].count + '

' +
        '<b>الأوامر المتاحة:</b>
' +
        '/broadcast [رسالة]
' +
        '/stats';

      const en =
        '⚙️ <b>Admin Panel</b>

' +
        '👥 Total Users: ' + usersCount.rows[0].count + '
' +
        '✅ Active Users: ' + activeUsers.rows[0].count + '
' +
        '🛒 Cart Items: ' + cartItems.rows[0].count + '
' +
        '🔔 Active Alerts: ' + alerts.rows[0].count + '

' +
        '<b>Commands:</b>
' +
        '/broadcast [message]
' +
        '/stats';

      const txt = lang === 'ar' ? ar : en;

      await safeReply(ctx, escapeHtml(txt).replace(/
/g, '
'));
    } catch (error) {
      logger.error('Error in admin command', { error });
      await ctx.reply('❌ حدث خطأ.');
    }
  });

  logger.info('All handlers registered successfully');
}
