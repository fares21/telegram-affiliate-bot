import { delay } from '../utils/helpers';
import { config } from '../config/environment';
import { logger } from '../utils/logger';

export interface RateLimitConfig {
  maxPerSecond: number;
  retryAttempts: number;
  retryDelay: number;
}

export class RateLimiter {
  private config: RateLimitConfig;
  private queue: (() => Promise<void>)[] = [];
  private processing = false;
  private lastExecutionTime = 0;

  constructor(customConfig?: Partial<RateLimitConfig>) {
    this.config = {
      maxPerSecond: config.rateLimiting.maxPerSecond,
      retryAttempts: config.rateLimiting.retryAttempts,
      retryDelay: config.rateLimiting.retryDelay,
      ...customConfig
    };
  }

  // إضافة مهمة للطابور
  async addToQueue<T>(task: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await this.executeWithRetry(task);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });

      if (!this.processing) {
        this.processQueue();
      }
    });
  }

  // معالجة الطابور
  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;

    while (this.queue.length > 0) {
      const task = this.queue.shift();
      if (!task) continue;

      // حساب الوقت المنقضي منذ آخر تنفيذ
      const now = Date.now();
      const timeSinceLastExecution = now - this.lastExecutionTime;
      const minimumDelay = 1000 / this.config.maxPerSecond;

      // الانتظار إذا لزم الأمر
      if (timeSinceLastExecution < minimumDelay) {
        await delay(minimumDelay - timeSinceLastExecution);
      }

      try {
        await task();
        this.lastExecutionTime = Date.now();
      } catch (error) {
        logger.error('Task execution failed in rate limiter', { error });
      }
    }

    this.processing = false;
  }

  // تنفيذ مع إعادة المحاولة
  private async executeWithRetry<T>(
    task: () => Promise<T>,
    attempt: number = 1
  ): Promise<T> {
    try {
      return await task();
    } catch (error: any) {
      // التعامل مع Rate Limit (429)
      if (error.response?.status === 429 && attempt <= this.config.retryAttempts) {
        const retryAfter = error.response.headers['retry-after'];
        const delayTime = retryAfter 
          ? parseInt(retryAfter) * 1000 
          : this.config.retryDelay * attempt;

        logger.warn('Rate limit hit, retrying', { 
          attempt, 
          delayTime, 
          maxAttempts: this.config.retryAttempts 
        });

        await delay(delayTime);
        return this.executeWithRetry(task, attempt + 1);
      }

      // التعامل مع أخطاء الخادم (5xx)
      if (error.response?.status >= 500 && attempt <= this.config.retryAttempts) {
        logger.warn('Server error, retrying', { 
          attempt, 
          status: error.response.status 
        });

        await delay(this.config.retryDelay * attempt);
        return this.executeWithRetry(task, attempt + 1);
      }

      throw error;
    }
  }

  // الحصول على حجم الطابور
  getQueueSize(): number {
    return this.queue.length;
  }

  // مسح الطابور
  clearQueue(): void {
    this.queue = [];
    logger.info('Rate limiter queue cleared');
  }
}

export const defaultRateLimiter = new RateLimiter();
