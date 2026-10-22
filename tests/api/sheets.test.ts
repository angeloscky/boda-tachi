import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../server/app.js';
import { CONNECTOR_VERSION, signingString } from '../../shared/rsvp-rules.js';
import { buildAppsScript } from '../../scripts/build-apps-script.js';
import { SECRET, TOKEN_A, TOKEN_B, WEBAPP_URL, createGas, fakeWebApp, sampleTabs } from './fake-gas.js';
import { adminAgent, rsvpBody, testConfig } from './helpers.js';

/** Servidor en modo Google Sheets hablando con el Code.gs real a través del doble. */
function sheetsApp(opts: { secret?: string; tamper?: (s: string) => string; mode?: 'ok' | 'login' | 'html'; tabs?: ReturnType<typeof sampleTabs> } = {}) {
  const gas = createGas(opts.tabs ?? sampleTabs());
  const web = fakeWebApp(gas, { tamper: opts.tamper, mode: opts.mode });
  const app = createApp(null, testConfig('/tmp/no.sqlite', { rsvpBackend: 'sheets', sheets: { url: WEBAPP_URL, secret: opts.secret ?? SECRET, timeoutMs: 2000 } }), {
    fetchImpl: web.fetchImpl,
  });
  const responses = () => gas.sheets.get('Respuestas')!.values.slice(1);
  return { app, gas, web, responses };
}

const signedRequest = (op: string, payload: unknown, over: Partial<{ ts: number; nonce: string; secret: string }> = {}) => {
  const ts = over.ts ?? Date.now();
  const nonce = over.nonce ?? crypto.randomBytes(16).toString('base64url');
  const payloadJson = JSON.stringify(payload);
  const sig = crypto.createHmac('sha256', over.secret ?? SECRET).update(signingString(['req', CONNECTOR_VERSION, op, ts, nonce, payloadJson])).digest('hex');
  return JSON.stringify({ v: CONNECTOR_VERSION, op, ts, nonce, payload: payloadJson, sig });
};

describe('conector de Google Sheets (Apps Script probado con dobles; sin conexión real)', () => {
  it('apps-script/Code.gs está generado con las reglas vigentes', async () => {
    const file = fs.readFileSync(path.resolve(__dirname, '../../apps-script/Code.gs'), 'utf8');
    expect(file, 'Ejecuta npm run sheets:build').toBe(await buildAppsScript());
    // Sin funciones genéricas de rango ni respuestas opacas.
    expect(file).not.toMatch(/no-cors/);
    expect(file).not.toMatch(/function\s+(getRange|setRange|readRange|writeRange|updateRange)\b/);
  });

  it('solo acepta solicitudes firmadas, recientes y no repetidas, y de operaciones conocidas', () => {
    const gas = createGas(sampleTabs());
    expect(gas.doPost('no es json')).toEqual({ ok: false, code: 'bad_request' });
    expect(gas.doPost(signedRequest('ping', {}, { secret: 'otro-secreto-de-al-menos-32-caracteres!!' }))).toEqual({ ok: false, code: 'unauthorized' });
    expect(gas.doPost(signedRequest('ping', {}, { ts: Date.now() - 10 * 60_000 }))).toEqual({ ok: false, code: 'unauthorized' });
    const once = signedRequest('ping', {});
    expect(gas.doPost(once).sig).toBeTypeOf('string');
    expect(gas.doPost(once)).toEqual({ ok: false, code: 'unauthorized' }); // nonce repetido
    const body = JSON.parse(signedRequest('ping', {}));
    expect(gas.doPost(JSON.stringify({ ...body, op: 'setValues' }))).toEqual({ ok: false, code: 'bad_request' });
    const noSecret = createGas(sampleTabs(), { secret: null });
    expect(noSecret.doPost(signedRequest('ping', {}))).toEqual({ ok: false, code: 'not_configured' });
  });

  it('la familia A solo recibe sus personas activas, sin teléfono ni notas, y no ve a B', async () => {
    const { app } = sheetsApp();
    const res = await request(app).get(`/api/invitations/${TOKEN_A}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'Familia Ejemplo A', seats: 4, mode: 'live', revision: 0, response: null, canRespond: true });
    expect(res.body.people.map((p: { id: string }) => p.id)).toEqual(['INV-001-P1', 'INV-001-P2', 'INV-001-P3', 'INV-001-P4']);
    expect(JSON.stringify(res.body)).not.toMatch(/5233|nota privada|Contacto|novia|INV-002|Carla/);
    const b = (await request(app).get(`/api/invitations/${TOKEN_B}`)).body;
    expect(b.people).toEqual([{ id: 'INV-002-P1', name: 'Carla Ejemplo' }]); // Dani está inactiva
  });

  it('guarda 2 de 4 personas en Respuestas, con el cupo intacto, y un reenvío no duplica', async () => {
    const { app, gas, responses } = sheetsApp();
    const body = rsvpBody(['INV-001-P3', 'INV-001-P1']);
    const put = await request(app).put(`/api/invitations/${TOKEN_A}/rsvp`).send(body);
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ outcome: 'saved', invitation: { seats: 4, revision: 1, response: { attending: 2, personIds: ['INV-001-P1', 'INV-001-P3'] } } });
    expect(responses()).toEqual([['INV-001', 'INV-001-P1, INV-001-P3', 'asistirá', '1', expect.stringMatching(/-06:00$/), body.requestId]]);
    expect(gas.sheets.get('Invitaciones')!.values[1][5]).toBe(4);
    const again = await request(app).put(`/api/invitations/${TOKEN_A}/rsvp`).send(body);
    expect(again.body.outcome).toBe('replay');
    expect(responses()).toHaveLength(1);
  });

  it('valida en el script: personas de otra familia, inactivas, cupo y conflicto de revisión', async () => {
    const { app, responses } = sheetsApp();
    const url = `/api/invitations/${TOKEN_B}/rsvp`;
    expect((await request(app).put(url).send(rsvpBody(['INV-001-P1']))).body.error).toBe('unknown_person');
    expect((await request(app).put(url).send(rsvpBody(['INV-002-P2']))).body.error).toBe('inactive_person');
    expect((await request(app).put(`/api/invitations/${TOKEN_A}/rsvp`).send({ ...rsvpBody(['INV-001-P1']), seats: 9 })).body.error).toBe('forbidden_fields');
    expect(responses()).toHaveLength(0);
    await request(app).put(url).send(rsvpBody(['INV-002-P1'])).expect(200);
    const stale = await request(app).put(url).send(rsvpBody([], { status: 'declined', expectedRevision: 0 }));
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ error: 'conflict', current: { revision: 1, mode: 'live', response: { personIds: ['INV-002-P1'] } } });
    expect(responses()[0][2]).toBe('asistirá'); // no se sobrescribió
  });

  it('bloqueo ocupado o escritura fallida: error reintentable y nunca éxito', async () => {
    const { app, gas, responses } = sheetsApp();
    gas.lock.busy = true;
    const busy = await request(app).put(`/api/invitations/${TOKEN_A}/rsvp`).send(rsvpBody(['INV-001-P1']));
    expect(busy.status).toBe(503);
    expect(busy.body.error).toBe('storage_unavailable');
    gas.lock.busy = false;
    gas.sheets.get('Respuestas')!.failWrites = true;
    expect((await request(app).put(`/api/invitations/${TOKEN_A}/rsvp`).send(rsvpBody(['INV-001-P1']))).status).toBe(503);
    gas.sheets.get('Respuestas')!.failWrites = false;
    // Una escritura que "no falla" pero no queda en la hoja tampoco cuenta como guardada.
    gas.sheets.get('Respuestas')!.dropWrites = true;
    expect((await request(app).put(`/api/invitations/${TOKEN_A}/rsvp`).send(rsvpBody(['INV-001-P1']))).status).toBe(503);
    expect(responses()).toHaveLength(0);
  });

  it('una respuesta alterada o no verificable no se toma como guardada; el reintento con la misma solicitud sí', async () => {
    let tamper = true;
    const { app, responses } = sheetsApp({ tamper: (s) => (tamper ? s.replace('"saved"', '\\"saved\\"').replace(/"sig":"[0-9a-f]{4}/, '"sig":"0000') : s) });
    const body = rsvpBody(['INV-001-P2']);
    const first = await request(app).put(`/api/invitations/${TOKEN_A}/rsvp`).send(body);
    expect(first.status).toBe(503);
    expect(responses()).toHaveLength(1); // el script sí escribió, pero el servidor no lo pudo verificar
    tamper = false;
    const retry = await request(app).put(`/api/invitations/${TOKEN_A}/rsvp`).send(body);
    expect(retry.status).toBe(200);
    expect(retry.body.outcome).toBe('replay');
    expect(responses()).toHaveLength(1);
  });

  it('secreto distinto, página de inicio de sesión o HTML: no conectado y sin éxito ficticio', async () => {
    for (const opts of [{ secret: 'otro-secreto-de-al-menos-32-caracteres!!' }, { mode: 'login' as const }, { mode: 'html' as const }]) {
      const { app, responses } = sheetsApp(opts);
      expect((await request(app).get(`/api/invitations/${TOKEN_A}`)).status, JSON.stringify(opts)).toBe(503);
      expect((await request(app).put(`/api/invitations/${TOKEN_A}/rsvp`).send(rsvpBody(['INV-001-P1']))).status).toBe(503);
      expect(responses()).toHaveLength(0);
      const admin = await adminAgent(app);
      expect((await admin.get('/api/admin/backend')).body).toMatchObject({ mode: 'sheets', ready: false });
    }
  });

  it('un enlace de demostración, revocado o repetido nunca llega a una invitación real', async () => {
    const tabs = sampleTabs();
    tabs.Invitaciones.push(['INV-003', '', 'Familia Duplicada', '', '', 1, 'sí', TOKEN_B, '', '']);
    const { app, web } = sheetsApp({ tabs });
    const before = web.calls.length;
    expect((await request(app).get('/api/invitations/demo_AAAAAAAAAAAAAAAAAAAAAAAA')).status).toBe(404);
    expect(web.calls.length).toBe(before); // ni siquiera se consulta a Google
    expect((await request(app).get(`/api/invitations/${TOKEN_B}`)).status).toBe(404); // token repetido: no se adivina
    tabs.Invitaciones[1][7] = ''; // revocado desde el menú
    expect((await request(app).get(`/api/invitations/${TOKEN_A}`)).status).toBe(404);
  });

  it('ordenar filas y mover columnas en la hoja no cambia identidades ni respuestas', async () => {
    const tabs = sampleTabs();
    const { app, gas, responses } = sheetsApp({ tabs });
    await request(app).put(`/api/invitations/${TOKEN_A}/rsvp`).send(rsvpBody(['INV-001-P2'])).expect(200);
    await request(app).put(`/api/invitations/${TOKEN_B}/rsvp`).send(rsvpBody(['INV-002-P1'])).expect(200);
    const before = (await request(app).get(`/api/invitations/${TOKEN_A}`)).body;
    // Ordenar: invertir filas de datos. Mover columnas: poner "nombre" antes que "id_persona".
    for (const name of ['Invitaciones', 'Personas', 'Respuestas']) {
      const sheet = gas.sheets.get(name)!;
      sheet.values = [sheet.values[0], ...sheet.values.slice(1).reverse()];
    }
    const people = gas.sheets.get('Personas')!;
    people.values = people.values.map((r) => [r[2], r[0], r[1], r[3]]);
    const after = (await request(app).get(`/api/invitations/${TOKEN_A}`)).body;
    expect(after).toEqual(before);
    const upd = await request(app).put(`/api/invitations/${TOKEN_A}/rsvp`).send(rsvpBody(['INV-001-P1', 'INV-001-P2'], { expectedRevision: 1 }));
    expect(upd.status).toBe(200);
    expect(responses()).toHaveLength(2);
    expect(responses().find((r) => r[0] === 'INV-001')![1]).toBe('INV-001-P1, INV-001-P2');
    expect(responses().find((r) => r[0] === 'INV-002')![1]).toBe('INV-002-P1');
  });

  it('confirmaciones cerradas en Config: se ve la respuesta, no se cambia', async () => {
    const tabs = sampleTabs();
    tabs.Config[0][1] = false;
    const { app } = sheetsApp({ tabs });
    expect((await request(app).get(`/api/invitations/${TOKEN_A}`)).body).toMatchObject({ canRespond: false, closedReason: 'rsvp_closed' });
    const put = await request(app).put(`/api/invitations/${TOKEN_A}/rsvp`).send(rsvpBody(['INV-001-P1']));
    expect(put.status).toBe(409);
    expect(put.body.error).toBe('rsvp_closed');
  });

  it('el panel muestra el estado de la conexión, los totales y la revisión de la lista', async () => {
    const tabs = sampleTabs();
    tabs.Invitaciones.push(['DEMO-001', '', 'Familia Demo Colada', '', '523300000001', 2, 'sí', '', '', '']);
    const { app } = sheetsApp({ tabs });
    await request(app).put(`/api/invitations/${TOKEN_A}/rsvp`).send(rsvpBody(['INV-001-P1', 'INV-001-P2'])).expect(200);
    const admin = await adminAgent(app);
    const status = (await admin.get('/api/admin/backend')).body;
    expect(status).toMatchObject({ mode: 'sheets', ready: true, canManageList: false, summary: { invitations: 3, attendingPeople: 2, seatsAssigned: 8, rsvpOpen: true } });
    const issues = status.issues.map((i: { id: string; message: string }) => `${i.id}: ${i.message}`).join('\n');
    expect(issues).toMatch(/DEMO-001: Este ID es de demostración/);
    expect(issues).toMatch(/Mismo teléfono que INV-001/);
    expect((await admin.get('/api/admin/invitations')).status).toBe(409); // la lista se administra en la hoja
  });
});
