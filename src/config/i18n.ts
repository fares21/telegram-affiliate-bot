// نظام الترجمة البسيط
export const translations = {
  ar: {
    welcome: '🎉 مرحباً بك في بوت العروض والخصومات!\n\nاختر من القائمة أدناه:',
    addToCart: '🛒 أضف إلى السلة',
    setAlert: '🔔 تفعيل التنبيهات',
    viewCart: '📦 عرض السلة',
    help: '❓ المساعدة',
    sendLink: '📎 أرسل رابط المنتج لتحويله لرابط أفلييت:',
    processing: '⏳ جاري المعالجة...',
    productInfo: '📦 معلومات المنتج',
    originalPrice: 'السعر الأصلي',
    finalPrice: 'السعر النهائي',
    savings: 'التوفير',
    affiliateLink: '🔗 رابط الأفلييت',
    coupons: '🎫 الكوبونات المتاحة',
    adminPanel: '⚙️ لوحة الإدارة',
    broadcast: '📢 إرسال بث',
    stats: '📊 الإحصائيات',
    broadcastSuccess: '✅ تم إرسال البث بنجاح!\n\nالمستلمين: {total}\nالنجاح: {success}\nالفشل: {failure}',
    error: '❌ حدث خطأ: {message}',
    notAdmin: '⛔ هذا الأمر متاح للمشرفين فقط',
    cartEmpty: 'السلة فارغة',
    alertSet: '✅ تم تفعيل التنبيه للكلمة: {keyword}'
  },
  en: {
    welcome: '🎉 Welcome to Affiliate Offers Bot!\n\nChoose from the menu below:',
    addToCart: '🛒 Add to Cart',
    setAlert: '🔔 Set Alert',
    viewCart: '📦 View Cart',
    help: '❓ Help',
    sendLink: '📎 Send product link to convert to affiliate link:',
    processing: '⏳ Processing...',
    productInfo: '📦 Product Information',
    originalPrice: 'Original Price',
    finalPrice: 'Final Price',
    savings: 'Savings',
    affiliateLink: '🔗 Affiliate Link',
    coupons: '🎫 Available Coupons',
    adminPanel: '⚙️ Admin Panel',
    broadcast: '📢 Send Broadcast',
    stats: '📊 Statistics',
    broadcastSuccess: '✅ Broadcast sent successfully!\n\nRecipients: {total}\nSuccess: {success}\nFailure: {failure}',
    error: '❌ Error: {message}',
    notAdmin: '⛔ This command is for admins only',
    cartEmpty: 'Cart is empty',
    alertSet: '✅ Alert set for keyword: {keyword}'
  }
};

export function t(key: string, lang: string = 'ar', params: Record<string, any> = {}): string {
  const langTranslations = translations[lang as keyof typeof translations] || translations.ar;
  let text = langTranslations[key as keyof typeof langTranslations] || key;
  
  // استبدال المتغيرات
  Object.keys(params).forEach(param => {
    text = text.replace(`{${param}}`, params[param]);
  });
  
  return text;
}
