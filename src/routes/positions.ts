import { Router } from 'express';
import pool from '../config/database';
import logger from '../utils/logger';

const router = Router();

// Get positions
router.get('/', async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const { mode = 'demo' } = req.query;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const query = `
      SELECT id, exchange, symbol, side, entry_price, quantity, leverage, unrealized_pnl, opened_at, updated_at
      FROM positions 
      WHERE user_id = $1 AND mode = $2
      ORDER BY opened_at DESC
    `;
    
    const result = await pool.query(query, [userId, mode]);
    
    const positions = result.rows.map((row: any) => ({
      ...row,
      entry_price: parseFloat(row.entry_price),
      quantity: parseFloat(row.quantity),
      leverage: parseInt(row.leverage),
      unrealized_pnl: parseFloat(row.unrealized_pnl)
    }));

    return res.status(200).json(positions);
  } catch (error: any) {
    logger.error('Error fetching positions:', {
      error: error.message,
      stack: error.stack,
      userId: (req as any).user?.userId,
      mode: req.query.mode,
      timestamp: new Date().toISOString()
    });
    
    return res.status(500).json({ 
      error: 'Failed to fetch positions',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Close position
router.delete('/:id', async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const { id } = req.params;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const query = `
      DELETE FROM positions 
      WHERE id = $1 AND user_id = $2
      RETURNING *
    `;
    
    const result = await pool.query(query, [id, userId]);
    
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Position not found' });
    }

    return res.status(200).json({ 
      message: 'Position closed successfully',
      position: result.rows[0]
    });
  } catch (error: any) {
    logger.error('Error closing position:', {
      error: error.message,
      stack: error.stack,
      userId: (req as any).user?.userId,
      positionId: req.params.id,
      timestamp: new Date().toISOString()
    });
    
    return res.status(500).json({ 
      error: 'Failed to close position',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

export default router;