/**
 * Development Configuration
 * Contains configurations specific to development environment
 */

export const developmentConfig = {
  // Database
  database: {
    // Connection pooling optimized for development
    maxConnections: 10,
    minConnections: 2,
    connectionTimeout: 20000, // 20 seconds
    idleTimeout: 30000, // 30 seconds
    keepAlive: false,
  },

  // Security
  security: {
    // Less restrictive security for development
    helmet: {
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'fonts.googleapis.com'],
          fontSrc: ["'self'", 'fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:', 'https:'],
          scriptSrc: ["'self'"],
          connectSrc: ["'self'", "'unsafe-inline'"],
        },
      },
      hsts: {
        maxAge: 31536000, // 1 year
        includeSubDomains: true,
        preload: false, // Don't preload in development
      },
    },
    
    // Relaxed rate limiting for development
    rateLimit: {
      windowMs: 60 * 60 * 1000, // 1 hour for development
      max: 1000, // Higher limit for development
      message: {
        error: 'Too many requests from this IP, please try again later.',
      },
      standardHeaders: true,
      legacyHeaders: false,
    },
  },

  // Logging
  logging: {
    level: 'debug', // More verbose logging in development
    format: 'simple', // Human-readable format
    transports: {
      console: {
        enabled: true,
        format: 'colorized', // Colorized logs in console
      },
      file: {
        enabled: false, // No file logging in development by default
      },
    },
  },

  // CORS
  cors: {
    // Allow all origins in development
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization'],
  },

  // JWT
  jwt: {
    expiresIn: '24h', // Longer expiry for development convenience
    algorithm: 'HS256',
  },

  // Application
  app: {
    // Development-specific settings
    trustProxy: false,
    gracefulShutdown: {
      timeout: 10000, // 10 seconds in development
    },
  },
};