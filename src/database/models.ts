import { db } from './connection';
import { logger } from '../utils/logger';

export interface User {
  id: number;
  chat_id: number;
  username?: string;
  language: string;
  is_subscribed: boolean;
  created_at: Date;
}

export interface CartItem {
  id: number;
  user_id: number;
  product_url: string;
  product_title: string;
  current_price: number;
  original_price: number;
  last_checked: Date;
}

export interface Alert {
  id: number;
  user_id: number;
  keyword: string;
  is_active: boolean;
  created_at: Date;
}

export interface BroadcastLog {
  id: number;
  message: string;
  total_recipients: number;
  success_count: number;
  failure_count: number;
  errors: any;
  created_at: Date;
}

// إنشاء الجداول
export async function initializeDatabase() {
  try {
    // جدول المستخدمين
    await db.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        chat_id BIGINT UNIQUE NOT NULL,
        username VARCHAR(255),
        language VARCHAR(5) DEFAULT 'ar',
        is_subscribed BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // جدول السلة
    await db.query(`
      CREATE TABLE IF NOT EXISTS cart_items (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        product_url TEXT NOT NULL,
        product_title VARCHAR(500),
        current_price DECIMAL(10, 2),
        original_price DECIMAL(10, 2),
        last_checked TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // جدول التنبيهات
    await db.query(`
      CREATE TABLE IF NOT EXISTS alerts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        keyword VARCHAR(255) NOT NULL,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // جدول سجل البث
    await db.query(`
      CREATE TABLE IF NOT EXISTS broadcast_logs (
        id SERIAL PRIMARY KEY,
        message TEXT NOT NULL,
        total_recipients INTEGER,
        success_count INTEGER,
        failure_count INTEGER,
        errors JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // إنشاء الفهارس
    await db.query('CREATE INDEX IF NOT EXISTS idx_users_chat_id ON users(chat_id)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_cart_user_id ON cart_items(user_id)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_alerts_user_id ON alerts(user_id)');

    logger.info('Database initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize database', error);
    throw error;
  }
}

// دوال إدارة المستخدمين
export async function createOrUpdateUser(chatId: number, username?: string): Promise<User> {
  const result = await db.query(`
    INSERT INTO users (chat_id, username)
    VALUES ($1, $2)
    ON CONFLICT (chat_id) 
    DO UPDATE SET username = $2
    RETURNING *
  `, [chatId, username]);
  
  return result.rows[0];
}

export async function getAllSubscribedUsers(): Promise<User[]> {
  const result = await db.query(`
    SELECT * FROM users WHERE is_subscribed = true
  `);
  return result.rows;
}

export async function updateUserLanguage(chatId: number, language: string): Promise<void> {
  await db.query(`
    UPDATE users SET language = $1 WHERE chat_id = $2
  `, [language, chatId]);
}

// دوال إدارة السلة
export async function addToCart(userId: number, productUrl: string, title: string, price: number): Promise<CartItem> {
  const result = await db.query(`
    INSERT INTO cart_items (user_id, product_url, product_title, current_price, original_price)
    VALUES ($1, $2, $3, $4, $4)
    RETURNING *
  `, [userId, productUrl, title, price]);
  
  return result.rows[0];
}

export async function getCartItems(userId: number): Promise<CartItem[]> {
  const result = await db.query(`
    SELECT * FROM cart_items WHERE user_id = $1 ORDER BY created_at DESC
  `, [userId]);
  return result.rows;
}

export async function updateCartItemPrice(itemId: number, newPrice: number): Promise<void> {
  await db.query(`
    UPDATE cart_items 
    SET current_price = $1, last_checked = CURRENT_TIMESTAMP 
    WHERE id = $2
  `, [newPrice, itemId]);
}

// دوال إدارة التنبيهات
export async function createAlert(userId: number, keyword: string): Promise<Alert> {
  const result = await db.query(`
    INSERT INTO alerts (user_id, keyword)
    VALUES ($1, $2)
    RETURNING *
  `, [userId, keyword]);
  
  return result.rows[0];
}

export async function getActiveAlerts(): Promise<Alert[]> {
  const result = await db.query(`
    SELECT * FROM alerts WHERE is_active = true
  `);
  return result.rows;
}

// دوال سجل البث
export async function logBroadcast(
  message: string, 
  total: number, 
  success: number, 
  failure: number, 
  errors: any
): Promise<void> {
  await db.query(`
    INSERT INTO broadcast_logs (message, total_recipients, success_count, failure_count, errors)
    VALUES ($1, $2, $3, $4, $5)
  `, [message, total, success, failure, JSON.stringify(errors)]);
}
