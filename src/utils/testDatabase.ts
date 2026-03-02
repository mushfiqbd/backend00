import pool from '../config/database';

async function testDatabaseConnection() {
  try {
    console.log('🔍 Testing database connection...');
    
    // Test basic connection
    const result = await pool.query('SELECT NOW() as current_time, version()');
    console.log('✅ Database connected successfully!');
    console.log('   Current time:', result.rows[0].current_time);
    
    // Test if users table exists
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'users'
      ) as users_table_exists
    `);
    
    if (tableCheck.rows[0].users_table_exists) {
      console.log('✅ Users table exists');
    } else {
      console.log('⚠️  Users table does not exist - will be created during migration');
    }
    
    // Test existing tables (from your Supabase setup)
    const existingTables = ['app_settings', 'api_keys', 'trades', 'positions', 'risk_settings'];
    for (const table of existingTables) {
      try {
        const exists = await pool.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_name = $1
          ) as table_exists
        `, [table]);
        
        if (exists.rows[0].table_exists) {
          console.log(`✅ ${table} table exists`);
        } else {
          console.log(`⚠️  ${table} table does not exist`);
        }
      } catch (error) {
        console.log(`⚠️  Could not check ${table} table:`, (error as Error).message);
      }
    }
    
    console.log('\n🎉 Database connection test completed!');
    
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    console.error('Please check your DATABASE_URL in .env file');
  } finally {
    await pool.end();
  }
}

// Run test if this file is executed directly
if (require.main === module) {
  testDatabaseConnection();
}

export default testDatabaseConnection;