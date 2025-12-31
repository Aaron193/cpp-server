import jwt from 'jsonwebtoken';
import { eq, or } from 'drizzle-orm';
import { getDb } from '../db/client';
import { users, NewUser } from '../db/schema';
import { hashPassword, verifyPassword } from './password';
import { env } from '../config/env';
import { CONSTANTS } from '../config/constants';
import type { User, JWTPayload } from '../types/shared';

/**
 * Register a new user
 */
export async function registerUser(
  username: string,
  password: string,
  email?: string
): Promise<User> {
  const db = getDb();

  // Validate username length
  if (username.length < CONSTANTS.MIN_USERNAME_LENGTH || username.length > CONSTANTS.MAX_USERNAME_LENGTH) {
    throw new Error(`Username must be between ${CONSTANTS.MIN_USERNAME_LENGTH} and ${CONSTANTS.MAX_USERNAME_LENGTH} characters`);
  }

  // Validate password length
  if (password.length < CONSTANTS.MIN_PASSWORD_LENGTH || password.length > CONSTANTS.MAX_PASSWORD_LENGTH) {
    throw new Error(`Password must be between ${CONSTANTS.MIN_PASSWORD_LENGTH} and ${CONSTANTS.MAX_PASSWORD_LENGTH} characters`);
  }

  // Check if username already exists
  const existingUser = await db.query.users.findFirst({
    where: eq(users.username, username),
  });

  if (existingUser) {
    throw new Error('Username already taken');
  }

  // Check if email already exists (if provided)
  if (email) {
    const existingEmail = await db.query.users.findFirst({
      where: eq(users.email, email),
    });

    if (existingEmail) {
      throw new Error('Email already registered');
    }
  }

  // Hash password
  const passwordHash = await hashPassword(password);

  // Insert user
  const newUser: NewUser = {
    username,
    email: email || null,
    passwordHash,
  };

  const [user] = await db.insert(users).values(newUser).returning();

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    createdAt: user.createdAt,
  };
}

/**
 * Authenticate a user by username/email and password
 */
export async function authenticateUser(
  usernameOrEmail: string,
  password: string
): Promise<User> {
  const db = getDb();

  // Find user by username or email
  const user = await db.query.users.findFirst({
    where: or(
      eq(users.username, usernameOrEmail),
      eq(users.email, usernameOrEmail)
    ),
  });

  if (!user) {
    throw new Error('Invalid credentials');
  }

  // Verify password
  const isValid = await verifyPassword(user.passwordHash, password);

  if (!isValid) {
    throw new Error('Invalid credentials');
  }

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    createdAt: user.createdAt,
  };
}

/**
 * Generate a JWT access token for a user
 */
export function generateAccessToken(user: User): string {
  const payload: Omit<JWTPayload, 'iat' | 'exp'> = {
    sub: user.id,
    username: user.username,
  };

  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as string | number,
  } as jwt.SignOptions);
}

/**
 * Verify a JWT access token
 */
export function verifyAccessToken(token: string): JWTPayload {
  try {
    return jwt.verify(token, env.JWT_SECRET) as JWTPayload;
  } catch (err) {
    throw new Error('Invalid or expired token');
  }
}

/**
 * Get user by ID
 */
export async function getUserById(userId: string): Promise<User | null> {
  const db = getDb();

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  if (!user) {
    return null;
  }

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    createdAt: user.createdAt,
  };
}
