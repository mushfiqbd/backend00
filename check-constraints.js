require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: false
});

async function checkConstraints() {
  try {
    await client.connect();
    
    const result = await client.query(`
      SELECT constraint_name, constraint_type 
      FROM information_schema.table_constraints 
      WHERE table_name = 'app_settings' 
        AND constraint_type = 'FOREIGN KEY';
    `);
    
    console.log('Foreign key constraints on app_settings:');
    result.rows.forEach(row => {
      console.log(`- ${row.constraint_name}: ${row.constraint_type}`);
    });
    
    await client.end();
  } catch (error) {
    console.error('Error:', error.message);
    await client.end();
  }
}

checkConstraints();