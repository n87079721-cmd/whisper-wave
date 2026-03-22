import crypto from 'crypto';
import { v4 as uuid } from 'uuid';

const JWT_SECRET = process.env.AUTH_TOKEN || 'change-me-to-a-secure-random-string';
const ITERATIONS = 100000;
const KEYLEN = 64;
const DIGEST = 'sha512';
const LEGACY_USERNAME = '__legacy__';
const LEGACY_PENDING_HASH = '__legacy_pending__';

// Simple PBKDF2-based password hashing (no extra dependencies)
export function hashPassword(password) {
  const salt = crypto.randomBytes(32).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, ITERATIONS, KEYLEN, DIGEST).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const verify = crypto.pbkdf2Sync(password, salt, ITERATIONS, KEYLEN, DIGEST).toString('hex');
  return hash === verify;
}

// Simple JWT-like token using HMAC (no jsonwebtoken dependency)
export function createToken(userId) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: userId, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 30 * 24 * 3600 })).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

export function verifyToken(token) {
  try {
    const [header, payload, signature] = token.split('.');
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
    if (signature !== expected) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (data.exp && data.exp < Math.floor(Date.now() / 1000)) return null;
    return data.sub; // userId
  } catch {
    return null;
  }
}

export function authMiddleware(db) {
  return (req, res, next) => {
    // Support token via Authorization header or query param (for EventSource)
    let token = null;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    } else if (req.query.token) {
      token = req.query.token;
    }
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const userId = verifyToken(token);
    if (!userId) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    const user = db.prepare('SELECT id, username, display_name FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }
    req.userId = userId;
    req.user = user;
    next();
  };
}

export function registerUser(db, username, password, displayName) {
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) throw new Error('Username already taken');

  const legacyUser = db.prepare(
    'SELECT id FROM users WHERE username = ? AND password_hash = ? LIMIT 1'
  ).get(LEGACY_USERNAME, LEGACY_PENDING_HASH);

  const nextDisplayName = displayName || username;
  const hash = hashPassword(password);

  if (legacyUser) {
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    if (userCount === 1) {
      db.prepare('UPDATE users SET username = ?, password_hash = ?, display_name = ? WHERE id = ?')
        .run(username, hash, nextDisplayName, legacyUser.id);
      return { id: legacyUser.id, username, displayName: nextDisplayName };
    }
  }

  const id = uuid();
  db.prepare('INSERT INTO users (id, username, password_hash, display_name) VALUES (?, ?, ?, ?)').run(id, username, hash, nextDisplayName);
  return { id, username, displayName: nextDisplayName };
}

export function loginUser(db, username, password) {
  const user = db.prepare('SELECT id, username, password_hash, display_name FROM users WHERE username = ?').get(username);
  if (!user) throw new Error('Invalid credentials');
  if (!verifyPassword(password, user.password_hash)) throw new Error('Invalid credentials');
  return { id: user.id, username: user.username, displayName: user.display_name };
}
