import { logger } from '../utils/logger';
import { affiliateService } from './affiliate';

export interface CouponInfo {
  type: 'seller' | 'platform' | 'select' | 'coins';
  amount: number;
  description: string;
  conditions: string[];
}

export interface PricingInfo {
  originalPrice: number;
  currentPrice: number;
  coupons: CouponInfo[];
  finalPrice: number;
  savings: number;
  savingsPercentage: number;
}

class PricingService {
  // محاكاة جلب الكوبونات المتاحة (في الواقع يجب استدعاء API)
  async getAvailableCoupons(productId: string, price: number): Promise<CouponInfo[]> {
    const coupons: CouponInfo[] = [];

    // كوبون البائع (محاكاة)
    if (price > 50) {
      coupons.push({
        type: 'seller',
        amount: Math.min(price * 0.10, 20),
        description: 'خصم البائع',
        conditions: ['صالح على طلبات أكثر من 50$']
      });
    }

    // كوبون المنصة
    if (price > 100) {
      coupons.push({
        type: 'platform',
        amount: Math.min(price * 0.05, 15),
        description: 'كوبون AliExpress',
        conditions: ['للمشتريات فوق 100$']
      });
    }

    // Select Coupon
    coupons.push({
      type: 'select',
      amount: 5,
      description: 'كوبون Select',
      conditions: ['متاح لأعضاء AliExpress Plus']
    });

    // Coins
    const coinsValue = Math.min(price * 0.02, 10);
    coupons.push({
      type: 'coins',
      amount: coinsValue,
      description: 'عملات AliExpress',
      conditions: ['استخدام العملات المتوفرة في حسابك']
    });

    return coupons;
  }

  // حساب السعر النهائي مع جميع الخصومات
  async calculateFinalPrice(productUrl: string): Promise<PricingInfo> {
    try {
      // جلب تفاصيل المنتج
      const product = await affiliateService.getProductDetails(productUrl);
      
      if (!product) {
        throw new Error('Product not found');
      }

      const originalPrice = parseFloat(product.original_price || product.target_original_price || 0);
      const currentPrice = parseFloat(product.sale_price || product.target_sale_price || originalPrice);
      
      // جلب الكوبونات المتاحة
      const coupons = await this.getAvailableCoupons(product.product_id, currentPrice);
      
      // حساب الخصم الإجمالي
      const totalDiscount = coupons.reduce((sum, coupon) => sum + coupon.amount, 0);
      const finalPrice = Math.max(currentPrice - totalDiscount, 0);
      const savings = originalPrice - finalPrice;
      const savingsPercentage = (savings / originalPrice) * 100;

      logger.info('Price calculated', { 
        productId: product.product_id, 
        originalPrice, 
        finalPrice, 
        savings 
      });

      return {
        originalPrice,
        currentPrice,
        coupons,
        finalPrice,
        savings,
        savingsPercentage
      };

    } catch (error) {
      logger.error('Error calculating price', { error, productUrl });
      throw error;
    }
  }

  // تنسيق معلومات السعر للعرض
  formatPricingInfo(pricing: PricingInfo, lang: string = 'ar'): string {
    const currencySymbol = '$';
    
    let message = lang === 'ar' 
      ? `💰 **تفاصيل السعر:**\n\n`
      : `💰 **Price Details:**\n\n`;

    message += lang === 'ar'
      ? `السعر الأصلي: ${pricing.originalPrice.toFixed(2)}${currencySymbol}\n`
      : `Original Price: ${currencySymbol}${pricing.originalPrice.toFixed(2)}\n`;

    message += lang === 'ar'
      ? `السعر الحالي: ${pricing.currentPrice.toFixed(2)}${currencySymbol}\n\n`
      : `Current Price: ${currencySymbol}${pricing.currentPrice.toFixed(2)}\n\n`;

    if (pricing.coupons.length > 0) {
      message += lang === 'ar' ? `🎫 **الكوبونات المتاحة:**\n` : `🎫 **Available Coupons:**\n`;
      
      pricing.coupons.forEach(coupon => {
        message += `  • ${coupon.description}: -${coupon.amount.toFixed(2)}${currencySymbol}\n`;
      });
      
      message += '\n';
    }

    message += lang === 'ar'
      ? `✨ **السعر النهائي:** ${pricing.finalPrice.toFixed(2)}${currencySymbol}\n`
      : `✨ **Final Price:** ${currencySymbol}${pricing.finalPrice.toFixed(2)}\n`;

    message += lang === 'ar'
      ? `💵 **التوفير:** ${pricing.savings.toFixed(2)}${currencySymbol} (${pricing.savingsPercentage.toFixed(1)}%)`
      : `💵 **You Save:** ${currencySymbol}${pricing.savings.toFixed(2)} (${pricing.savingsPercentage.toFixed(1)}%)`;

    return message;
  }
}

export const pricingService = new PricingService();
