import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

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

/**
 * Sesiones del panel en memoria del proceso (solo el hash del token). No dependen de ninguna
 * base de datos, así que funcionan igual con la demostración local o con Google Sheets.
 * Al reiniciar el servidor (o cambiar la contraseña, que exige reiniciar) hay que entrar de nuevo.
 */
export function createSessionStore() {
  const sessions = new Map<string, number>();
  const prune = () => {
    const t = Date.now();
    for (const [k, exp] of sessions) if (exp < t) sessions.delete(k);
  };
  return {
    create(): { token: string; expires: Date } {
      prune();
      const token = crypto.randomBytes(32).toString('base64url');
      const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
      sessions.set(sha256(token), expires.getTime());
      return { token, expires };
    },
    isValid(token: string | undefined): boolean {
      if (!token) return false;
      const exp = sessions.get(sha256(token));
      return exp !== undefined && exp > Date.now();
    },
    destroy(token: string | undefined) {
      if (token) sessions.delete(sha256(token));
    },
  };
}
export type SessionStore = ReturnType<typeof createSessionStore>;

export function requireAdmin(sessions: SessionStore) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!sessions.isValid(req.cookies?.[SESSION_COOKIE])) {
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
    /** Ya superó el máximo en la ventana actual (sin contar un intento nuevo). */
    blocked(key: string): boolean {
      const entry = hits.get(key);
      return Boolean(entry && entry.reset >= Date.now() && entry.count >= max);
    },
    reset(key: string) {
      hits.delete(key);
    },
  };
}
