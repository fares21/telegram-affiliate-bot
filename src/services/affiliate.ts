import axios from 'axios';
import crypto from 'crypto';
import { config } from '../config/environment';
import { logger } from '../utils/logger';
import { extractProductId } from '../utils/helpers';

interface AffiliateResponse {
  affiliateUrl: string;
  originalUrl: string;
  commission: number;
}

class AffiliateService {
  private appKey: string;
  private appSecret: string;
  private trackingId: string;

  constructor() {
    this.appKey = config.aliexpress.appKey;
    this.appSecret = config.aliexpress.appSecret;
    this.trackingId = config.aliexpress.trackingId;
  }

  // توليد التوقيع للطلبات
  private generateSignature(params: Record<string, any>): string {
    const sortedKeys = Object.keys(params).sort();
    let signString = this.appSecret;
    
    sortedKeys.forEach(key => {
      signString += key + params[key];
    });
    
    signString += this.appSecret;
    
    return crypto
      .createHash('md5')
      .update(signString, 'utf8')
      .digest('hex')
      .toUpperCase();
  }

  // تحويل الرابط لرابط أفلييت
  async convertToAffiliateLink(productUrl: string, userId: number): Promise<AffiliateResponse> {
    try {
      const productId = extractProductId(productUrl);
      
      if (!productId) {
        throw new Error('Invalid product URL');
      }

      // معاملات الطلب
      const params: Record<string, any> = {
        app_key: this.appKey,
        method: 'aliexpress.affiliate.link.generate',
        timestamp: Date.now(),
        format: 'json',
        v: '2.0',
        sign_method: 'md5',
        promotion_link_type: '0',
        source_values: productUrl,
        tracking_id: this.trackingId
      };

      // إضافة UTM parameters للتتبع
      const customParams = `utm_source=telegram&utm_medium=bot&utm_campaign=user_${userId}`;

      // توليد التوقيع
      params.sign = this.generateSignature(params);

      // إرسال الطلب لـ AliExpress API
      const response = await axios.get('https://api-sg.aliexpress.com/sync', {
        params,
        timeout: 10000
      });

      logger.info('Affiliate link generated', { productId, userId });

      if (response.data.aliexpress_affiliate_link_generate_response?.resp_result?.result) {
        const result = response.data.aliexpress_affiliate_link_generate_response.resp_result.result;
        const promotionUrl = result.promotion_links?.promotion_link?.[0]?.promotion_url || productUrl;
        
        // إضافة UTM parameters
        const separator = promotionUrl.includes('?') ? '&' : '?';
        const finalUrl = `${promotionUrl}${separator}${customParams}`;

        return {
          affiliateUrl: finalUrl,
          originalUrl: productUrl,
          commission: result.commission_rate || 0
        };
      }

      // في حالة الفشل، نعيد الرابط الأصلي مع UTM
      logger.warn('Failed to generate affiliate link, using original', { productUrl });
      return {
        affiliateUrl: `${productUrl}?${customParams}`,
        originalUrl: productUrl,
        commission: 0
      };

    } catch (error) {
      logger.error('Error generating affiliate link', { error, productUrl });
      throw error;
    }
  }

  // جلب تفاصيل المنتج
  async getProductDetails(productUrl: string): Promise<any> {
    try {
      const productId = extractProductId(productUrl);
      
      if (!productId) {
        throw new Error('Invalid product URL');
      }

      const params: Record<string, any> = {
        app_key: this.appKey,
        method: 'aliexpress.affiliate.productdetail.get',
        timestamp: Date.now(),
        format: 'json',
        v: '2.0',
        sign_method: 'md5',
        product_ids: productId,
        fields: 'product_title,product_main_image_url,target_sale_price,target_original_price,sale_price,original_price',
        target_currency: 'USD',
        target_language: 'AR'
      };

      params.sign = this.generateSignature(params);

      const response = await axios.get('https://api-sg.aliexpress.com/sync', {
        params,
        timeout: 10000
      });

      if (response.data.aliexpress_affiliate_productdetail_get_response?.resp_result?.result) {
        return response.data.aliexpress_affiliate_productdetail_get_response.resp_result.result.products.product[0];
      }

      return null;
    } catch (error) {
      logger.error('Error fetching product details', { error, productUrl });
      return null;
    }
  }
}

export const affiliateService = new AffiliateService();
