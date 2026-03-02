import { Router } from 'express';
import pool from '../config/database';
import logger from '../utils/logger';

const router = Router();

// Get trades for the user
router.get('/', async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const { mode = 'demo', limit = 50, offset = 0 } = req.query;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Build query with filters
    let query = `
      SELECT
        id, exchange, symbol, side, order_type, quantity, price, status, created_at,
        mode, order_id, strategy_id, webhook_payload, executed_at, error_message,
        exchange_order_id, client_order_id, fee, realized_pnl, close_reason
      FROM trades 
      WHERE user_id = $1 AND mode = $2
    `;
    const queryParams = [userId, mode];
    
    // Add ordering and pagination
    query += ` ORDER BY created_at DESC LIMIT $3 OFFSET $4`;
    queryParams.push(parseInt(limit as string), parseInt(offset as string));

    const result = await pool.query(query, queryParams);
    
    const trades = result.rows.map((row: any) => ({
      ...row,
      quantity: parseFloat(row.quantity),
      price: row.price ? parseFloat(row.price) : null,
      fee: row.fee != null ? parseFloat(row.fee) : null,
      realized_pnl: row.realized_pnl != null ? parseFloat(row.realized_pnl) : null,
    }));

    return res.status(200).json(trades);
  } catch (error: any) {
    logger.error('Error fetching trades:', {
      error: error.message,
      stack: error.stack,
      userId: (req as any).user?.userId,
      mode: req.query.mode,
      timestamp: new Date().toISOString()
    });
    
    return res.status(500).json({ 
      error: 'Failed to fetch trades',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Get a specific trade by ID
router.get('/:id', async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const { id } = req.params;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const query = `
      SELECT
        id, exchange, symbol, side, order_type, quantity, price, status, created_at,
        mode, order_id, strategy_id, webhook_payload, executed_at, error_message,
        exchange_order_id, client_order_id, fee, realized_pnl, close_reason
      FROM trades 
      WHERE id = $1 AND user_id = $2
    `;
    
    const result = await pool.query(query, [id, userId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Trade not found' });
    }

    const trade = result.rows[0];
    return res.status(200).json({
      ...trade,
      quantity: parseFloat(trade.quantity),
      price: trade.price ? parseFloat(trade.price) : null,
      fee: trade.fee != null ? parseFloat(trade.fee) : null,
      realized_pnl: trade.realized_pnl != null ? parseFloat(trade.realized_pnl) : null,
    });
  } catch (error: any) {
    logger.error('Error fetching trade:', {
      error: error.message,
      stack: error.stack,
      userId: (req as any).user?.userId,
      tradeId: req.params.id,
      timestamp: new Date().toISOString()
    });
    
    return res.status(500).json({ 
      error: 'Failed to fetch trade',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

export default router;