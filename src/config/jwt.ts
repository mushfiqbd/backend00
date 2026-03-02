import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

// Validate that JWT_SECRET is set in production
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET === 'fallback-secret-key' || JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be set in environment variables and be at least 32 characters long');
}

// Default to 1 hour in production, configurable via env
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || (process.env.NODE_ENV === 'production' ? '1h' : '24h');

export interface JwtPayload {
  userId: string;
  email: string;
  iat: number;
  exp: number;
}

export const generateToken = (payload: Omit<JwtPayload, 'iat' | 'exp'>): string => {
  // Add required claims for audience validation to the payload
  const tokenPayload = {
    ...payload,
    aud: 'autotrade-sentinel-users',  // audience
    iss: 'autotrade-sentinel'         // issuer
  };
  
  return jwt.sign(tokenPayload, JWT_SECRET, { 
    expiresIn: JWT_EXPIRES_IN
  } as jwt.SignOptions);
};

export const verifyToken = (token: string): JwtPayload | null => {
  try {
    // For backward compatibility, try to verify with audience first
    try {
      return jwt.verify(token, JWT_SECRET, {
        issuer: 'autotrade-sentinel',
        audience: 'autotrade-sentinel-users'
      }) as JwtPayload;
    } catch (audienceError) {
      // If audience check fails, try verifying without audience (for older tokens)
      if ((audienceError as Error).message.includes('audience') || (audienceError as Error).message.includes('aud')) {
        return jwt.verify(token, JWT_SECRET) as JwtPayload;
      }
      // If it's a different error, rethrow it
      throw audienceError;
    }
  } catch (error) {
    console.error('Token verification error:', error);
    return null;
  }
};

export const decodeToken = (token: string): JwtPayload | null => {
  try {
    return jwt.decode(token) as JwtPayload;
  } catch (error) {
    console.error('Token decoding error:', error);
    return null;
  }
};