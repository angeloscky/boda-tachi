import { loadConfig, parseBackend } from './config.js';
import { openDb, type DB } from './db.js';
import { createApp } from './app.js';
import { demoLinks, seedDemo } from './demo-data.js';

// `--rsvp-backend=demo` (lo usan npm run dev / npm run demo) funciona igual en Windows y Linux.
const flag = process.argv.find((a) => a.startsWith('--rsvp-backend='));
const config = loadConfig(flag ? { rsvpBackend: parseBackend(flag.split('=')[1]) } : {});
const db: DB | null = config.rsvpBackend === 'demo' ? openDb(config.dbPath) : null;
const app = createApp(db, config);

const server = app.listen(config.port, () => {
  console.log(`Boda Sofía e Isaac · http://localhost:${config.port}`);
  console.log(`Enlace general: ${config.publicBaseUrl}/`);
  if (db) {
    const created = process.env.DEMO_SEED === '0' ? 0 : seedDemo(db);
    console.log(`Modo DEMOSTRACIÓN (datos ficticios, ${config.dbPath})${created ? `; se crearon ${created} familias de ejemplo` : ''}.`);
    for (const l of demoLinks(db, config.publicBaseUrl)) console.log(`  ${l.code}  ${l.name}  ${l.link}`);
  } else if (config.rsvpBackend === 'sheets') {
    console.log('Modo Google Sheets. Estado de la conexión: panel /admin.');
  } else {
    console.log('Sin registro de confirmaciones (RSVP_BACKEND vacío): la confirmación aparece como no habilitada.');
  }
  if (!config.adminPasswordHash && !config.adminPasswordPlain) {
    console.warn('Aviso: el panel /admin está deshabilitado hasta definir ADMIN_PASSWORD_HASH (npm run admin:hash).');
  } else if (!config.adminPasswordHash) {
    console.warn('Aviso: usando ADMIN_PASSWORD en texto plano; en producción usa ADMIN_PASSWORD_HASH.');
  }
});

function shutdown() {
  server.close(() => {
    db?.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
