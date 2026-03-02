import pool from '../config/database';
import bcrypt from 'bcryptjs';

export interface User {
  id: string;
  email: string;
  password_hash: string;
  created_at: Date;
  updated_at: Date;
}

export interface CreateUserInput {
  email: string;
  password: string;
}

export interface LoginUserInput {
  email: string;
  password: string;
}

export class UserModel {
  static async create(userData: CreateUserInput): Promise<User> {
    // Validate input
    if (!userData.email || !userData.password) {
      throw new Error('Email and password are required');
    }
    
    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(userData.email)) {
      throw new Error('Invalid email format');
    }
    
    if (userData.password.length < 8) {
      throw new Error('Password must be at least 8 characters long');
    }
    
    // Sanitize email
    const sanitizedEmail = userData.email.toLowerCase().trim();
    
    const hashedPassword = await bcrypt.hash(userData.password, 12);
    
    const query = `
      INSERT INTO users (email, password_hash)
      VALUES ($1, $2)
      RETURNING id, email, password_hash, created_at, updated_at
    `;
    
    const values = [sanitizedEmail, hashedPassword];
    const result = await pool.query(query, values);
    
    return result.rows[0];
  }

  static async findByEmail(email: string): Promise<User | null> {
    // Validate input
    if (!email) {
      return null;
    }
    
    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return null;
    }
    
    const query = `
      SELECT id, email, password_hash, created_at, updated_at
      FROM users
      WHERE email = $1
    `;
    
    const result = await pool.query(query, [email.toLowerCase().trim()]);
    return result.rows[0] || null;
  }

  static async findById(id: string): Promise<User | null> {
    // Validate input
    if (!id || typeof id !== 'string' || id.length === 0) {
      return null;
    }
    
    const query = `
      SELECT id, email, password_hash, created_at, updated_at
      FROM users
      WHERE id = $1
    `;
    
    const result = await pool.query(query, [id]);
    return result.rows[0] || null;
  }

  static async validatePassword(
    userPassword: string,
    hashedPassword: string
  ): Promise<boolean> {
    if (!userPassword || !hashedPassword) {
      return false;
    }
    return bcrypt.compare(userPassword, hashedPassword);
  }

  static async emailExists(email: string): Promise<boolean> {
    // Validate input
    if (!email) {
      return false;
    }
    
    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return false;
    }
    
    const query = 'SELECT id FROM users WHERE email = $1';
    const result = await pool.query(query, [email.toLowerCase().trim()]);
    return result.rows.length > 0;
  }
}