require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: false
});

async function createAppSettings() {
  try {
    await client.connect();
    
    // Get the user ID
    const userResult = await client.query('SELECT id FROM users WHERE email = $1', ['test@example.com']);
    if (userResult.rows.length === 0) {
      console.log('User not found');
      await client.end();
      return;
    }
    
    const userId = userResult.rows[0].id;
    console.log('User ID:', userId);
    
    // Create app_settings record
    const result = await client.query(
      'INSERT INTO app_settings (user_id, trading_mode) VALUES ($1, $2) RETURNING id', 
      [userId, 'demo']
    );
    
    console.log('app_settings created with ID:', result.rows[0].id);
    
    await client.end();
  } catch (error) {
    console.error('Error:', error.message);
    await client.end();
  }
}

createAppSettings();