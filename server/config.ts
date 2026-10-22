import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface AppConfig {
  port: number;
  publicBaseUrl: string;
  dbPath: string;
  adminPasswordHash: string | null;
  adminPasswordPlain: string | null;
  cookieSecure: boolean;
  clientDir: string;
  messagingProvider: string;
  production: boolean;
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
    publicBaseUrl,
    dbPath: path.resolve(root, env.DB_PATH || 'data/boda.sqlite'),
    adminPasswordHash: env.ADMIN_PASSWORD_HASH || null,
    adminPasswordPlain: env.ADMIN_PASSWORD || null,
    cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : publicBaseUrl.startsWith('https://'),
    clientDir: path.join(root, 'dist/client'),
    messagingProvider: env.MESSAGING_PROVIDER || 'simulation',
    production,
    ...overrides,
  };
  const publicDirs = [path.join(root, 'public'), path.join(root, 'dist')];
  if (publicDirs.some((d) => config.dbPath.startsWith(d + path.sep))) {
    throw new Error(`DB_PATH (${config.dbPath}) no puede estar dentro de un directorio público.`);
  }
  return config;
}
