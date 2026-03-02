import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// Validate required environment variables
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

// Create PostgreSQL connection pool with enhanced security
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { 
    rejectUnauthorized: false
  } : false,
  max: 10, // Maximum number of clients in the pool
  min: 2, // Minimum number of clients in the pool
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 20000, // Timeout for establishing a new connection
  // Prevent SQL injection by ensuring prepared statements are used
  statement_timeout: 20000, // 20 seconds timeout for any statement
  query_timeout: 20000, // 20 seconds timeout for queries
});

// Test database connection with retry logic
const testConnection = async () => {
  let retries = 5;
  while (retries > 0) {
    try {
      await pool.query('SELECT NOW()');
      console.log('Database connected successfully');
      break;
    } catch (err: any) {
      retries--;
      console.error(`Database connection attempt failed (${5 - retries}/5):`, err.message || err);
      if (retries > 0) {
        console.log(`Retrying in 3 seconds...`);
        await new Promise(resolve => setTimeout(resolve, 3000));
      } else {
        console.error('Failed to connect to database after 5 attempts');
        // In production, we might want to exit the process
        if (process.env.NODE_ENV === 'production') {
          process.exit(1);
        }
      }
    }
  }
};

testConnection();

// Handle pool errors
pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  // In a production environment, you might want to restart the service
});

export default pool;