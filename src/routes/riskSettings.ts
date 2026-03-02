import { Router } from 'express';
import pool from '../config/database';
import logger from '../utils/logger';

const router = Router();

// Get risk settings for the user
router.get('/', async (req, res) => {
  try {
    const userId = (req as any).user?.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const query = `
      SELECT id, user_id, exchange, symbol, size_type, size_value, leverage, margin_mode, 
             max_position_usdt, max_daily_trades, created_at, updated_at
      FROM risk_settings 
      WHERE user_id = $1
      ORDER BY exchange, symbol, created_at DESC
    `;
    
    const result = await pool.query(query, [userId]);
    
    const settings = result.rows.map((row: any) => ({
      ...row,
      size_value: Number(row.size_value),
      leverage: Number(row.leverage),
      max_position_usdt: row.max_position_usdt ? Number(row.max_position_usdt) : null,
      max_daily_trades: row.max_daily_trades ? Number(row.max_daily_trades) : null
    }));

    return res.status(200).json(settings);
  } catch (error: any) {
    logger.error('Error fetching risk settings:', {
      error: error.message,
      stack: error.stack,
      userId: (req as any).user?.userId,
      timestamp: new Date().toISOString()
    });
    
    return res.status(500).json({ 
      error: 'Failed to fetch risk settings',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Create/update risk settings
router.post('/', async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const { 
      exchange = 'default', 
      symbol = '__DEFAULT__', 
      size_type = 'fixed_usdt', 
      size_value = 150,
      leverage = 1,
      margin_mode = 'cross',
      max_position_usdt = null,
      max_daily_trades = null
    } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Validate required fields
    if (!exchange || size_value === undefined || leverage === undefined) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        message: 'exchange, size_type, size_value, and leverage are required' 
      });
    }

    // Check if setting already exists for this user/exchange/symbol combination
    const checkQuery = `
      SELECT id FROM risk_settings 
      WHERE user_id = $1 AND exchange = $2 AND symbol = $3
    `;
    const checkResult = await pool.query(checkQuery, [userId, exchange, symbol]);

    let result;
    if (checkResult.rows.length > 0) {
      // Update existing setting
      const updateQuery = `
        UPDATE risk_settings 
        SET size_type = $4, size_value = $5, leverage = $6, margin_mode = $7, 
            max_position_usdt = $8, max_daily_trades = $9, updated_at = NOW()
        WHERE user_id = $1 AND exchange = $2 AND symbol = $3
        RETURNING id, user_id, exchange, symbol, size_type, size_value, leverage, margin_mode, 
                  max_position_usdt, max_daily_trades, created_at, updated_at
      `;
      result = await pool.query(updateQuery, [
        userId, exchange, symbol, size_type, size_value, leverage, margin_mode, 
        max_position_usdt, max_daily_trades
      ]);
    } else {
      // Insert new setting
      const insertQuery = `
        INSERT INTO risk_settings (user_id, exchange, symbol, size_type, size_value, leverage, margin_mode, 
                                  max_position_usdt, max_daily_trades)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id, user_id, exchange, symbol, size_type, size_value, leverage, margin_mode, 
                  max_position_usdt, max_daily_trades, created_at, updated_at
      `;
      result = await pool.query(insertQuery, [
        userId, exchange, symbol, size_type, size_value, leverage, margin_mode, 
        max_position_usdt, max_daily_trades
      ]);
    }

    return res.status(200).json({
      ...result.rows[0],
      size_value: Number(result.rows[0].size_value),
      leverage: Number(result.rows[0].leverage),
      max_position_usdt: result.rows[0].max_position_usdt ? Number(result.rows[0].max_position_usdt) : null,
      max_daily_trades: result.rows[0].max_daily_trades ? Number(result.rows[0].max_daily_trades) : null
    });
  } catch (error: any) {
    logger.error('Error saving risk setting:', {
      error: error.message,
      stack: error.stack,
      userId: (req as any).user?.userId,
      exchange: req.body.exchange,
      symbol: req.body.symbol,
      timestamp: new Date().toISOString()
    });
    
    return res.status(500).json({ 
      error: 'Failed to save risk setting',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Update a specific risk setting
router.put('/:id', async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const { id } = req.params;
    const { 
      exchange, 
      symbol, 
      size_type, 
      size_value, 
      leverage, 
      margin_mode, 
      max_position_usdt, 
      max_daily_trades 
    } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Check if the risk setting exists and belongs to the user
    const checkQuery = `
      SELECT id FROM risk_settings 
      WHERE id = $1 AND user_id = $2
    `;
    const checkResult = await pool.query(checkQuery, [id, userId]);
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Risk setting not found' });
    }

    const query = `
      UPDATE risk_settings 
      SET exchange = $2, symbol = $3, size_type = $4, size_value = $5, leverage = $6, 
          margin_mode = $7, max_position_usdt = $8, max_daily_trades = $9, updated_at = NOW()
      WHERE id = $1 AND user_id = $10
      RETURNING id, user_id, exchange, symbol, size_type, size_value, leverage, margin_mode, 
                max_position_usdt, max_daily_trades, created_at, updated_at
    `;
    
    const result = await pool.query(query, [
      id, exchange, symbol, size_type, size_value, leverage, 
      margin_mode, max_position_usdt, max_daily_trades, userId
    ]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Risk setting not found' });
    }

    return res.status(200).json({
      ...result.rows[0],
      size_value: Number(result.rows[0].size_value),
      leverage: Number(result.rows[0].leverage),
      max_position_usdt: result.rows[0].max_position_usdt ? Number(result.rows[0].max_position_usdt) : null,
      max_daily_trades: result.rows[0].max_daily_trades ? Number(result.rows[0].max_daily_trades) : null
    });
  } catch (error: any) {
    logger.error('Error updating risk setting:', {
      error: error.message,
      stack: error.stack,
      userId: (req as any).user?.userId,
      settingId: req.params.id,
      timestamp: new Date().toISOString()
    });
    
    return res.status(500).json({ 
      error: 'Failed to update risk setting',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Delete a risk setting
router.delete('/:id', async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const { id } = req.params;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Check if the risk setting exists and belongs to the user
    const checkQuery = `
      SELECT id, exchange, symbol FROM risk_settings 
      WHERE id = $1 AND user_id = $2
    `;
    const checkResult = await pool.query(checkQuery, [id, userId]);
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Risk setting not found' });
    }

    const query = `
      DELETE FROM risk_settings 
      WHERE id = $1 AND user_id = $2
      RETURNING id, exchange, symbol
    `;
    
    const result = await pool.query(query, [id, userId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Risk setting not found' });
    }

    return res.status(200).json({ 
      message: 'Risk setting deleted successfully',
      deleted: {
        id: result.rows[0].id,
        exchange: result.rows[0].exchange,
        symbol: result.rows[0].symbol
      }
    });
  } catch (error: any) {
    logger.error('Error deleting risk setting:', {
      error: error.message,
      stack: error.stack,
      userId: (req as any).user?.userId,
      settingId: req.params.id,
      timestamp: new Date().toISOString()
    });
    
    return res.status(500).json({ 
      error: 'Failed to delete risk setting',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

export default router;