import pool from '../config/database';

/**
 * Utility functions for API key operations
 */

export interface ApiKey {
  id: string;
  user_id: string;
  exchange: string;
  api_key: string;
  api_secret: string;
  is_testnet: boolean;
  created_at: Date;
  updated_at: Date;
}

/**
 * Get API key with secret for a specific user and exchange
 */
export async function getApiKeyForUser(userId: string, exchange: string): Promise<ApiKey | null> {
  try {
    const query = `
      SELECT id, user_id, exchange, api_key, api_secret, is_testnet, created_at, updated_at
      FROM api_keys 
      WHERE user_id = $1 AND exchange = $2
    `;
    
    const result = await pool.query(query, [userId, exchange]);
    
    if (result.rows.length === 0) {
      return null;
    }
    
    return result.rows[0] as ApiKey;
  } catch (error) {
    console.error('Error fetching API key:', error);
    return null;
  }
}

/**
 * Get all API keys with secrets for a user
 */
export async function getAllApiKeysForUser(userId: string): Promise<ApiKey[]> {
  try {
    const query = `
      SELECT id, user_id, exchange, api_key, api_secret, is_testnet, created_at, updated_at
      FROM api_keys 
      WHERE user_id = $1
      ORDER BY created_at DESC
    `;
    
    const result = await pool.query(query, [userId]);
    
    return result.rows as ApiKey[];
  } catch (error) {
    console.error('Error fetching API keys:', error);
    return [];
  }
}

/**
 * Check if user has valid API keys for an exchange
 */
export async function hasValidApiKey(userId: string, exchange: string): Promise<boolean> {
  try {
    const apiKey = await getApiKeyForUser(userId, exchange);
    return apiKey !== null && apiKey.api_key !== '' && apiKey.api_secret !== '';
  } catch (error) {
    console.error('Error checking API key validity:', error);
    return false;
  }
}