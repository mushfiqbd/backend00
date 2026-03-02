import { Router } from 'express';
import pool from '../config/database';
import logger from '../utils/logger';

const router = Router();

// Test API key existence for a user
router.get('/exists', async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const { exchange, mode } = req.query;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Convert mode to is_testnet value
    let isTestnetFilter: boolean | null = null;
    if (mode === 'demo') {
      isTestnetFilter = true;
    } else if (mode === 'real') {
      isTestnetFilter = false;
    }

    let query = 'SELECT id, exchange, api_key, is_testnet FROM api_keys WHERE user_id = $1';
    const queryParams: any[] = [userId];

    if (exchange) {
      query += ' AND exchange = $2';
      queryParams.push(exchange);
    }

    if (isTestnetFilter !== null) {
      query += ' AND is_testnet = $3';
      queryParams.push(isTestnetFilter);
    }

    const result = await pool.query(query, queryParams);

    return res.status(200).json({
      exists: result.rows.length > 0,
      count: result.rows.length,
      keys: result.rows.map(row => ({
        id: row.id,
        exchange: row.exchange,
        hasKey: !!row.api_key,
        isTestnet: row.is_testnet
      }))
    });
  } catch (error: any) {
    logger.error('Error checking API key existence:', {
      error: error.message,
      stack: error.stack,
      userId: (req as any).user?.userId,
      timestamp: new Date().toISOString()
    });

    return res.status(500).json({
      error: 'Failed to check API key existence',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

export default router;