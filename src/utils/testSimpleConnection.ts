import { Client } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

async function testSimpleConnection() {
  console.log('🔍 Testing simple database connection...');
  console.log('DATABASE_URL:', process.env.DATABASE_URL);
  
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('Connecting to database...');
    await client.connect();
    console.log('✅ Connected successfully!');
    
    const result = await client.query('SELECT NOW() as current_time, version()');
    console.log('Current time:', result.rows[0].current_time);
    console.log('PostgreSQL version:', result.rows[0].version);
    
    await client.end();
    console.log('🎉 Simple connection test completed!');
    
  } catch (error) {
    console.error('❌ Connection failed:', error);
    await client.end();
  }
}

testSimpleConnection();