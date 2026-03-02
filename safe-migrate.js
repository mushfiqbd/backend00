require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: false
});

async function runMigration() {
  try {
    await client.connect();
    console.log('Connected to database');
    
    // Read the schema file
    const schemaPath = path.join(__dirname, 'prisma/new-supabase-schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    
    // Split the schema into individual statements
    const statements = schema
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));
    
    console.log(`Executing ${statements.length} statements...`);
    
    let successCount = 0;
    let errorCount = 0;
    
    for (const statement of statements) {
      try {
        await client.query(statement);
        successCount++;
      } catch (error) {
        // If it's a "relation already exists" error, ignore it
        if (error.code === '42P07') {
          console.log('Skipping (already exists):', statement.substring(0, 50) + '...');
          successCount++;
        } else {
          console.error('Error executing statement:', error.message);
          console.error('Statement:', statement.substring(0, 100) + '...');
          errorCount++;
        }
      }
    }
    
    console.log(`\nMigration completed:`);
    console.log(`- Successful: ${successCount}`);
    console.log(`- Errors: ${errorCount}`);
    
    await client.end();
    
  } catch (error) {
    console.error('Migration failed:', error.message);
    await client.end();
  }
}

runMigration();