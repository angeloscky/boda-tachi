import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { adminAgent, createInv, makeApp, tempDbPath, testConfig } from './helpers.js';
import { openDb } from '../../server/db.js';
import { createApp } from '../../server/app.js';
import { hashPassword } from '../../server/auth.js';
import { loadConfig } from '../../server/config.js';

describe('endurecimiento tras la revisión de seguridad', () => {
  it('los identificadores no distinguen mayúsculas (alta e importación)', async () => {
    const { app, db } = makeApp();
    const admin = await adminAgent(app);
    await createInv(admin, { code: 'FAM-001', name: 'Familia Uno', seats: 2 });
    const dup = await admin.post('/api/admin/invitations').send({ code: 'fam-001', name: 'Otra', seats: 1 });
    expect(dup.status).toBe(409);
    const prev = await admin.post('/api/admin/import/preview').send({ csv: 'identificador,nombre,lugares_adultos\nFam-001,Familia Uno,3' });
    expect(prev.body.rows[0].action).toBe('update');
    await admin.post('/api/admin/import/apply').send({ csv: 'identificador,nombre,lugares_adultos\nFam-001,Familia Uno,3' }).expect(200);
    const rows = db.prepare('SELECT code, seats FROM invitations').all() as { code: string; seats: number }[];
    expect(rows).toEqual([{ code: 'FAM-001', seats: 3 }]);
  });

  it('importar sin columna de teléfono conserva los teléfonos y avisa qué cambia', async () => {
    const { app, db } = makeApp();
    const admin = await adminAgent(app);
    await createInv(admin, { code: 'P-1', name: 'Familia Tel', seats: 2, phone: '3312345678' });
    const csv = 'identificador,nombre,lugares_adultos\nP-1,Familia Tel,4';
    const prev = await admin.post('/api/admin/import/preview').send({ csv });
    expect(prev.body.rows[0].warnings[0]).toMatch(/lugares 2 → 4/);
    expect(prev.body.rows[0].warnings[0]).not.toMatch(/teléfono/);
    await admin.post('/api/admin/import/apply').send({ csv }).expect(200);
    expect((db.prepare("SELECT phone FROM invitations WHERE code = 'P-1'").get() as { phone: string }).phone).toBe('523312345678');
  });

  it('rechaza orígenes nulos o mal formados con 403 y cuerpos grandes con 413', async () => {
    const { app } = makeApp();
    const admin = await adminAgent(app);
    const inv = await createInv(admin, { code: 'O-1', name: 'Familia Origen', seats: 1 });
    for (const origin of ['null', '::::', 'https://otro.example']) {
      const r = await request(app).put(`/api/invitations/${inv.token}/rsvp`).set('Origin', origin).send({ status: 'declined', adults: 0 });
      expect(r.status, origin).toBe(403);
    }
    const ok = await request(app).put(`/api/invitations/${inv.token}/rsvp`).set('Origin', 'https://boda.example').send({ status: 'declined', adults: 0 });
    expect(ok.status).toBe(200);
    const big = await request(app).put(`/api/invitations/${inv.token}/rsvp`).send({ status: 'declined', adults: 0, pad: 'x'.repeat(40_000) });
    expect(big.status).toBe(413);
  });

  it('no confía en X-Forwarded-For sin proxy declarado', async () => {
    const { app } = makeApp();
    for (let i = 0; i < 10; i++) await request(app).post('/api/admin/login').set('X-Forwarded-For', `198.51.100.${i}`).send({ password: 'mala' });
    const r = await request(app).post('/api/admin/login').set('X-Forwarded-For', '198.51.100.250').send({ password: 'mala' });
    expect(r.status).toBe(429);
  });

  it('cambiar la contraseña cierra las sesiones existentes', async () => {
    const dbPath = tempDbPath('rotacion');
    const db = openDb(dbPath);
    const app1 = createApp(db, { ...testConfig(dbPath), adminPasswordPlain: null, adminPasswordHash: hashPassword('primera-clave-123') });
    const login = await request(app1).post('/api/admin/login').send({ password: 'primera-clave-123' });
    const cookie = login.headers['set-cookie'] as unknown as string[];
    await request(app1).get('/api/admin/summary').set('Cookie', cookie).expect(200);
    const app2 = createApp(db, { ...testConfig(dbPath), adminPasswordPlain: null, adminPasswordHash: hashPassword('segunda-clave-456') });
    await request(app2).get('/api/admin/summary').set('Cookie', cookie).expect(401);
  });

  it('impide colocar la base dentro del directorio que se sirve', () => {
    expect(() => loadConfig({ clientDir: '/tmp/servido', dbPath: '/tmp/servido/copia.sqlite' })).toThrow(/directorio público/);
  });
});
