require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: false
});

async function createUsersTable() {
  try {
    await client.connect();
    console.log('Connected to database');
    
    // Check if users table exists
    const checkResult = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'users'
      );
    `);
    
    if (checkResult.rows[0].exists) {
      console.log('Users table already exists');
      await client.end();
      return;
    }
    
    // Create users table
    console.log('Creating users table...');
    await client.query(`
      -- Create users table (for custom authentication)
      CREATE TABLE users (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          email VARCHAR(255) UNIQUE NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);
    
    console.log('Users table created successfully');
    
    // Create indexes
    await client.query(`
      CREATE INDEX idx_users_email ON users(email);
    `);
    
    console.log('Users table indexes created');
    
    // Create function to update updated_at columns
    await client.query(`
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
          NEW.updated_at = NOW();
          RETURN NEW;
      END;
      $$ language 'plpgsql';
    `);
    
    // Create triggers for automatic timestamp updates
    await client.query(`
      CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
          FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `);
    
    console.log('Users table triggers created');
    
    // Enable RLS (Row Level Security)
    await client.query(`
      ALTER TABLE users ENABLE ROW LEVEL SECURITY;
    `);
    
    // RLS Policies for users table
    await client.query(`
      CREATE POLICY "Users can view their own record" ON users
          FOR SELECT USING (id = auth.uid());
    `);
    
    await client.query(`
      CREATE POLICY "Users can update their own record" ON users
          FOR UPDATE USING (id = auth.uid());
    `);
    
    console.log('Users table RLS policies created');
    
    await client.end();
    console.log('All done!');
    
  } catch (error) {
    console.error('Error:', error.message);
    await client.end();
  }
}

createUsersTable();