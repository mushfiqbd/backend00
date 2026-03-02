import pool from '../config/database';

export interface AppSettings {
  id: string;
  user_id: string;
  trading_mode: 'demo' | 'real';
  webhook_secret: string;
  created_at: Date;
  updated_at: Date;
}

export interface CreateAppSettingsInput {
  user_id: string;
  trading_mode?: 'demo' | 'real';
}

export class AppSettingsModel {
  static async create(settingsData: CreateAppSettingsInput): Promise<AppSettings> {
    // Validate input
    if (!settingsData.user_id) {
      throw new Error('User ID is required');
    }
    
    if (settingsData.trading_mode && !['demo', 'real'].includes(settingsData.trading_mode)) {
      throw new Error('Invalid trading mode. Must be "demo" or "real"');
    }
    
    // Generate a random webhook secret
    const crypto = await import('crypto');
    const webhookSecret = crypto.randomBytes(32).toString('hex');
    
    const query = `
      INSERT INTO app_settings (user_id, trading_mode, webhook_secret)
      VALUES ($1, $2, $3)
      RETURNING id, user_id, trading_mode, webhook_secret, created_at, updated_at
    `;
    
    const values = [settingsData.user_id, settingsData.trading_mode || 'demo', webhookSecret];
    const result = await pool.query(query, values);
    
    return result.rows[0];
  }

  static async findByUserId(userId: string): Promise<AppSettings | null> {
    // Validate input
    if (!userId || typeof userId !== 'string' || userId.length === 0) {
      return null;
    }
    
    const query = `
      SELECT id, user_id, trading_mode, webhook_secret, created_at, updated_at
      FROM app_settings
      WHERE user_id = $1
    `;
    
    const result = await pool.query(query, [userId]);
    return result.rows[0] || null;
  }

  static async updateTradingMode(
    userId: string,
    tradingMode: 'demo' | 'real'
  ): Promise<AppSettings | null> {
    // Validate input
    if (!userId || typeof userId !== 'string' || userId.length === 0) {
      throw new Error('User ID is required');
    }
    
    if (!tradingMode || !['demo', 'real'].includes(tradingMode)) {
      throw new Error('Invalid trading mode. Must be "demo" or "real"');
    }
    
    const query = `
      UPDATE app_settings
      SET trading_mode = $1, updated_at = NOW()
      WHERE user_id = $2
      RETURNING id, user_id, trading_mode, webhook_secret, created_at, updated_at
    `;
    
    const values = [tradingMode, userId];
    const result = await pool.query(query, values);
    return result.rows[0] || null;
  }
}