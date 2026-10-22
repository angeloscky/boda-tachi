import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { PublicInvitation } from '../../shared/types.js';
import { tempDbPath } from './helpers.js';

const root = path.resolve(__dirname, '../..');
let child: ChildProcess | null = null;

async function startServer(dbPath: string, port: number) {
  child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', 'tsx', 'server/index.ts', '--rsvp-backend=demo'], {
    cwd: root,
    env: {
      ...process.env,
      DB_PATH: dbPath,
      PORT: String(port),
      ADMIN_PASSWORD: 'reinicio-prueba-123',
      PUBLIC_BASE_URL: `http://localhost:${port}`,
      DEMO_SEED: '0',
    },
    stdio: 'ignore',
  });
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://localhost:${port}/api/health`);
      if (r.ok) return;
    } catch {
      /* aún arrancando */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('El servidor no arrancó');
}

async function stopServer() {
  if (!child) return;
  const c = child;
  child = null;
  await new Promise<void>((resolve) => {
    c.once('exit', () => resolve());
    c.kill('SIGTERM');
  });
}

afterEach(stopServer);

describe('persistencia real', () => {
  it('(4) la respuesta sigue ahí después de reiniciar el proceso del servidor', async () => {
    const dbPath = tempDbPath('reinicio');
    const port = 3300 + Math.floor(Math.random() * 300);
    const base = `http://localhost:${port}`;
    await startServer(dbPath, port);
    const login = await fetch(`${base}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'reinicio-prueba-123' }),
    });
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const inv = (await (
      await fetch(`${base}/api/admin/invitations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          code: 'R-1',
          name: 'Familia Reinicio',
          seats: 3,
          people: [{ name: 'Rita Reinicio' }, { name: 'Raúl Reinicio' }, { name: 'Rosa Reinicio' }],
        }),
      })
    ).json()) as { token: string };
    const put = await fetch(`${base}/api/invitations/${inv.token}/rsvp`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'attending', personIds: ['R-1-P1', 'R-1-P3'], expectedRevision: 0, requestId: 'reinicio-0001' }),
    });
    expect(put.status).toBe(200);
    await stopServer();

    await startServer(dbPath, port);
    const after = (await (await fetch(`${base}/api/invitations/${inv.token}`)).json()) as PublicInvitation;
    expect(after.response).toMatchObject({ status: 'attending', personIds: ['R-1-P1', 'R-1-P3'], attending: 2 });
    expect(after.seats).toBe(3);
    expect(after.revision).toBe(1);
  });
});
