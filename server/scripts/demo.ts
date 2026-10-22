import { loadConfig } from '../config.js';
import { openDb, tx, now } from '../db.js';
import { newToken } from '../invitations.js';

/**
 * Datos SINTÉTICOS de demostración. Todos usan el prefijo DEMO- y la marca is_demo,
 * no aparecen en totales ni exportaciones por defecto y se borran con `npm run demo:clear`.
 * Recomendado: usar una base aparte (DB_PATH=./data/demo.sqlite).
 */
const DEMO = [
  { code: 'DEMO-001', name: 'Familia Demostración Ruiz', phone: '523300000001', seats: 4 },
  { code: 'DEMO-002', name: 'Familia Ejemplo Torres', phone: '523300000002', seats: 2 },
  { code: 'DEMO-003', name: 'Invitada de Prueba Luna', phone: null, seats: 1 },
  { code: 'DEMO-004', name: 'Familia Ficticia Prado', phone: '523300000004', seats: null },
  { code: 'DEMO-005', name: 'Pareja Ejemplo Sol', phone: null, seats: 2 },
];

const mode = process.argv[2];
const config = loadConfig();
const db = openDb(config.dbPath);
if (mode === 'seed') {
  tx(db, () => {
    const t = now();
    const ins = db.prepare(
      `INSERT INTO invitations (code, token, name, phone, seats, is_demo, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, 'Dato sintético de demostración', ?, ?) ON CONFLICT(code) DO NOTHING`,
    );
    for (const d of DEMO) ins.run(d.code, newToken(), d.name, d.phone, d.seats, t, t);
  });
  const rows = db.prepare("SELECT code, name, token FROM invitations WHERE is_demo = 1 ORDER BY code").all() as { code: string; name: string; token: string }[];
  console.log('Invitaciones de demostración:');
  for (const r of rows) console.log(`  ${r.code}  ${r.name}  ${config.publicBaseUrl}/i/${r.token}`);
} else if (mode === 'clear') {
  const r = db.prepare('DELETE FROM invitations WHERE is_demo = 1').run();
  console.log(`Invitaciones de demostración eliminadas: ${r.changes}`);
} else {
  console.error('Uso: npm run demo:seed | npm run demo:clear');
  process.exitCode = 1;
}
db.close();
