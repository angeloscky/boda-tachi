import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { now, type DB } from './db.js';

export const SESSION_COOKIE = 'bt_admin';
const SESSION_DAYS = 7;

/** Formato: scrypt$N$r$p$salt(base64)$hash(base64) */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const N = 16384, r = 8, p = 1;
  const hash = crypto.scryptSync(password, salt, 32, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
  });
  return crypto.timingSafeEqual(actual, expected);
}

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export function createSession(db: DB): { token: string; expires: Date } {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  db.prepare('DELETE FROM admin_sessions WHERE expires_at < ?').run(now());
  db.prepare('INSERT INTO admin_sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)').run(
    sha256(token),
    now(),
    expires.toISOString(),
  );
  return { token, expires };
}

export function isValidSession(db: DB, token: string | undefined): boolean {
  if (!token) return false;
  const row = db.prepare('SELECT expires_at FROM admin_sessions WHERE token_hash = ?').get(sha256(token)) as
    | { expires_at: string }
    | undefined;
  return Boolean(row && row.expires_at > now());
}

export function destroySession(db: DB, token: string | undefined) {
  if (token) db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(sha256(token));
}

export function requireAdmin(db: DB) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!isValidSession(db, req.cookies?.[SESSION_COOKIE])) {
      res.status(401).json({ error: 'unauthorized', message: 'Inicia sesión para continuar.' });
      return;
    }
    next();
  };
}

/** Limitador sencillo en memoria por clave (IP). Suficiente para un solo proceso. */
export function createLimiter(max: number, windowMs: number) {
  const hits = new Map<string, { count: number; reset: number }>();
  return {
    hit(key: string): boolean {
      const t = Date.now();
      const entry = hits.get(key);
      if (!entry || entry.reset < t) {
        hits.set(key, { count: 1, reset: t + windowMs });
        if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < t) hits.delete(k);
        return true;
      }
      entry.count++;
      return entry.count <= max;
    },
    reset(key: string) {
      hits.delete(key);
    },
  };
}
