import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { adminAgent, createInv, makeApp, rsvpBody } from './helpers.js';

describe('aislamiento entre invitaciones', () => {
  it('la familia A no ve ni modifica personas o respuestas de la familia B', async () => {
    const { app } = makeApp();
    const admin = await adminAgent(app);
    const a = await createInv(admin, { code: 'A', name: 'Familia A', seats: 2, phone: '3311112222', notes: 'nota privada', contact: 'Contacto A', side: 'novia', people: ['Ana A', 'Beto A'] });
    const b = await createInv(admin, { code: 'B', name: 'Familia B', seats: 5, people: ['Carla B', 'Dani B'] });
    await request(app).put(`/api/invitations/${b.token}/rsvp`).send(rsvpBody([b.people[0].id])).expect(200);

    const aView = (await request(app).get(`/api/invitations/${a.token}`)).body;
    expect(Object.keys(aView).sort()).toEqual(['canRespond', 'closedReason', 'mode', 'name', 'people', 'response', 'revision', 'seats']);
    expect(aView.people).toEqual(a.people.map((p) => ({ id: p.id, name: p.name })));
    expect(aView.response).toBeNull();
    // Sin teléfono, notas, lado, contacto, token ni nada de la familia B.
    expect(JSON.stringify(aView)).not.toMatch(/3311112222|nota privada|Contacto A|novia|token|Carla|Dani|demo_/);

    // Con el token de A no se puede usar a personas de B ni escribir en B.
    const cross = await request(app).put(`/api/invitations/${a.token}/rsvp`).send(rsvpBody([b.people[1].id]));
    expect(cross.status).toBe(400);
    const extra = await request(app).put(`/api/invitations/${a.token}/rsvp`).send({ ...rsvpBody([a.people[0].id]), invitationId: b.id, token: b.token });
    expect(extra.status).toBe(400);
    expect(extra.body.error).toBe('forbidden_fields');
    const bAfter = (await request(app).get(`/api/invitations/${b.token}`)).body;
    expect(bAfter.response).toMatchObject({ personIds: [b.people[0].id], attending: 1 });
    expect(bAfter.revision).toBe(1);
  });

  it('los enlaces de demostración son opacos, únicos y llevan el prefijo demo_', async () => {
    const { app } = makeApp();
    const admin = await adminAgent(app);
    const tokens = new Set<string>();
    for (let i = 0; i < 20; i++) tokens.add((await createInv(admin, { code: `X-${i}`, name: `Familia ${i}`, seats: 1 })).token);
    expect(tokens.size).toBe(20);
    for (const t of tokens) expect(t).toMatch(/^demo_[A-Za-z0-9_-]{24}$/);
    // Un token con formato de enlace real nunca se busca en la demostración.
    expect((await request(app).get(`/api/invitations/${[...tokens][0].slice(5)}`)).status).toBe(404);
  });
});

describe('administración', () => {
  const protectedRoutes: [string, string][] = [
    ['get', '/api/admin/backend'],
    ['get', '/api/admin/summary'],
    ['get', '/api/admin/invitations'],
    ['post', '/api/admin/invitations'],
    ['get', '/api/admin/invitations/1'],
    ['put', '/api/admin/invitations/1'],
    ['delete', '/api/admin/invitations/1'],
    ['post', '/api/admin/invitations/1/regenerate-link'],
    ['post', '/api/admin/invitations/1/revoke-link'],
    ['put', '/api/admin/invitations/1/response'],
    ['delete', '/api/admin/invitations/1/response'],
    ['put', '/api/admin/settings'],
    ['get', '/api/admin/templates/invitaciones.csv'],
    ['get', '/api/admin/export/invitaciones.csv'],
    ['post', '/api/admin/import/preview'],
    ['post', '/api/admin/import/apply'],
    ['get', '/api/admin/messaging'],
    ['get', '/api/admin/invitations/1/message'],
    ['post', '/api/admin/invitations/1/message/prepare'],
    ['post', '/api/admin/invitations/1/message/manual'],
    ['get', '/api/admin/messages.csv'],
    ['get', '/api/admin/backup'],
  ];

  it('toda la API administrativa es inaccesible sin autenticación', async () => {
    const { app } = makeApp();
    for (const [method, url] of protectedRoutes) {
      const res = await (request(app) as unknown as Record<string, (u: string) => request.Test>)[method](url).send({});
      expect(res.status, `${method.toUpperCase()} ${url}`).toBe(401);
    }
    const forged = await request(app).get('/api/admin/summary').set('Cookie', 'bt_admin=inventado');
    expect(forged.status).toBe(401);
  });

  it('rechaza contraseña incorrecta y cierra la sesión en servidor', async () => {
    const { app } = makeApp();
    expect((await request(app).post('/api/admin/login').send({ password: 'mala' })).status).toBe(401);
    const login = await request(app).post('/api/admin/login').send({ password: 'contraseña-de-prueba-123' });
    const cookie = login.headers['set-cookie'] as unknown as string[];
    expect(cookie[0]).toMatch(/HttpOnly/);
    expect(cookie[0]).toMatch(/SameSite=Strict/);
    await request(app).get('/api/admin/summary').set('Cookie', cookie).expect(200);
    await request(app).post('/api/admin/logout').set('Cookie', cookie).expect(200);
    await request(app).get('/api/admin/summary').set('Cookie', cookie).expect(401);
  });

  it('bloquea peticiones de escritura desde otro origen', async () => {
    const { app } = makeApp();
    const admin = await adminAgent(app);
    const inv = await createInv(admin, { code: 'O', name: 'Familia Origen', seats: 1, people: ['Uno'] });
    const res = await request(app).put(`/api/invitations/${inv.token}/rsvp`).set('Origin', 'https://malicioso.example').send(rsvpBody([inv.people[0].id]));
    expect(res.status).toBe(403);
  });

  it('busca por grupo, persona o teléfono y filtra por estado', async () => {
    const { app } = makeApp();
    const admin = await adminAgent(app);
    const a = await createInv(admin, { code: 'F-1', name: 'Familia Hernández', seats: 2, phone: '33 1234 5678', people: ['Rosa Hernández'] });
    await createInv(admin, { code: 'F-2', name: 'Familia López', seats: 3, people: ['Mario López'] });
    await createInv(admin, { code: 'F-3', name: 'Familia Sin Asignar', seats: null, people: ['Nadie Aún'] });
    await request(app).put(`/api/invitations/${a.token}/rsvp`).send(rsvpBody([a.people[0].id])).expect(200);
    const names = async (qs: string) => ((await admin.get(`/api/admin/invitations?${qs}`)).body as { name: string }[]).map((r) => r.name);
    expect(await names('q=hernández')).toEqual(['Familia Hernández']);
    expect(await names('q=mario')).toEqual(['Familia López']);
    expect(await names('q=1234')).toEqual(['Familia Hernández']);
    expect(await names('status=attending')).toEqual(['Familia Hernández']);
    expect(await names('status=pending')).toEqual(['Familia López', 'Familia Sin Asignar']);
    expect(await names('status=incomplete')).toEqual(['Familia Sin Asignar']);
    const list = (await admin.get('/api/admin/invitations')).body as { link: string; phone: string }[];
    expect(list[0].link).toMatch(/^https:\/\/boda\.example\/i\/demo_[A-Za-z0-9_-]{24}$/);
    expect(list.find((r) => r.phone)?.phone).toBe('523312345678');
  });

  it('registra por el panel una respuesta recibida por otro medio con las mismas reglas', async () => {
    const { app } = makeApp();
    const admin = await adminAgent(app);
    const inv = await createInv(admin, { code: 'M-1', name: 'Familia Teléfono', seats: 1, people: ['Uno', 'Dos'] });
    const over = await admin.put(`/api/admin/invitations/${inv.id}/response`).send({ status: 'attending', personIds: inv.people.map((p) => p.id) });
    expect(over.body.error).toBe('over_capacity');
    const ok = await admin.put(`/api/admin/invitations/${inv.id}/response`).send({ status: 'attending', personIds: [inv.people[1].id] });
    expect(ok.body).toMatchObject({ attendance: 'attending', attendingCount: 1, responseSource: 'admin' });
    const cleared = await admin.delete(`/api/admin/invitations/${inv.id}/response`);
    expect(cleared.body.attendance).toBe('pending');
  });

  it('el mensaje preparado no se ofrece con un enlace revocado', async () => {
    const { app } = makeApp();
    const admin = await adminAgent(app);
    const inv = await createInv(admin, { code: 'W-1', name: 'Familia Mensaje', seats: 2, people: ['Uno'] });
    expect((await admin.get(`/api/admin/invitations/${inv.id}/message`)).body.text).toContain(inv.link);
    await admin.post(`/api/admin/invitations/${inv.id}/revoke-link`).expect(200);
    expect((await admin.get(`/api/admin/invitations/${inv.id}/message`)).status).toBe(409);
    expect((await admin.get('/api/admin/messages.csv')).text).not.toContain(inv.token);
  });
});
