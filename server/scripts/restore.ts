import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loadConfig } from '../config.js';

// Uso (con el servidor DETENIDO): npm run db:restore -- ruta/respaldo.sqlite
const src = process.argv[2];
if (!src || !fs.existsSync(src)) {
  console.error('Indica el archivo de respaldo: npm run db:restore -- backups/boda-AAAA-MM-DD-HH-MM-SS.sqlite');
  process.exit(1);
}
const check = new DatabaseSync(src, { readOnly: true });
const integrity = (check.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
const hasTables = check.prepare("SELECT 1 FROM sqlite_master WHERE name = 'invitations'").get();
check.close();
if (integrity !== 'ok' || !hasTables) {
  console.error(`El respaldo no es válido (${integrity}). No se restauró nada.`);
  process.exit(1);
}
const config = loadConfig();
if (fs.existsSync(config.dbPath)) {
  const keep = `${config.dbPath}.antes-de-restaurar-${Date.now()}`;
  fs.copyFileSync(config.dbPath, keep);
  console.log(`Base actual guardada en: ${keep}`);
}
for (const ext of ['-wal', '-shm']) fs.rmSync(config.dbPath + ext, { force: true });
fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
fs.copyFileSync(src, config.dbPath);
console.log(`Restaurado ${src} -> ${config.dbPath}. Ya puedes iniciar el servidor.`);
