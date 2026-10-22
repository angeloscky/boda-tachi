import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { adminAgent, countResponses, createInv, historyCount, makeApp, reqId, rsvpBody, tempDbPath, testConfig } from './helpers.js';
import { openDb } from '../../server/db.js';
import { createApp } from '../../server/app.js';
import type { GuestStore } from '../../server/store.js';
import { HttpError } from '../../server/errors.js';

const FOUR = ['Ana Ficticia', 'Luis Ficticio', 'Sara Ficticia', 'Tomás Ficticio'];

describe('confirmación por personas (demostración local)', () => {
  it('2 de 4 personas confirmadas conservan los 4 lugares asignados', async () => {
    const { app } = makeApp();
    const admin = await adminAgent(app);
    const inv = await createInv(admin, { code: 'F-1', name: 'Familia Prueba', seats: 4, people: FOUR });
    const view = await request(app).get(`/api/invitations/${inv.token}`);
    expect(view.body).toMatchObject({ name: 'Familia Prueba', seats: 4, revision: 0, response: null, canRespond: true, mode: 'demo' });
    expect(view.body.people.map((p: { name: string }) => p.name)).toEqual(FOUR);

    const ids = inv.people.slice(0, 2).map((p) => p.id);
    const put = await request(app).put(`/api/invitations/${inv.token}/rsvp`).send(rsvpBody([ids[1], ids[0]]));
    expect(put.status).toBe(200);
    expect(put.body.outcome).toBe('saved');
    expect(put.body.invitation).toMatchObject({ seats: 4, revision: 1, response: { status: 'attending', attending: 2, personIds: ids } });

    const row = (await admin.get(`/api/admin/invitations/${inv.id}`)).body;
    expect(row).toMatchObject({ seats: 4, attendance: 'attending', attendingCount: 2, selectedPersonIds: ids });
    const summary = (await admin.get('/api/admin/summary')).body;
    expect(summary).toMatchObject({ seatsAssigned: 4, attendingPeople: 2, unusedSeats: 2 });
  });

  it('rechaza nombres ajenos, IDs duplicados o inventados y cupos manipulados', async () => {
    const { app } = makeApp();
    const admin = await adminAgent(app);
    const a = await createInv(admin, { code: 'A', name: 'Familia A', seats: 2, people: ['A uno', 'A dos', 'A tres'] });
    const b = await createInv(admin, { code: 'B', name: 'Familia B', seats: 3, people: ['B uno'] });
    const url = `/api/invitations/${a.token}/rsvp`;
    const cases: [object, string][] = [
      [rsvpBody([b.people[0].id]), 'unknown_person'],
      [rsvpBody(['A-P99']), 'unknown_person'],
      [rsvpBody([a.people[0].id, a.people[0].id]), 'duplicate_person'],
      [rsvpBody(a.people.map((p) => p.id)), 'over_capacity'],
      [{ ...rsvpBody([a.people[0].id]), seats: 5 }, 'forbidden_fields'],
      [{ ...rsvpBody([a.people[0].id]), attending: 3 }, 'forbidden_fields'],
      [{ ...rsvpBody([a.people[0].id]), people: [{ name: 'Intruso' }] }, 'forbidden_fields'],
      [{ ...rsvpBody([]), status: 'attending' }, 'no_people_selected'],
      [{ ...rsvpBody([a.people[0].id]), status: 'declined' }, 'declined_with_people'],
    ];
    for (const [body, code] of cases) {
      const res = await request(app).put(url).send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error, JSON.stringify(body)).toBe(code);
    }
    const view = (await request(app).get(`/api/invitations/${a.token}`)).body;
    expect(view).toMatchObject({ seats: 2, response: null });
    expect(view.people).toHaveLength(3);
    expect((await admin.get(`/api/admin/invitations/${b.id}`)).body.attendance).toBe('pending');
  });

  it('reenviar la misma solicitud no duplica, y doce envíos en paralelo dejan una sola respuesta', async () => {
    const { app, db } = makeApp();
    const admin = await adminAgent(app);
    const inv = await createInv(admin, { code: 'D-1', name: 'Familia Doble', seats: 4, people: FOUR });
    const body = rsvpBody([inv.people[0].id, inv.people[2].id]);
    const first = await request(app).put(`/api/invitations/${inv.token}/rsvp`).send(body);
    const again = await request(app).put(`/api/invitations/${inv.token}/rsvp`).send(body);
    expect(first.body.outcome).toBe('saved');
    expect(again.status).toBe(200);
    expect(again.body.outcome).toBe('replay');
    expect(again.body.invitation.revision).toBe(1);

    const other = await createInv(admin, { code: 'D-2', name: 'Familia Paralela', seats: 4, people: FOUR });
    const same = rsvpBody([other.people[1].id]);
    const results = await Promise.all(Array.from({ length: 12 }, () => request(app).put(`/api/invitations/${other.token}/rsvp`).send(same)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(countResponses(db, other.id)).toBe(1);
    expect(historyCount(db, other.id)).toBe(1);
    expect((db.prepare('SELECT revision FROM responses WHERE invitation_id = ?').get(other.id) as { revision: number }).revision).toBe(1);
  });

  it('dos personas con el mismo enlace: la segunda recibe conflicto con la respuesta vigente, sin sobrescribir', async () => {
    const { app } = makeApp();
    const admin = await adminAgent(app);
    const inv = await createInv(admin, { code: 'C-1', name: 'Familia Conflicto', seats: 4, people: FOUR });
    const url = `/api/invitations/${inv.token}/rsvp`;
    // Ambas abrieron la invitación con revisión 0.
    const one = await request(app).put(url).send(rsvpBody([inv.people[0].id], { expectedRevision: 0 }));
    expect(one.status).toBe(200);
    const two = await request(app).put(url).send(rsvpBody([], { status: 'declined', expectedRevision: 0 }));
    expect(two.status).toBe(409);
    expect(two.body.error).toBe('conflict');
    expect(two.body.current).toMatchObject({ revision: 1, response: { status: 'attending', personIds: [inv.people[0].id] } });
    // Tras revisar la vigente, puede guardar a propósito con la revisión actual.
    const retry = await request(app).put(url).send(rsvpBody([], { status: 'declined', expectedRevision: 1 }));
    expect(retry.status).toBe(200);
    expect(retry.body.invitation).toMatchObject({ revision: 2, response: { status: 'declined', attending: 0 } });
  });

  it('si el administrador borra la respuesta, un dispositivo atrasado recibe conflicto en vez de sobrescribir', async () => {
    const { app } = makeApp();
    const admin = await adminAgent(app);
    const inv = await createInv(admin, { code: 'C-2', name: 'Familia Borrado', seats: 2, people: ['Uno Borrado', 'Dos Borrado'] });
    const url = `/api/invitations/${inv.token}/rsvp`;
    await request(app).put(url).send(rsvpBody([inv.people[0].id])).expect(200); // A guardó (revisión 1)
    expect((await admin.delete(`/api/admin/invitations/${inv.id}/response`)).body).toMatchObject({ attendance: 'pending', revision: 2 });
    const view = (await request(app).get(`/api/invitations/${inv.token}`)).body;
    expect(view).toMatchObject({ revision: 2, response: null });
    const b = await request(app).put(url).send(rsvpBody([inv.people[1].id], { expectedRevision: 2 })); // B partió de lo vigente
    expect(b.body.invitation).toMatchObject({ revision: 3 });
    const stale = await request(app).put(url).send(rsvpBody([], { expectedRevision: 1 })); // A con su vista vieja
    expect(stale.status).toBe(409);
    expect(stale.body.current.response.personIds).toEqual([inv.people[1].id]);
  });

  it('un enlace revocado deja de funcionar; uno regenerado sí funciona', async () => {
    const { app } = makeApp();
    const admin = await adminAgent(app);
    const inv = await createInv(admin, { code: 'R-1', name: 'Familia Revocada', seats: 2, people: ['Uno', 'Dos'] });
    await admin.post(`/api/admin/invitations/${inv.id}/revoke-link`).expect(200);
    expect((await request(app).get(`/api/invitations/${inv.token}`)).status).toBe(404);
    expect((await request(app).put(`/api/invitations/${inv.token}/rsvp`).send(rsvpBody([inv.people[0].id]))).status).toBe(404);
    const row = (await admin.get(`/api/admin/invitations/${inv.id}`)).body;
    expect(row).toMatchObject({ linkRevoked: true, link: null });
    const fresh = (await admin.post(`/api/admin/invitations/${inv.id}/regenerate-link`)).body;
    expect(fresh.token).not.toBe(inv.token);
    expect((await request(app).get(`/api/invitations/${fresh.token}`)).status).toBe(200);
    expect((await request(app).get(`/api/invitations/${inv.token}`)).status).toBe(404);
  });

  it('un error de almacenamiento responde con error y nunca con éxito', async () => {
    const dbPath = tempDbPath('falla');
    const db = openDb(dbPath);
    const failing: GuestStore = {
      mode: 'demo',
      uiMode: 'demo',
      getInvitation: async () => {
        throw new Error('disco lleno');
      },
      saveResponse: async () => {
        throw new HttpError(503, 'storage_unavailable', 'No pudimos guardar tu respuesta en este momento. No se registró; inténtalo de nuevo.');
      },
      status: async () => ({ mode: 'demo', ready: false, detail: 'falla simulada', canManageList: true }),
    };
    const app = createApp(db, testConfig(dbPath), { store: failing });
    const put = await request(app).put('/api/invitations/demo_AAAAAAAAAAAAAAAAAAAAAAAA/rsvp').send(rsvpBody(['X-P1']));
    expect(put.status).toBe(503);
    expect(put.body).toEqual({ error: 'storage_unavailable', message: expect.stringMatching(/No se registró/) });
    const get = await request(app).get('/api/invitations/demo_AAAAAAAAAAAAAAAAAAAAAAAA');
    expect(get.status).toBe(500);
    expect(get.body.error).toBe('server_error');
    expect(JSON.stringify(get.body)).not.toMatch(/disco/);
    db.close();
  });

  it('una falla de SQLite a media transacción no deja respuesta ni historial', async () => {
    const { app, db } = makeApp();
    const admin = await adminAgent(app);
    const inv = await createInv(admin, { code: 'T-1', name: 'Familia Transacción', seats: 2, people: ['Uno', 'Dos'] });
    // El historial falla: la transacción completa se revierte.
    db.exec(`CREATE TRIGGER falla BEFORE INSERT ON response_history BEGIN SELECT RAISE(ABORT, 'falla simulada'); END;`);
    const put = await request(app).put(`/api/invitations/${inv.token}/rsvp`).send(rsvpBody([inv.people[0].id]));
    expect(put.status).toBe(500);
    expect(countResponses(db, inv.id)).toBe(0);
    db.exec('DROP TRIGGER falla');
    const ok = await request(app).put(`/api/invitations/${inv.token}/rsvp`).send(rsvpBody([inv.people[0].id]));
    expect(ok.status).toBe(200);
  });

  it('cerrar confirmaciones conserva la respuesta y bloquea cambios', async () => {
    const { app } = makeApp();
    const admin = await adminAgent(app);
    const inv = await createInv(admin, { code: 'K-1', name: 'Familia Cierre', seats: 2, people: ['Uno', 'Dos'] });
    const url = `/api/invitations/${inv.token}/rsvp`;
    await request(app).put(url).send(rsvpBody([inv.people[0].id])).expect(200);
    await admin.put('/api/admin/settings').send({ rsvpOpen: false }).expect(200);
    const closed = await request(app).put(url).send(rsvpBody([inv.people[1].id], { expectedRevision: 1 }));
    expect(closed.status).toBe(409);
    expect(closed.body.error).toBe('rsvp_closed');
    const get = (await request(app).get(`/api/invitations/${inv.token}`)).body;
    expect(get).toMatchObject({ canRespond: false, closedReason: 'rsvp_closed', response: { personIds: [inv.people[0].id] } });
  });

  it('sin cupo o sin personas la invitación no puede confirmar', async () => {
    const { app } = makeApp();
    const admin = await adminAgent(app);
    const noSeats = await createInv(admin, { code: 'S-1', name: 'Sin cupo', seats: null, people: ['Uno'] });
    const noPeople = await createInv(admin, { code: 'S-2', name: 'Sin personas', seats: 2 });
    expect((await request(app).get(`/api/invitations/${noSeats.token}`)).body).toMatchObject({ canRespond: false, closedReason: 'seats_unassigned' });
    expect((await request(app).get(`/api/invitations/${noPeople.token}`)).body).toMatchObject({ canRespond: false, closedReason: 'no_people', people: [] });
    expect((await request(app).put(`/api/invitations/${noSeats.token}/rsvp`).send(rsvpBody([noSeats.people[0].id]))).status).toBe(409);
  });

  it('el administrador no puede bajar el cupo ni desactivar a quien ya confirmó', async () => {
    const { app } = makeApp();
    const admin = await adminAgent(app);
    const inv = await createInv(admin, { code: 'G-1', name: 'Familia Guardia', seats: 4, people: FOUR });
    await request(app).put(`/api/invitations/${inv.token}/rsvp`).send(rsvpBody(inv.people.slice(0, 3).map((p) => p.id))).expect(200);
    const lower = await admin.put(`/api/admin/invitations/${inv.id}`).send({ seats: 2 });
    expect(lower.status).toBe(409);
    const people = inv.people.map((p, i) => ({ id: p.id, name: p.name, active: i !== 0 }));
    const deactivate = await admin.put(`/api/admin/invitations/${inv.id}`).send({ seats: 4, people });
    expect(deactivate.status).toBe(409);
    expect(deactivate.body.error).toBe('person_in_response');
    const drop = await admin.put(`/api/admin/invitations/${inv.id}`).send({ seats: 4, people: people.slice(1) });
    expect(drop.body.error).toBe('people_missing');
    const rename = await admin.put(`/api/admin/invitations/${inv.id}`).send({ code: 'OTRO' });
    expect(rename.body.error).toBe('code_immutable');
    // Una persona nueva recibe un ID estable propio.
    const add = await admin.put(`/api/admin/invitations/${inv.id}`).send({ seats: 4, people: [...inv.people, { name: 'Quinta Persona' }] });
    expect(add.status).toBe(200);
    expect(add.body.people.at(-1)).toMatchObject({ id: 'G-1-P5', name: 'Quinta Persona', active: true });
  });

  it('la respuesta persiste al cerrar y reabrir la base, y dos conexiones al mismo archivo no duplican', async () => {
    const dbPath = tempDbPath('persist');
    const first = makeApp(dbPath);
    const admin = await adminAgent(first.app);
    const inv = await createInv(admin, { code: 'P-1', name: 'Familia Persistente', seats: 2, people: ['Uno', 'Dos'] });
    const db2 = openDb(dbPath);
    const app2 = createApp(db2, testConfig(dbPath));
    const body = rsvpBody([inv.people[0].id, inv.people[1].id]);
    await Promise.all([request(first.app).put(`/api/invitations/${inv.token}/rsvp`).send(body), request(app2).put(`/api/invitations/${inv.token}/rsvp`).send({ ...body, requestId: reqId() })]);
    expect(countResponses(first.db, inv.id)).toBe(1);
    first.db.close();
    db2.close();
    const again = makeApp(dbPath);
    expect((await request(again.app).get(`/api/invitations/${inv.token}`)).body.response).toMatchObject({ attending: 2 });
    again.db.close();
  });
});
