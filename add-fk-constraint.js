require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: false
});

async function addForeignKeyConstraint() {
  try {
    await client.connect();
    console.log('Connected to database');
    
    // Check if the foreign key constraint already exists
    const checkResult = await client.query(`
      SELECT constraint_name 
      FROM information_schema.table_constraints 
      WHERE table_name = 'app_settings' 
        AND constraint_type = 'FOREIGN KEY';
    `);
    
    if (checkResult.rows.length > 0) {
      console.log('Foreign key constraint already exists');
      await client.end();
      return;
    }
    
    // Add foreign key constraint to app_settings table
    console.log('Adding foreign key constraint to app_settings table...');
    await client.query(`
      ALTER TABLE app_settings 
      ADD CONSTRAINT app_settings_user_id_fkey 
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
    `);
    
    console.log('Foreign key constraint added successfully');
    
    await client.end();
  } catch (error) {
    console.error('Error:', error.message);
    await client.end();
  }
}

addForeignKeyConstraint();