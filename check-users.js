require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: false
});

async function checkUsers() {
  try {
    await client.connect();
    
    const result = await client.query('SELECT id, email, created_at FROM users;');
    
    console.log('users:');
    result.rows.forEach(row => {
      console.log(`- ${row.id}: ${row.email} (${row.created_at})`);
    });
    
    await client.end();
  } catch (error) {
    console.error('Error:', error.message);
    await client.end();
  }
}

checkUsers();