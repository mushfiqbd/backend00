/**
 * Configuration Validator Utility
 * Validates required environment variables and configuration settings
 */

export interface Config {
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  frontendUrl: string;
  nodeEnv: string;
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
  pendingEntryTimeoutSec: number;
}

export function validateConfig(): Config {
  const requiredEnvVars = [
    'DATABASE_URL',
    'JWT_SECRET',
    'FRONTEND_URL'
  ];

  const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);
  
  if (missingEnvVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
  }

  // Validate JWT secret length
  const jwtSecret = process.env.JWT_SECRET!;
  if (jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters long for security');
  }

  // Validate database URL
  const databaseUrl = process.env.DATABASE_URL!;
  if (!databaseUrl.startsWith('postgresql://') && !databaseUrl.startsWith('postgres://')) {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection string');
  }

  // Validate port
  const port = parseInt(process.env.PORT || '3000', 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be a valid port number between 1 and 65535');
  }

  // Validate rate limits
  const rateLimitWindowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10);
  const rateLimitMaxRequests = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10);

  if (isNaN(rateLimitWindowMs) || rateLimitWindowMs <= 0) {
    throw new Error('RATE_LIMIT_WINDOW_MS must be a positive number');
  }

  if (isNaN(rateLimitMaxRequests) || rateLimitMaxRequests <= 0) {
    throw new Error('RATE_LIMIT_MAX_REQUESTS must be a positive number');
  }

  // WEBHOOK_PASSPHRASE is optional in production; DB webhook_secret can be used.

  const pendingEntryTimeoutSec = parseInt(process.env.PENDING_ENTRY_TIMEOUT_SEC || '90', 10);
  if (isNaN(pendingEntryTimeoutSec) || pendingEntryTimeoutSec < 5) {
    throw new Error('PENDING_ENTRY_TIMEOUT_SEC must be a number >= 5');
  }

  return {
    port,
    databaseUrl,
    jwtSecret,
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || (process.env.NODE_ENV === 'production' ? '1h' : '24h'),
    frontendUrl: process.env.FRONTEND_URL!,
    nodeEnv: process.env.NODE_ENV || 'development',
    rateLimitWindowMs,
    rateLimitMaxRequests,
    pendingEntryTimeoutSec,
  };
}
