import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type DB = DatabaseSync;

/**
 * Migraciones en orden. Nunca edites una ya aplicada: agrega una nueva versión.
 */
const MIGRATIONS: { version: number; name: string; sql: string }[] = [
  {
    version: 1,
    name: 'inicial',
    sql: `
      CREATE TABLE invitations (
        id          INTEGER PRIMARY KEY,
        code        TEXT NOT NULL UNIQUE,              -- identificador estable (importación)
        token       TEXT NOT NULL UNIQUE,              -- enlace opaco del invitado
        name        TEXT NOT NULL,
        phone       TEXT,                              -- dígitos E.164 sin "+"
        seats       INTEGER CHECK (seats IS NULL OR (seats BETWEEN 1 AND 30)), -- NULL = pendiente de asignar
        enabled     INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        is_demo     INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
        notes       TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );

      -- Una sola respuesta vigente por invitación (clave primaria = invitación).
      CREATE TABLE responses (
        invitation_id INTEGER PRIMARY KEY REFERENCES invitations(id) ON DELETE CASCADE,
        status        TEXT NOT NULL CHECK (status IN ('attending', 'declined')),
        adults        INTEGER NOT NULL CHECK (adults >= 0),
        source        TEXT NOT NULL DEFAULT 'guest' CHECK (source IN ('guest', 'admin')),
        revision      INTEGER NOT NULL DEFAULT 1,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL,
        CHECK ((status = 'declined' AND adults = 0) OR (status = 'attending' AND adults >= 1))
      );

      -- Historial de cambios de respuesta (auditoría, no se muestra al invitado).
      CREATE TABLE response_history (
        id            INTEGER PRIMARY KEY,
        invitation_id INTEGER NOT NULL REFERENCES invitations(id) ON DELETE CASCADE,
        status        TEXT,                            -- NULL = respuesta borrada (vuelve a pendiente)
        adults        INTEGER,
        source        TEXT NOT NULL,
        recorded_at   TEXT NOT NULL
      );
      CREATE INDEX idx_history_invitation ON response_history(invitation_id);

      -- Estado de comunicación, separado del estado de asistencia.
      CREATE TABLE communications (
        id            INTEGER PRIMARY KEY,
        invitation_id INTEGER NOT NULL REFERENCES invitations(id) ON DELETE CASCADE,
        status        TEXT NOT NULL CHECK (status IN ('prepared', 'sent', 'delivered', 'failed')),
        source        TEXT NOT NULL,                   -- 'simulation', 'manual' o el proveedor que lo reporta
        provider_ref  TEXT,
        note          TEXT,
        created_at    TEXT NOT NULL
      );
      CREATE INDEX idx_comm_invitation ON communications(invitation_id, id);

      CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      INSERT INTO settings (key, value) VALUES ('rsvp_open', 'true');

      CREATE TABLE admin_sessions (
        token_hash TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
    `,
  },
];

export const now = () => new Date().toISOString();

export function openDb(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  if (file !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA synchronous = FULL;');
  }
  db.exec('PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

export function migrate(db: DB): number[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)`);
  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map((r) => r.version),
  );
  const done: number[] = [];
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    tx(db, () => {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(m.version, m.name, now());
    });
    done.push(m.version);
  }
  return done;
}

/** Transacción de escritura. BEGIN IMMEDIATE toma el bloqueo de escritura desde el inicio. */
export function tx<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function getSetting(db: DB, key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(db: DB, key: string, value: string) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

/** Copia consistente de la base (funciona con el servidor encendido). */
export function backupTo(db: DB, dest: string) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest)) throw new Error(`Ya existe ${dest}`);
  db.prepare('VACUUM INTO ?').run(dest);
}
