import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { adminAgent, countResponses, createInv, makeApp, tempDbPath, testConfig } from './helpers.js';
import { openDb } from '../../server/db.js';
import { createApp } from '../../server/app.js';

describe('confirmación de asistencia', () => {
  it('guarda la respuesta y la devuelve al volver a abrir el enlace', async () => {
    const { app } = makeApp();
    const admin = await adminAgent(app);
    const inv = await createInv(admin, { code: 'T-1', name: 'Familia Prueba', seats: 3 });
    const put = await request(app).put(`/api/invitations/${inv.token}/rsvp`).send({ status: 'attending', adults: 2 });
    expect(put.status).toBe(200);
    expect(put.body.response).toMatchObject({ status: 'attending', adults: 2 });
    const get = await request(app).get(`/api/invitations/${inv.token}`);
    expect(get.body.response).toMatchObject({ status: 'attending', adults: 2 });
  });

  it('(4) la respuesta persiste al cerrar y reabrir la base de datos', async () => {
    const dbPath = tempDbPath('persist');
    const first = makeApp(dbPath);
    const admin = await adminAgent(first.app);
    const inv = await createInv(admin, { code: 'T-P', name: 'Familia Persistente', seats: 2 });
    await request(first.app).put(`/api/invitations/${inv.token}/rsvp`).send({ status: 'attending', adults: 2 }).expect(200);
    first.db.close();
    const second = makeApp(dbPath);
    const get = await request(second.app).get(`/api/invitations/${inv.token}`);
    expect(get.body.response).toMatchObject({ status: 'attending', adults: 2 });
    second.db.close();
  });

  it('(5) un doble envío o reintentos en paralelo dejan una sola respuesta vigente', async () => {
    const { app, db } = makeApp();
    const admin = await adminAgent(app);
    const inv = await createInv(admin, { code: 'T-2', name: 'Familia Doble', seats: 4 });
    const results = await Promise.all(
      Array.from({ length: 12 }, () => request(app).put(`/api/invitations/${inv.token}/rsvp`).send({ status: 'attending', adults: 3 })),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(countResponses(db, inv.id)).toBe(1);
    const rev = db.prepare('SELECT revision FROM responses WHERE invitation_id = ?').get(inv.id) as { revision: number };
    expect(rev.revision).toBe(1);
    const hist = db.prepare('SELECT COUNT(*) AS n FROM response_history WHERE invitation_id = ?').get(inv.id) as { n: number };
    expect(hist.n).toBe(1);
    const summary = await admin.get('/api/admin/summary');
    expect(summary.body.adultsConfirmed).toBe(3);
  });

  it('(6) rechaza en servidor más asistentes que lugares asignados', async () => {
    const { app } = makeApp();
    const admin = await adminAgent(app);
    const inv = await createInv(admin, { code: 'T-3', name: 'Familia Límite', seats: 2 });
    const res = await request(app).put(`/api/invitations/${inv.token}/rsvp`).send({ status: 'attending', adults: 3 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('too_many_adults');
    const get = await request(app).get(`/api/invitations/${inv.token}`);
    expect(get.body.response).toBeNull();
  });

  it('valida tipo, signo y coherencia de la respuesta', async () => {
    const { app } = makeApp();
    const admin = await adminAgent(app);
    const inv = await createInv(admin, { code: 'T-4', name: 'Familia Validación', seats: 3 });
    const url = `/api/invitations/${inv.token}/rsvp`;
    const cases: [unknown, string][] = [
      [{ status: 'attending', adults: 1.5 }, 'invalid_adults'],
      [{ status: 'attending', adults: '2' }, 'invalid_adults'],
      [{ status: 'attending', adults: -1 }, 'invalid_adults'],
      [{ status: 'attending', adults: 0 }, 'invalid_adults'],
      [{ status: 'attending' }, 'invalid_adults'],
      [{ status: 'declined', adults: 2 }, 'invalid_adults'],
      [{ status: 'maybe', adults: 1 }, 'invalid_status'],
      [{ status: 'attending', adults: 1e9 }, 'too_many_adults'],
    ];
    for (const [body, code] of cases) {
      const res = await request(app).put(url).send(body as object);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error, JSON.stringify(body)).toBe(code);
    }
    const bad = await request(app).put(url).set('Content-Type', 'application/json').send('{"status":');
    expect(bad.status).toBe(400);
    const ok = await request(app).put(url).send({ status: 'declined', adults: 0 });
    expect(ok.status).toBe(200);
    expect(ok.body.response).toMatchObject({ status: 'declined', adults: 0 });
  });

  it('permite actualizar la respuesta mientras esté abierta y la bloquea al cerrar', async () => {
    const { app } = makeApp();
    const admin = await adminAgent(app);
    const inv = await createInv(admin, { code: 'T-5', name: 'Familia Cambio', seats: 2 });
    const url = `/api/invitations/${inv.token}/rsvp`;
    await request(app).put(url).send({ status: 'attending', adults: 2 }).expect(200);
    await request(app).put(url).send({ status: 'declined', adults: 0 }).expect(200);
    await admin.put('/api/admin/settings').send({ rsvpOpen: false }).expect(200);
    const closed = await request(app).put(url).send({ status: 'attending', adults: 1 });
    expect(closed.status).toBe(409);
    expect(closed.body.error).toBe('rsvp_closed');
    const get = await request(app).get(`/api/invitations/${inv.token}`);
    expect(get.body).toMatchObject({ canRespond: false, closedReason: 'rsvp_closed', response: { status: 'declined', adults: 0 } });
  });

  it('una invitación sin lugares asignados queda pendiente y no acepta confirmación', async () => {
    const { app } = makeApp();
    const admin = await adminAgent(app);
    const inv = await createInv(admin, { code: 'T-6', name: 'Familia Sin Lugares', seats: null });
    const get = await request(app).get(`/api/invitations/${inv.token}`);
    expect(get.body).toMatchObject({ seats: null, canRespond: false, closedReason: 'seats_unassigned' });
    const res = await request(app).put(`/api/invitations/${inv.token}/rsvp`).send({ status: 'attending', adults: 1 });
    expect(res.status).toBe(409);
    const summary = await admin.get('/api/admin/summary');
    expect(summary.body.incomplete).toBe(1);
  });

  it('un enlace desactivado o inexistente responde 404', async () => {
    const { app } = makeApp();
    const admin = await adminAgent(app);
    const inv = await createInv(admin, { code: 'T-7', name: 'Familia Desactivada', seats: 2 });
    await admin.put(`/api/admin/invitations/${inv.id}`).send({ code: 'T-7', name: 'Familia Desactivada', seats: 2, enabled: false }).expect(200);
    expect((await request(app).get(`/api/invitations/${inv.token}`)).status).toBe(404);
    expect((await request(app).get('/api/invitations/AAAAAAAAAAAAAAAAAAAAAAAA')).status).toBe(404);
    expect((await request(app).get('/api/invitations/corto')).status).toBe(404);
  });

  it('no permite bajar los lugares por debajo de los adultos ya confirmados', async () => {
    const { app } = makeApp();
    const admin = await adminAgent(app);
    const inv = await createInv(admin, { code: 'T-8', name: 'Familia Reducción', seats: 4 });
    await request(app).put(`/api/invitations/${inv.token}/rsvp`).send({ status: 'attending', adults: 3 }).expect(200);
    const res = await admin.put(`/api/admin/invitations/${inv.id}`).send({ code: 'T-8', name: 'Familia Reducción', seats: 2 });
    expect(res.status).toBe(409);
  });

  it('las escrituras repetidas sobre el mismo archivo con dos conexiones no duplican', async () => {
    const dbPath = tempDbPath('dos');
    const a = makeApp(dbPath);
    const admin = await adminAgent(a.app);
    const inv = await createInv(admin, { code: 'T-9', name: 'Familia Dos Conexiones', seats: 2 });
    const db2 = openDb(dbPath);
    const app2 = createApp(db2, testConfig(dbPath));
    await Promise.all([
      request(a.app).put(`/api/invitations/${inv.token}/rsvp`).send({ status: 'attending', adults: 1 }),
      request(app2).put(`/api/invitations/${inv.token}/rsvp`).send({ status: 'attending', adults: 2 }),
    ]);
    expect(countResponses(a.db, inv.id)).toBe(1);
    db2.close();
  });
});
