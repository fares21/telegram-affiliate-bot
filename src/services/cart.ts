import { db } from '../database/connection';
import { getCartItems, addToCart, updateCartItemPrice } from '../database/models';
import { affiliateService } from './affiliate';
import { pricingService } from './pricing';
import { logger } from '../utils/logger';

interface CartPriceChange {
  itemId: number;
  productTitle: string;
  oldPrice: number;
  newPrice: number;
  priceChange: number;
  percentageChange: number;
}

class CartService {
  // إضافة منتج للسلة
  async addProductToCart(userId: number, productUrl: string): Promise<any> {
    try {
      // جلب تفاصيل المنتج
      const product = await affiliateService.getProductDetails(productUrl);
      
      if (!product) {
        throw new Error('Product not found');
      }

      const price = parseFloat(product.sale_price || product.target_sale_price || 0);
      const title = product.product_title || 'Unknown Product';

      // إضافة للقاعدة
      const cartItem = await addToCart(userId, productUrl, title, price);

      logger.info('Product added to cart', { userId, productUrl, title });

      return {
        success: true,
        item: cartItem,
        product: {
          title,
          price,
          image: product.product_main_image_url
        }
      };

    } catch (error) {
      logger.error('Error adding product to cart', { error, userId, productUrl });
      throw error;
    }
  }

  // جلب سلة المستخدم
  async getUserCart(userId: number): Promise<any[]> {
    try {
      const items = await getCartItems(userId);
      
      return items.map(item => ({
        id: item.id,
        title: item.product_title,
        url: item.product_url,
        currentPrice: item.current_price,
        originalPrice: item.original_price,
        priceChange: item.current_price - item.original_price,
        lastChecked: item.last_checked
      }));

    } catch (error) {
      logger.error('Error fetching user cart', { error, userId });
      throw error;
    }
  }

  // فحص تغييرات الأسعار
  async checkPriceChanges(userId: number): Promise<CartPriceChange[]> {
    try {
      const cartItems = await getCartItems(userId);
      const changes: CartPriceChange[] = [];

      for (const item of cartItems) {
        try {
          // جلب السعر الحالي
          const product = await affiliateService.getProductDetails(item.product_url);
          
          if (!product) continue;

          const newPrice = parseFloat(product.sale_price || product.target_sale_price || 0);
          const oldPrice = item.current_price;

          // إذا تغير السعر
          if (Math.abs(newPrice - oldPrice) > 0.01) {
            const priceChange = newPrice - oldPrice;
            const percentageChange = (priceChange / oldPrice) * 100;

            changes.push({
              itemId: item.id,
              productTitle: item.product_title,
              oldPrice,
              newPrice,
              priceChange,
              percentageChange
            });

            // تحديث السعر في القاعدة
            await updateCartItemPrice(item.id, newPrice);

            logger.info('Price change detected', { 
              itemId: item.id, 
              oldPrice, 
              newPrice, 
              percentageChange 
            });
          }

        } catch (itemError) {
          logger.error('Error checking item price', { itemError, itemId: item.id });
        }
      }

      return changes;

    } catch (error) {
      logger.error('Error checking price changes', { error, userId });
      throw error;
    }
  }

  // حذف منتج من السلة
  async removeFromCart(itemId: number): Promise<void> {
    try {
      await db.query('DELETE FROM cart_items WHERE id = $1', [itemId]);
      logger.info('Item removed from cart', { itemId });
    } catch (error) {
      logger.error('Error removing item from cart', { error, itemId });
      throw error;
    }
  }

  // تنسيق رسالة السلة
  formatCartMessage(cartItems: any[], lang: string = 'ar'): string {
    if (cartItems.length === 0) {
      return lang === 'ar' ? '🛒 السلة فارغة' : '🛒 Cart is empty';
    }

    let message = lang === 'ar' 
      ? `🛒 **سلة التسوق** (${cartItems.length} منتجات)\n\n`
      : `🛒 **Shopping Cart** (${cartItems.length} items)\n\n`;

    cartItems.forEach((item, index) => {
      const emoji = item.priceChange < 0 ? '📉' : item.priceChange > 0 ? '📈' : '➖';
      
      message += `${index + 1}. ${item.title.substring(0, 50)}...\n`;
      message += `   ${emoji} ${lang === 'ar' ? 'السعر:' : 'Price:'} $${item.currentPrice.toFixed(2)}`;
      
      if (item.priceChange !== 0) {
        const change = item.priceChange > 0 ? `+$${item.priceChange.toFixed(2)}` : `-$${Math.abs(item.priceChange).toFixed(2)}`;
        message += ` (${change})`;
      }
      
      message += '\n\n';
    });

    return message;
  }

  // تنسيق رسالة تنبيه تغيير السعر
  formatPriceChangeAlert(change: CartPriceChange, lang: string = 'ar'): string {
    const emoji = change.priceChange < 0 ? '🎉📉' : '⚠️📈';
    const direction = change.priceChange < 0 
      ? (lang === 'ar' ? 'انخفض' : 'decreased')
      : (lang === 'ar' ? 'ارتفع' : 'increased');

    let message = lang === 'ar'
      ? `${emoji} **تغيير في السعر!**\n\n`
      : `${emoji} **Price Change Alert!**\n\n`;

    message += `📦 ${change.productTitle.substring(0, 60)}...\n\n`;
    message += lang === 'ar'
      ? `السعر السابق: $${change.oldPrice.toFixed(2)}\n`
      : `Previous Price: $${change.oldPrice.toFixed(2)}\n`;
    
    message += lang === 'ar'
      ? `السعر الجديد: $${change.newPrice.toFixed(2)}\n`
      : `New Price: $${change.newPrice.toFixed(2)}\n`;
    
    message += lang === 'ar'
      ? `التغيير: ${direction} بنسبة ${Math.abs(change.percentageChange).toFixed(1)}%`
      : `Change: ${direction} by ${Math.abs(change.percentageChange).toFixed(1)}%`;

    return message;
  }
}

export const cartService = new CartService();
