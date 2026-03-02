import { Router } from 'express';
import pool from '../config/database';
import logger from '../utils/logger';

const router = Router();

// Get all API keys for the user
router.get('/', async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const mode = String(req.query.mode ?? 'all');

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const query = `
      SELECT id, exchange, api_key, is_testnet, created_at, updated_at
      FROM api_keys 
      WHERE user_id = $1
      ${mode === 'demo' ? 'AND is_testnet = true' : mode === 'real' ? 'AND is_testnet = false' : ''}
      ORDER BY created_at DESC
    `;
    
    const result = await pool.query(query, [userId]);
    
    // Return keys without exposing the actual API secret values, but include masked api_key
    const keysWithoutSecrets = result.rows.map(row => ({
      id: row.id,
      exchange: row.exchange,
      api_key: row.api_key ? `${row.api_key.substring(0, 4)}...${row.api_key.slice(-4)}` : '', // Mask the key
      is_testnet: row.is_testnet,
      created_at: row.created_at,
      updated_at: row.updated_at
    }));

    return res.status(200).json(keysWithoutSecrets);
  } catch (error: any) {
    logger.error('Error fetching API keys:', {
      error: error.message,
      stack: error.stack,
      userId: (req as any).user?.userId,
      timestamp: new Date().toISOString()
    });
    
    return res.status(500).json({ 
      error: 'Failed to fetch API keys',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Create a new API key (or update if already exists for same user and exchange)
router.post('/', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const userId = (req as any).user?.userId;
    const { exchange, api_key, api_secret, is_testnet = false } = req.body;

    if (!userId) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!exchange || !api_key || !api_secret) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(400).json({ 
        error: 'Missing required fields',
        message: 'exchange, api_key, and api_secret are required' 
      });
    }

    // Check if user exists using the same connection
    const userCheckQuery = 'SELECT id, email FROM users WHERE id = $1';
    const userCheckResult = await client.query(userCheckQuery, [userId]);
    
    if (userCheckResult.rows.length === 0) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(500).json({ 
        error: 'User not found',
        message: 'User account not found in database'
      });
    }

    // Check if an API key already exists for this user and exchange
    const existingKeyQuery = 'SELECT id FROM api_keys WHERE user_id = $1 AND exchange = $2 AND is_testnet = $3';
    const existingKeyResult = await client.query(existingKeyQuery, [userId, exchange, is_testnet]);
    
    let result;
    if (existingKeyResult.rows.length > 0) {
      // Update the existing API key
      const updateQuery = `
        UPDATE api_keys 
        SET api_key = $3, api_secret = $4, is_testnet = $5, updated_at = NOW()
        WHERE user_id = $1 AND exchange = $2 AND is_testnet = $5
        RETURNING id, exchange, api_key, is_testnet, created_at, updated_at
      `;
      result = await client.query(updateQuery, [userId, exchange, api_key, api_secret, is_testnet]);
    } else {
      // Insert a new API key
      const insertQuery = `
        INSERT INTO api_keys (user_id, exchange, api_key, api_secret, is_testnet)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, exchange, api_key, is_testnet, created_at, updated_at
      `;
      result = await client.query(insertQuery, [userId, exchange, api_key, api_secret, is_testnet]);
    }
    
    await client.query('COMMIT');
    client.release();
    
    return res.status(200).json({
      id: result.rows[0].id,
      exchange: result.rows[0].exchange,
      api_key: result.rows[0].api_key,
      is_testnet: result.rows[0].is_testnet,
      created_at: result.rows[0].created_at,
      updated_at: result.rows[0].updated_at
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    client.release();
    
    logger.error('Error creating/updating API key:', {
      error: error.message,
      code: error.code,
      stack: error.stack,
      userId: (req as any).user?.userId,
      exchange: req.body.exchange,
      timestamp: new Date().toISOString()
    });
    
    // Check if it's a constraint violation error
    if (error.code === '23505') { // Unique violation
      return res.status(409).json({ 
        error: 'API key conflict',
        message: 'A key already exists for this exchange/mode. If your DB still uses unique(user_id,exchange), run schema migration for dual-mode keys.' 
      });
    }
    
    return res.status(500).json({ 
      error: 'Failed to create or update API key',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Update an existing API key
router.put('/:id', async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const { id } = req.params;
    const { api_key, api_secret, is_testnet } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!api_key || !api_secret) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        message: 'api_key and api_secret are required' 
      });
    }

    const query = `
      UPDATE api_keys 
      SET api_key = $3, api_secret = $4, is_testnet = $5, updated_at = NOW()
      WHERE id = $1 AND user_id = $2
      RETURNING id, exchange, api_key, is_testnet, created_at, updated_at
    `;
    
    const result = await pool.query(query, [id, userId, api_key, api_secret, is_testnet]);
    
    if (result.rowCount === 0) {
      return res.status(404).json({ 
        error: 'API key not found or unauthorized' 
      });
    }

    return res.status(200).json({
      id: result.rows[0].id,
      exchange: result.rows[0].exchange,
      api_key: result.rows[0].api_key,
      is_testnet: result.rows[0].is_testnet,
      created_at: result.rows[0].created_at,
      updated_at: result.rows[0].updated_at
    });
  } catch (error: any) {
    logger.error('Error updating API key:', {
      error: error.message,
      stack: error.stack,
      userId: (req as any).user?.userId,
      apiKeyId: req.params.id,
      timestamp: new Date().toISOString()
    });
    
    return res.status(500).json({ 
      error: 'Failed to update API key',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Delete an API key
router.delete('/:id', async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const { id } = req.params;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const query = `
      DELETE FROM api_keys 
      WHERE id = $1 AND user_id = $2
      RETURNING *
    `;
    
    const result = await pool.query(query, [id, userId]);
    
    if (result.rowCount === 0) {
      return res.status(404).json({ 
        error: 'API key not found or unauthorized' 
      });
    }

    return res.status(200).json({ 
      message: 'API key deleted successfully' 
    });
  } catch (error: any) {
    logger.error('Error deleting API key:', {
      error: error.message,
      stack: error.stack,
      userId: (req as any).user?.userId,
      apiKeyId: req.params.id,
      timestamp: new Date().toISOString()
    });
    
    return res.status(500).json({ 
      error: 'Failed to delete API key',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

export default router;