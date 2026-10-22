import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { adminAgent, createInv, makeApp } from './helpers.js';

describe('aislamiento entre invitaciones', () => {
  it('(7) cada enlace solo consulta y modifica su propia invitación', async () => {
    const { app } = makeApp();
    const admin = await adminAgent(app);
    const a = await createInv(admin, { code: 'A', name: 'Familia A', seats: 2, phone: '3311112222', notes: 'nota privada' });
    const b = await createInv(admin, { code: 'B', name: 'Familia B', seats: 5 });
    await request(app).put(`/api/invitations/${a.token}/rsvp`).send({ status: 'attending', adults: 2 }).expect(200);

    const bView = await request(app).get(`/api/invitations/${b.token}`);
    expect(bView.body).toEqual({ name: 'Familia B', seats: 5, canRespond: true, closedReason: null, response: null });

    // La vista pública no expone teléfono, notas, identificador ni token.
    const aView = await request(app).get(`/api/invitations/${a.token}`);
    expect(Object.keys(aView.body).sort()).toEqual(['canRespond', 'closedReason', 'name', 'response', 'seats']);
    expect(JSON.stringify(aView.body)).not.toMatch(/3311112222|nota privada|"A"|token/);

    // El límite aplicado es el de la invitación del token, no el de otra.
    const over = await request(app).put(`/api/invitations/${a.token}/rsvp`).send({ status: 'attending', adults: 5 });
    expect(over.status).toBe(400);
    // Campos extra en el cuerpo no permiten tocar otra invitación.
    await request(app).put(`/api/invitations/${b.token}/rsvp`).send({ status: 'declined', adults: 0, invitationId: a.id, token: a.token }).expect(200);
    const aAfter = await request(app).get(`/api/invitations/${a.token}`);
    expect(aAfter.body.response).toMatchObject({ status: 'attending', adults: 2 });
  });

  it('los tokens son opacos e impredecibles', async () => {
    const { app } = makeApp();
    const admin = await adminAgent(app);
    const tokens = new Set<string>();
    for (let i = 0; i < 20; i++) tokens.add((await createInv(admin, { code: `X-${i}`, name: `Familia ${i}`, seats: 1 })).token);
    expect(tokens.size).toBe(20);
    for (const t of tokens) expect(t).toMatch(/^[A-Za-z0-9_-]{24}$/);
  });
});

describe('administración', () => {
  const protectedRoutes: [string, string][] = [
    ['get', '/api/admin/summary'],
    ['get', '/api/admin/invitations'],
    ['post', '/api/admin/invitations'],
    ['get', '/api/admin/invitations/1'],
    ['put', '/api/admin/invitations/1'],
    ['delete', '/api/admin/invitations/1'],
    ['post', '/api/admin/invitations/1/regenerate-link'],
    ['put', '/api/admin/invitations/1/response'],
    ['delete', '/api/admin/invitations/1/response'],
    ['put', '/api/admin/settings'],
    ['get', '/api/admin/template.csv'],
    ['get', '/api/admin/export.csv'],
    ['post', '/api/admin/import/preview'],
    ['post', '/api/admin/import/apply'],
    ['get', '/api/admin/messaging'],
    ['get', '/api/admin/invitations/1/message'],
    ['post', '/api/admin/invitations/1/message/prepare'],
    ['post', '/api/admin/invitations/1/message/manual'],
    ['get', '/api/admin/messages.csv'],
    ['get', '/api/admin/backup'],
  ];

  it('(8) toda la API administrativa es inaccesible sin autenticación', async () => {
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
    const inv = await createInv(admin, { code: 'O', name: 'Familia Origen', seats: 1 });
    const res = await request(app).put(`/api/invitations/${inv.token}/rsvp`).set('Origin', 'https://malicioso.example').send({ status: 'attending', adults: 1 });
    expect(res.status).toBe(403);
  });

  it('busca y filtra por estado de asistencia', async () => {
    const { app } = makeApp();
    const admin = await adminAgent(app);
    const a = await createInv(admin, { code: 'F-1', name: 'Familia Hernández', seats: 2, phone: '33 1234 5678' });
    await createInv(admin, { code: 'F-2', name: 'Familia López', seats: 3 });
    await createInv(admin, { code: 'F-3', name: 'Familia Sin Asignar', seats: null });
    await request(app).put(`/api/invitations/${a.token}/rsvp`).send({ status: 'attending', adults: 2 });
    const names = async (qs: string) => ((await admin.get(`/api/admin/invitations?${qs}`)).body as { name: string }[]).map((r) => r.name);
    expect(await names('q=hernández')).toEqual(['Familia Hernández']);
    expect(await names('q=1234')).toEqual(['Familia Hernández']);
    expect(await names('status=attending')).toEqual(['Familia Hernández']);
    expect(await names('status=pending')).toEqual(['Familia López', 'Familia Sin Asignar']);
    expect(await names('status=incomplete')).toEqual(['Familia Sin Asignar']);
    const list = (await admin.get('/api/admin/invitations')).body as { link: string; phone: string }[];
    expect(list[0].link).toMatch(/^https:\/\/boda\.example\/i\/[A-Za-z0-9_-]{24}$/);
    expect(list.find((r) => r.phone)?.phone).toBe('523312345678');
  });

  it('separa los datos de demostración de los reales', async () => {
    const { app } = makeApp();
    const admin = await adminAgent(app);
    await createInv(admin, { code: 'R-1', name: 'Familia Real', seats: 2 });
    await createInv(admin, { code: 'DEMO-1', name: 'Familia Demo', seats: 2, isDemo: true });
    expect((await admin.get('/api/admin/invitations')).body).toHaveLength(1);
    expect((await admin.get('/api/admin/invitations?demo=include')).body).toHaveLength(2);
    expect((await admin.get('/api/admin/summary')).body.invitations).toBe(1);
    expect((await admin.get('/api/admin/export.csv')).text).not.toMatch(/Familia Demo/);
  });

  it('regenerar el enlace invalida el anterior', async () => {
    const { app } = makeApp();
    const admin = await adminAgent(app);
    const inv = await createInv(admin, { code: 'G', name: 'Familia Enlace', seats: 1 });
    const res = await admin.post(`/api/admin/invitations/${inv.id}/regenerate-link`).expect(200);
    expect(res.body.token).not.toBe(inv.token);
    expect((await request(app).get(`/api/invitations/${inv.token}`)).status).toBe(404);
    expect((await request(app).get(`/api/invitations/${res.body.token}`)).status).toBe(200);
  });
});
