// Arranca el servidor compilado con una base de pruebas vacía (requiere `npm run build`).
import fs from 'node:fs';
for (const ext of ['', '-wal', '-shm']) fs.rmSync(`./data/e2e.sqlite${ext}`, { force: true });
await import('../../dist/server/server/index.js');
