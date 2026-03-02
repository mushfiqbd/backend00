import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../config/jwt';
import logger from '../utils/logger';

declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        email: string;
      };
    }
  }
}

export const authMiddleware = (req: Request, res: Response, next: NextFunction): Response | void => {
  try {
    // Log authentication attempts in development
    if (process.env.NODE_ENV !== 'production') {
      logger.debug('Auth middleware called', {
        path: req.path,
        method: req.method,
        timestamp: new Date().toISOString()
      });
    }
    
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      logger.warn('Authentication failed - no valid authorization header', {
        path: req.path,
        method: req.method,
        ip: req.ip || req.connection.remoteAddress,
        userAgent: req.get('User-Agent'),
        timestamp: new Date().toISOString()
      });
      
      return res.status(401).json({
        error: 'Authentication required',
        message: 'No valid authorization token provided'
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    
    // Additional security: check token length to prevent short token attacks
    if (token.length < 32) {
      logger.warn('Authentication failed - invalid token length', {
        path: req.path,
        method: req.method,
        ip: req.ip || req.connection.remoteAddress,
        timestamp: new Date().toISOString()
      });
      
      return res.status(401).json({
        error: 'Invalid token',
        message: 'Token is invalid or malformed'
      });
    }
    
    const decoded = verifyToken(token);
    
    if (!decoded) {
      logger.warn('Authentication failed - token verification failed', {
        path: req.path,
        method: req.method,
        ip: req.ip || req.connection.remoteAddress,
        timestamp: new Date().toISOString()
      });
      
      return res.status(401).json({
        error: 'Invalid token',
        message: 'Token is invalid or expired'
      });
    }

    req.user = decoded;
    logger.info('Authentication successful', {
      userId: decoded.userId,
      email: decoded.email,
      path: req.path,
      method: req.method,
      timestamp: new Date().toISOString()
    });
    
    next();
  } catch (error) {
    logger.error('Authentication error', {
      error: error instanceof Error ? error.message : 'Unknown error',
      path: req.path,
      method: req.method,
      ip: req.ip || req.connection.remoteAddress,
      timestamp: new Date().toISOString()
    });
    
    return res.status(500).json({
      error: 'Authentication error',
      message: 'Failed to authenticate request'
    });
  }
};