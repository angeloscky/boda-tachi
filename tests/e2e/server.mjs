// Arranca el servidor compilado (requiere `npm run build`). Con base de demostración vacía si
// RSVP_BACKEND=demo; sin registro (no abre ninguna base) si RSVP_BACKEND no está definido.
import fs from 'node:fs';
const dbPath = process.env.DB_PATH;
if (dbPath && process.env.RSVP_BACKEND === 'demo') for (const ext of ['', '-wal', '-shm']) fs.rmSync(`${dbPath}${ext}`, { force: true });
await import('../../dist/server/server/index.js');
