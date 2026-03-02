require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: false
});

async function checkForeignKeys() {
  try {
    await client.connect();
    
    // Check foreign key constraints that reference users table
    const result = await client.query(`
      SELECT 
        tc.table_name, 
        kcu.column_name, 
        ccu.table_name AS foreign_table_name, 
        ccu.column_name AS foreign_column_name 
      FROM information_schema.table_constraints AS tc 
      JOIN information_schema.key_column_usage AS kcu 
        ON tc.constraint_name = kcu.constraint_name 
      JOIN information_schema.constraint_column_usage AS ccu 
        ON ccu.constraint_name = tc.constraint_name 
      WHERE constraint_type = 'FOREIGN KEY' 
        AND ccu.table_name = 'users';
    `);
    
    console.log('Foreign key references to users table:');
    if (result.rows.length === 0) {
      console.log('No foreign key constraints found!');
    } else {
      result.rows.forEach(row => {
        console.log(`- ${row.table_name}.${row.column_name} -> users.${row.foreign_column_name}`);
      });
    }
    
    await client.end();
  } catch (error) {
    console.error('Error:', error.message);
    await client.end();
  }
}

checkForeignKeys();