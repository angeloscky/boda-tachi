import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { createApp } from './app.js';

const config = loadConfig();
const db = openDb(config.dbPath);
const app = createApp(db, config);

const server = app.listen(config.port, () => {
  console.log(`Boda Sofía e Isaac · http://localhost:${config.port}`);
  console.log(`Base de datos: ${config.dbPath}`);
  console.log(`Enlaces públicos: ${config.publicBaseUrl}`);
  if (!config.adminPasswordHash && !config.adminPasswordPlain) {
    console.warn('Aviso: el panel /admin está deshabilitado hasta definir ADMIN_PASSWORD_HASH (npm run admin:hash).');
  } else if (!config.adminPasswordHash) {
    console.warn('Aviso: usando ADMIN_PASSWORD en texto plano; en producción usa ADMIN_PASSWORD_HASH.');
  }
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
