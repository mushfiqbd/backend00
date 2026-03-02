require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: false,
  connectionTimeoutMillis: 30000
});

async function testConnection() {
  try {
    console.log('Attempting to connect to:', process.env.DATABASE_URL);
    await client.connect();
    console.log('Connected successfully!');
    const result = await client.query('SELECT NOW() as time');
    console.log('Current time:', result.rows[0].time);
    await client.end();
  } catch (error) {
    console.error('Connection failed:', error.message);
    console.error('Error code:', error.code);
    console.error('Error details:', error);
  }
}

testConnection();