import { loadConfig } from '../config.js';
import { openDb, migrate } from '../db.js';

const config = loadConfig();
const db = openDb(config.dbPath);
const applied = migrate(db);
console.log(`Base de datos lista: ${config.dbPath}${applied.length ? ` (aplicadas: ${applied.join(', ')})` : ' (sin migraciones pendientes)'}`);
db.close();
