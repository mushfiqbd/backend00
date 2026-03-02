require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: false
});

async function checkTables() {
  try {
    await client.connect();
    console.log('Connected to database');
    
    // Get all tables
    const result = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `);
    
    console.log('Existing tables:');
    result.rows.forEach(row => {
      console.log(`- ${row.table_name}`);
    });
    
    await client.end();
  } catch (error) {
    console.error('Error:', error.message);
  }
}

checkTables();