import path from 'node:path';
import { loadConfig, projectRoot } from '../config.js';
import { openDb, backupTo } from '../db.js';

// Uso: npm run db:backup [-- ruta/destino.sqlite]
const config = loadConfig();
const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const dest = path.resolve(process.argv[2] ?? path.join(projectRoot(), 'backups', `boda-${stamp}.sqlite`));
const db = openDb(config.dbPath);
backupTo(db, dest);
db.close();
console.log(`Respaldo creado: ${dest}`);
