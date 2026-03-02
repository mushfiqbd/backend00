import { Request, Response } from 'express';
import { UserModel, CreateUserInput, LoginUserInput } from '../models/User';
import { AppSettingsModel } from '../models/AppSettings';
import { generateToken } from '../config/jwt';
import logger from '../utils/logger';

interface AuthResponse {
  token: string;
  user: {
    id: string;
    email: string;
  };
  settings: {
    id: string;
    trading_mode: string;
    webhook_secret: string;
  };
}

export class AuthController {
  static async register(req: Request, res: Response): Promise<Response | void> {
    try {
      const { email, password } = req.body as CreateUserInput;

      // Validation - this is now handled in the model, but we keep basic checks here
      if (!email || !password) {
        logger.warn('Registration failed - missing email or password', {
          ip: req.ip || req.connection.remoteAddress,
          timestamp: new Date().toISOString()
        });
        
        return res.status(400).json({
          error: 'Email and password are required'
        });
      }

      // Check if user already exists
      const existingUser = await UserModel.findByEmail(email);
      if (existingUser) {
        logger.warn('Registration failed - user already exists', {
          email,
          ip: req.ip || req.connection.remoteAddress,
          timestamp: new Date().toISOString()
        });
        
        return res.status(409).json({
          error: 'User already exists with this email'
        });
      }

      // Create user - validation happens inside the model
      const user = await UserModel.create({ email, password });
      
      // Create default app settings
      const settings = await AppSettingsModel.create({ user_id: user.id });

      // Generate JWT token
      const token = generateToken({
        userId: user.id,
        email: user.email
      });

      logger.info('User registered successfully', {
        userId: user.id,
        email: user.email,
        timestamp: new Date().toISOString()
      });

      const response: AuthResponse = {
        token,
        user: {
          id: user.id,
          email: user.email
        },
        settings: {
          id: settings.id,
          trading_mode: settings.trading_mode,
          webhook_secret: settings.webhook_secret
        }
      };

      res.status(201).json({
        message: 'User created successfully',
        data: response
      });

    } catch (error) {
      logger.error('Registration error', {
        error: error instanceof Error ? error.message : 'Unknown error',
        ip: req.ip || req.connection.remoteAddress,
        timestamp: new Date().toISOString()
      });
      
      // Check if it's a validation error from the model
      if (error instanceof Error && error.message.includes('Invalid')) {
        return res.status(400).json({
          error: 'Validation error',
          message: error.message
        });
      }
      res.status(500).json({
        error: 'Failed to create user',
        message: process.env.NODE_ENV === 'development' ? (error as Error).message : 'Internal server error'
      });
    }
  }

  static async login(req: Request, res: Response): Promise<Response | void> {
    try {
      const { email, password } = req.body as LoginUserInput;

      // Validation
      if (!email || !password) {
        logger.warn('Login failed - missing email or password', {
          ip: req.ip || req.connection.remoteAddress,
          timestamp: new Date().toISOString()
        });
        
        return res.status(400).json({
          error: 'Email and password are required'
        });
      }

      // Find user
      const user = await UserModel.findByEmail(email);
      if (!user) {
        logger.warn('Login failed - invalid credentials', {
          email,
          ip: req.ip || req.connection.remoteAddress,
          timestamp: new Date().toISOString()
        });
        
        return res.status(401).json({
          error: 'Invalid credentials',
          message: 'Invalid email or password'
        });
      }

      // Validate password
      const isValidPassword = await UserModel.validatePassword(password, user.password_hash);
      if (!isValidPassword) {
        logger.warn('Login failed - invalid password', {
          email,
          ip: req.ip || req.connection.remoteAddress,
          timestamp: new Date().toISOString()
        });
        
        return res.status(401).json({
          error: 'Invalid credentials',
          message: 'Invalid email or password'
        });
      }

      // Get user settings
      let settings = await AppSettingsModel.findByUserId(user.id);
      if (!settings) {
        // Create default settings if they don't exist
        settings = await AppSettingsModel.create({ user_id: user.id });
      }

      // Generate JWT token
      const token = generateToken({
        userId: user.id,
        email: user.email
      });

      logger.info('Login successful', {
        userId: user.id,
        email: user.email,
        timestamp: new Date().toISOString()
      });

      const response: AuthResponse = {
        token,
        user: {
          id: user.id,
          email: user.email
        },
        settings: {
          id: settings.id,
          trading_mode: settings.trading_mode,
          webhook_secret: settings.webhook_secret
        }
      };

      res.status(200).json({
        message: 'Login successful',
        data: response
      });

    } catch (error) {
      logger.error('Login error', {
        error: error instanceof Error ? error.message : 'Unknown error',
        ip: req.ip || req.connection.remoteAddress,
        timestamp: new Date().toISOString()
      });
      
      res.status(500).json({
        error: 'Login failed',
        message: process.env.NODE_ENV === 'development' ? (error as Error).message : 'Internal server error'
      });
    }
  }

  static async refreshToken(req: Request, res: Response): Promise<Response | void> {
    try {
      const user = req.user;
      if (!user) {
        logger.warn('Token refresh failed - authentication required', {
          ip: req.ip || req.connection.remoteAddress,
          timestamp: new Date().toISOString()
        });
        
        return res.status(401).json({
          error: 'Authentication required'
        });
      }

      // Get fresh user data
      const userData = await UserModel.findById(user.userId);
      if (!userData) {
        logger.warn('Token refresh failed - user not found', {
          userId: user.userId,
          ip: req.ip || req.connection.remoteAddress,
          timestamp: new Date().toISOString()
        });
        
        return res.status(401).json({
          error: 'User not found'
        });
      }

      // Get user settings
      const settings = await AppSettingsModel.findByUserId(user.userId);
      if (!settings) {
        logger.warn('Token refresh failed - user settings not found', {
          userId: user.userId,
          ip: req.ip || req.connection.remoteAddress,
          timestamp: new Date().toISOString()
        });
        
        return res.status(404).json({
          error: 'User settings not found'
        });
      }

      // Generate new JWT token
      const token = generateToken({
        userId: userData.id,
        email: userData.email
      });

      logger.info('Token refreshed successfully', {
        userId: userData.id,
        email: userData.email,
        timestamp: new Date().toISOString()
      });

      const response: AuthResponse = {
        token,
        user: {
          id: userData.id,
          email: userData.email
        },
        settings: {
          id: settings.id,
          trading_mode: settings.trading_mode,
          webhook_secret: settings.webhook_secret
        }
      };

      res.status(200).json({
        message: 'Token refreshed successfully',
        data: response
      });

    } catch (error) {
      logger.error('Token refresh error', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: req.user?.userId,
        ip: req.ip || req.connection.remoteAddress,
        timestamp: new Date().toISOString()
      });
      
      res.status(500).json({
        error: 'Failed to refresh token',
        message: process.env.NODE_ENV === 'development' ? (error as Error).message : 'Internal server error'
      });
    }
  }

  static async getProfile(req: Request, res: Response): Promise<Response | void> {
    try {
      const user = req.user;
      if (!user) {
        logger.warn('Get profile failed - authentication required', {
          ip: req.ip || req.connection.remoteAddress,
          timestamp: new Date().toISOString()
        });
        
        return res.status(401).json({
          error: 'Authentication required'
        });
      }

      // Get user data
      const userData = await UserModel.findById(user.userId);
      if (!userData) {
        logger.warn('Get profile failed - user not found', {
          userId: user.userId,
          ip: req.ip || req.connection.remoteAddress,
          timestamp: new Date().toISOString()
        });
        
        return res.status(404).json({
          error: 'User not found'
        });
      }

      // Get user settings
      const settings = await AppSettingsModel.findByUserId(user.userId);
      if (!settings) {
        logger.warn('Get profile failed - user settings not found', {
          userId: user.userId,
          ip: req.ip || req.connection.remoteAddress,
          timestamp: new Date().toISOString()
        });
        
        return res.status(404).json({
          error: 'User settings not found'
        });
      }

      logger.info('Get profile successful', {
        userId: user.userId,
        email: userData.email,
        timestamp: new Date().toISOString()
      });

      const response = {
        user: {
          id: userData.id,
          email: userData.email,
          created_at: userData.created_at
        },
        settings: {
          id: settings.id,
          trading_mode: settings.trading_mode,
          webhook_secret: settings.webhook_secret,
          updated_at: settings.updated_at
        }
      };

      res.status(200).json({
        data: response
      });

    } catch (error) {
      logger.error('Profile fetch error', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: req.user?.userId,
        ip: req.ip || req.connection.remoteAddress,
        timestamp: new Date().toISOString()
      });
      
      res.status(500).json({
        error: 'Failed to fetch profile',
        message: process.env.NODE_ENV === 'development' ? (error as Error).message : 'Internal server error'
      });
    }
  }
}