import { loadConfig } from '../config.js';
import { openDb } from '../db.js';
import { demoLinks, seedDemo } from '../demo-data.js';

/**
 * Datos FICTICIOS de la demostración local (DEMO-001…005, enlaces demo_…).
 * La base local es solo de demostración: el registro real será Google Sheets.
 */
const mode = process.argv[2];
const config = loadConfig();
const db = openDb(config.dbPath);
if (mode === 'seed') {
  const n = seedDemo(db);
  console.log(`Familias de demostración creadas: ${n}`);
  for (const l of demoLinks(db, config.publicBaseUrl)) console.log(`  ${l.code}  ${l.name}  ${l.link}`);
} else if (mode === 'clear') {
  const r = db.prepare("DELETE FROM invitations WHERE code LIKE 'DEMO-%'").run();
  console.log(`Invitaciones de demostración eliminadas: ${r.changes}`);
} else {
  console.error('Uso: npm run demo:seed | npm run demo:clear');
  process.exitCode = 1;
}
db.close();
