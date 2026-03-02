import { Request, Response } from 'express';
import { AppSettingsModel } from '../models/AppSettings';
import logger from '../utils/logger';

export class SettingsController {
  static async getSettings(req: Request, res: Response): Promise<Response | void> {
    try {
      const user = req.user;
      if (!user) {
        logger.warn('Get settings failed - authentication required', {
          ip: req.ip || req.connection.remoteAddress,
          timestamp: new Date().toISOString()
        });
        
        return res.status(401).json({
          error: 'Authentication required'
        });
      }

      const settings = await AppSettingsModel.findByUserId(user.userId);
      
      if (!settings) {
        logger.warn('Get settings failed - settings not found', {
          userId: user.userId,
          ip: req.ip || req.connection.remoteAddress,
          timestamp: new Date().toISOString()
        });
        
        return res.status(404).json({
          error: 'Settings not found'
        });
      }

      logger.info('Get settings successful', {
        userId: user.userId,
        timestamp: new Date().toISOString()
      });

      res.status(200).json({
        data: settings
      });

    } catch (error) {
      logger.error('Get settings error', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: req.user?.userId,
        ip: req.ip || req.connection.remoteAddress,
        timestamp: new Date().toISOString()
      });
      
      res.status(500).json({
        error: 'Failed to fetch settings',
        message: process.env.NODE_ENV === 'development' ? (error as Error).message : 'Internal server error'
      });
    }
  }

  static async updateSettings(req: Request, res: Response): Promise<Response | void> {
    try {
      const user = req.user;
      if (!user) {
        logger.warn('Update settings failed - authentication required', {
          ip: req.ip || req.connection.remoteAddress,
          timestamp: new Date().toISOString()
        });
        
        return res.status(401).json({
          error: 'Authentication required'
        });
      }

      const { trading_mode } = req.body;

      if (trading_mode && !['demo', 'real'].includes(trading_mode)) {
        logger.warn('Update settings failed - invalid trading mode', {
          userId: user.userId,
          trading_mode,
          ip: req.ip || req.connection.remoteAddress,
          timestamp: new Date().toISOString()
        });
        
        return res.status(400).json({
          error: 'Invalid trading mode. Must be "demo" or "real"'
        });
      }

      const settings = await AppSettingsModel.updateTradingMode(user.userId, trading_mode);
      
      if (!settings) {
        logger.warn('Update settings failed - settings not found', {
          userId: user.userId,
          ip: req.ip || req.connection.remoteAddress,
          timestamp: new Date().toISOString()
        });
        
        return res.status(404).json({
          error: 'Settings not found'
        });
      }

      logger.info('Update settings successful', {
        userId: user.userId,
        trading_mode,
        timestamp: new Date().toISOString()
      });

      res.status(200).json({
        message: 'Settings updated successfully',
        data: settings
      });

    } catch (error) {
      logger.error('Update settings error', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: req.user?.userId,
        trading_mode: req.body.trading_mode,
        ip: req.ip || req.connection.remoteAddress,
        timestamp: new Date().toISOString()
      });
      
      res.status(500).json({
        error: 'Failed to update settings',
        message: process.env.NODE_ENV === 'development' ? (error as Error).message : 'Internal server error'
      });
    }
  }
}