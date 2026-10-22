import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface AppConfig {
  port: number;
  /** Interfaz donde escucha el servidor. Sin HOST, la de Node (todas las interfaces); en Render, 0.0.0.0. */
  host: string | null;
  publicBaseUrl: string;
  dbPath: string;
  adminPasswordHash: string | null;
  adminPasswordPlain: string | null;
  cookieSecure: boolean;
  clientDir: string;
  messagingProvider: string;
  production: boolean;
  /** Saltos de proxy de confianza para obtener la IP real (0 = ninguno). */
  trustProxy: number;
  /**
   * Dónde se guardan las confirmaciones. Sin valor = disabled: la confirmación aparece
   * como no habilitada; nunca se activa la demostración por omisión.
   */
  rsvpBackend: 'demo' | 'sheets' | 'disabled';
  sheets: { url: string | null; secret: string | null; timeoutMs: number };
}

const BACKENDS = ['demo', 'sheets', 'disabled'] as const;

export function parseBackend(value: string | undefined): AppConfig['rsvpBackend'] {
  const v = (value ?? '').trim().toLowerCase();
  if (!v) return 'disabled';
  if ((BACKENDS as readonly string[]).includes(v)) return v as AppConfig['rsvpBackend'];
  throw new Error(`RSVP_BACKEND="${value}" no es válido. Usa demo, sheets o disabled.`);
}

/** Raíz del proyecto, tanto en desarrollo (server/) como compilado (dist/server/server/). */
export function projectRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const root = projectRoot();
  const envFile = path.join(root, '.env');
  if (fs.existsSync(envFile) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envFile);
  const env = process.env;
  const production = env.NODE_ENV === 'production';
  const publicBaseUrl = (env.PUBLIC_BASE_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/+$/, '');
  const config: AppConfig = {
    port: Number(env.PORT || 3000),
    host: env.HOST?.trim() || null,
    publicBaseUrl,
    dbPath: path.resolve(root, env.DB_PATH || 'data/demo.sqlite'),
    adminPasswordHash: env.ADMIN_PASSWORD_HASH || null,
    adminPasswordPlain: env.ADMIN_PASSWORD || null,
    cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : publicBaseUrl.startsWith('https://'),
    clientDir: env.CLIENT_DIR ? path.resolve(root, env.CLIENT_DIR) : path.join(root, 'dist/client'),
    messagingProvider: env.MESSAGING_PROVIDER || 'simulation',
    production,
    trustProxy: Number(env.TRUST_PROXY || 0),
    rsvpBackend: parseBackend(env.RSVP_BACKEND),
    sheets: {
      url: env.SHEETS_WEBAPP_URL?.trim() || null,
      secret: env.SHEETS_SHARED_SECRET || null,
      timeoutMs: Number(env.SHEETS_TIMEOUT_MS || 15_000),
    },
    ...overrides,
  };
  if (config.production) {
    // En producción no se adivina la dirección pública: de ella salen og:url, el enlace general y los personales.
    if (!env.PUBLIC_BASE_URL && !overrides.publicBaseUrl) throw new Error('En producción define PUBLIC_BASE_URL (la dirección pública de la invitación).');
    // La demostración en producción solo a propósito: sus respuestas son de prueba.
    if (config.rsvpBackend === 'demo' && env.DEMO_IN_PRODUCTION !== '1') {
      throw new Error('RSVP_BACKEND=demo en producción guarda respuestas de prueba. Si es una demostración pública, define DEMO_IN_PRODUCTION=1.');
    }
  }
  // La base nunca debe quedar dentro de un directorio que se sirve o se publica.
  const servedDirs = [path.join(root, 'public'), path.join(root, 'dist'), config.clientDir];
  const dbReal = path.resolve(config.dbPath);
  for (const dir of servedDirs) {
    const rel = path.relative(path.resolve(dir), dbReal);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
      throw new Error(`DB_PATH (${config.dbPath}) no puede estar dentro de un directorio público (${dir}).`);
    }
  }
  return config;
}
