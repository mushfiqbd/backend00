import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

// Import routes
import authRoutes from './routes/auth';
import settingsRoutes from './routes/settings';
import apiKeysRoutes from './routes/apiKeys';
import riskSettingsRoutes from './routes/riskSettings';
import tradesRoutes from './routes/trades';
import positionsRoutes from './routes/positions';
import exchangeDataRoutes from './routes/exchangeData';
import webhookRoutes from './routes/webhook';
import executionHistoryRoutes from './routes/executionHistory';
import testApiKeysRoutes from './routes/testApiKeys';

// Import middleware
import { authMiddleware } from './middleware/auth';
import { validateConfig } from './utils/configValidator';
import logger from './utils/logger';

// Import environment-specific configurations
import { productionConfig } from './config/production';
import { developmentConfig } from './config/development';

// Load environment variables
dotenv.config();

// Validate configuration
const config = validateConfig();

// Select environment-specific configuration
const envConfig = process.env.NODE_ENV === 'production' ? productionConfig : developmentConfig;

const app = express();
const PORT = config.port;

// Respect reverse proxies (Koyeb/Render/etc.) for correct client IP handling.
app.set('trust proxy', envConfig.app.trustProxy ? 1 : false);

// Rate limiting
const limiter = rateLimit({
  windowMs: envConfig.security.rateLimit.windowMs,
  max: envConfig.security.rateLimit.max,
  message: envConfig.security.rateLimit.message,
  standardHeaders: envConfig.security.rateLimit.standardHeaders,
  legacyHeaders: envConfig.security.rateLimit.legacyHeaders,
});

// Enhanced security middleware
app.use(helmet({
  contentSecurityPolicy: envConfig.security.helmet.contentSecurityPolicy,
  hsts: envConfig.security.helmet.hsts,
  frameguard: {
    action: 'deny'
  }
}));

app.use(cors({
  origin: envConfig.cors.origin,
  credentials: envConfig.cors.credentials,
  methods: envConfig.cors.methods,
  allowedHeaders: envConfig.cors.allowedHeaders
}));

// Enhanced logging with security considerations
if (process.env.NODE_ENV === 'production') {
  app.use(morgan('combined'));
} else {
  app.use(morgan('dev')); // More readable format for development
}

app.use(limiter);
app.use(express.json({ 
  limit: '10mb'
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/settings', authMiddleware, settingsRoutes);
app.use('/api/api-keys', authMiddleware, apiKeysRoutes);
app.use('/api/risk-settings', authMiddleware, riskSettingsRoutes);
app.use('/api/trades', authMiddleware, tradesRoutes);
app.use('/api/positions', authMiddleware, positionsRoutes);
app.use('/api/exchange-data', authMiddleware, exchangeDataRoutes);
app.use('/api/execution-history', authMiddleware, executionHistoryRoutes);
app.use('/api/test-api-keys', authMiddleware, testApiKeysRoutes);
app.use('/api/webhook', express.text({ type: ['text/plain', 'text/*'], limit: '1mb' }), webhookRoutes); // Public webhook endpoint

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Route not found'
  });
});

// Global error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  // Log the full error for internal debugging (without exposing to client)
  logger.error('Unhandled application error', {
    url: req.url,
    method: req.method,
    ip: req.ip || req.connection.remoteAddress,
    userAgent: req.get('User-Agent'),
    error: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    timestamp: new Date().toISOString()
  });
  
  // Send generic error response to prevent information leakage
  res.status(500).json({
    error: 'An internal server error occurred',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
  });
});

// Start server
app.listen(PORT, () => {
  logger.info(`Server is running on port ${PORT}`, {
    port: PORT,
    environment: process.env.NODE_ENV,
    timestamp: new Date().toISOString()
  });
});

export default app;
