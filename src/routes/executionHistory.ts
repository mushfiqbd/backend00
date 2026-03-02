import { Router } from 'express';
import pool from '../config/database';
import logger from '../utils/logger';
import { clearExecutionHistoryForUser } from '../services/trading/historyService';

const router = Router();

// Get execution history/events for the user (backward-compatible response shape)
router.get('/', async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const { mode = 'all', limit = 100, offset = 0, startDate, endDate } = req.query;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    let query = `
      SELECT id, user_id, event_id, event_type, exchange, symbol, strategy_id, payload, processed_at, created_at
      FROM webhook_events
      WHERE user_id = $1
    `;
    const params: any[] = [userId];
    if (mode === 'demo' || mode === 'real') {
      query += ` AND COALESCE((payload->>'is_testnet')::boolean, true) = $${params.length + 1}`;
      params.push(mode === 'demo');
    }
    if (startDate) {
      query += ` AND created_at >= $${params.length + 1}`;
      params.push(String(startDate));
    }
    if (endDate) {
      query += ` AND created_at <= $${params.length + 1}`;
      params.push(String(endDate));
    }
    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(String(limit), 10), parseInt(String(offset), 10));
    const result = await pool.query(query, params);

    // Return wrapper for current frontend usage while keeping row compatibility.
    return res.status(200).json({
      data: result.rows,
      error: null,
    });
  } catch (error: any) {
    logger.error('Error fetching execution history:', {
      error: error.message,
      stack: error.stack,
      userId: (req as any).user?.userId,
      mode: req.query.mode,
      timestamp: new Date().toISOString()
    });
    
    return res.status(500).json({ 
      error: 'Failed to fetch execution history',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Clear execution history
router.delete('/', async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const rawMode = req.body?.mode;
    const mode = rawMode === 'demo' || rawMode === 'real' || rawMode === 'all' ? rawMode : 'all';

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const deleted = await clearExecutionHistoryForUser(userId, mode);

    return res.status(200).json({ 
      success: true,
      deleted: {
        trades: deleted.deletedTrades,
        events: deleted.deletedEvents,
      },
    });
  } catch (error: any) {
    logger.error('Error clearing execution history:', {
      error: error.message,
      stack: error.stack,
      userId: (req as any).user?.userId,
      mode: req.body.mode,
      timestamp: new Date().toISOString()
    });
    
    return res.status(500).json({ 
      error: 'Failed to clear execution history',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

export default router;