/**
 * Production Configuration
 * Contains configurations specific to production environment
 */

export const productionConfig = {
  // Database
  database: {
    // Connection pooling optimized for production
    maxConnections: 20,
    minConnections: 5,
    connectionTimeout: 30000, // 30 seconds
    idleTimeout: 60000, // 60 seconds
    keepAlive: true,
  },

  // Security
  security: {
    // Enable all security headers
    helmet: {
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
          fontSrc: ["'self'", "https:", "data:"],
          connectSrc: ["'self'", "*.supabase.co"],
        },
      },
      hsts: {
        maxAge: 31536000, // 1 year
        includeSubDomains: true,
        preload: true,
      },
    },
    
    // Rate limiting for production
    rateLimit: {
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // Limit each IP to 100 requests per windowMs
      message: {
        error: 'Too many requests from this IP, please try again later.',
      },
      standardHeaders: true,
      legacyHeaders: false,
    },
  },

  // Logging
  logging: {
    level: 'info',
    format: 'json', // Structured logging for production
    transports: {
      console: {
        enabled: true,
        format: 'colorized', // Colorized logs in console
      },
      file: {
        enabled: true,
        errorLogFile: 'logs/error.log',
        combinedLogFile: 'logs/combined.log',
        maxFileSize: '20m', // Max size of each log file
        maxFiles: '14d', // Keep logs for 14 days
      },
    },
  },

  // CORS
  cors: {
    // Restrict origins in production
    origin: process.env.ALLOWED_ORIGINS?.split(',') || [process.env.FRONTEND_URL || ''],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization'],
  },

  // JWT
  jwt: {
    expiresIn: '1h', // Shorter expiry in production
    algorithm: 'HS256',
  },

  // Application
  app: {
    // Additional production-specific settings
    trustProxy: true, // Trust first proxy (important for deployment behind load balancers)
    gracefulShutdown: {
      timeout: 30000, // 30 seconds to complete ongoing requests
    },
  },
};