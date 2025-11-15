import { Pool } from 'pg';
import { config } from '../config/environment';
import { logger } from '../utils/logger';

class Database {
  private pool: Pool;

  constructor() {
    this.pool = new Pool({
      connectionString: config.database.url,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });

    this.pool.on('error', (err) => {
      logger.error('Unexpected database error', err);
    });
  }

  async query(text: string, params?: any[]) {
    const start = Date.now();
    try {
      const result = await this.pool.query(text, params);
      const duration = Date.now() - start;
      logger.debug('Executed query', { text, duration, rows: result.rowCount });
      return result;
    } catch (error) {
      logger.error('Database query error', { text, error });
      throw error;
    }
  }

  async getClient() {
    return this.pool.connect();
  }

  async close() {
    await this.pool.end();
  }
}

export const db = new Database();
