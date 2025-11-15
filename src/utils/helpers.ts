import crypto from 'crypto';

// توليد معرف فريد
export function generateUniqueId(): string {
  return crypto.randomBytes(16).toString('hex');
}

// تأخير التنفيذ
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// تنسيق الأسعار
export function formatPrice(price: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('ar-DZ', {
    style: 'currency',
    currency: currency
  }).format(price);
}

// استخراج معرف المنتج من رابط AliExpress
export function extractProductId(url: string): string | null {
  const patterns = [
    /\/item\/(\d+)\.html/,
    /\/(\d+)\.html/,
    /item_id=(\d+)/
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  
  return null;
}

// التحقق من صحة الرابط
export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

// تقسيم المصفوفة لمجموعات
export function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}
