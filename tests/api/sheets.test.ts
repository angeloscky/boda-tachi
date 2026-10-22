import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../server/app.js';
import { CONNECTOR_VERSION, signingString } from '../../shared/rsvp-rules.js';
import { buildAppsScript } from '../../scripts/build-apps-script.js';
import { SECRET, SHEET_ID, TOKEN_A, TOKEN_B, WEBAPP_URL, createGas, fakeWebApp, sampleTabs } from './fake-gas.js';

const TOKEN_C = 'tokenFamiliaC_5555555555';
import { adminAgent, rsvpBody, testConfig } from './helpers.js';

/** Servidor en modo Google Sheets hablando con el Code.gs real a través del doble. */
function sheetsApp(opts: { secret?: string; tamper?: (s: string) => string; mode?: 'ok' | 'login' | 'html'; tabs?: ReturnType<typeof sampleTabs>; registered?: boolean } = {}) {
  const gas = createGas(opts.tabs ?? sampleTabs(), { registered: opts.registered });
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

  it('como aplicación web (sin hoja activa) abre solo la hoja registrada; la solicitud no puede elegir otro archivo', async () => {
    const { app, gas, responses } = sheetsApp();
    expect((gas.ctx.SpreadsheetApp as { getActiveSpreadsheet: () => unknown }).getActiveSpreadsheet()).toBeNull();
    expect((await request(app).get(`/api/invitations/${TOKEN_A}`)).status).toBe(200);
    expect((await request(app).put(`/api/invitations/${TOKEN_A}/rsvp`).send(rsvpBody(['INV-001-P1']))).status).toBe(200);
    expect(responses()).toHaveLength(1);
    const admin = await adminAgent(app);
    expect((await admin.get('/api/admin/backend')).body).toMatchObject({ mode: 'sheets', ready: true });
    // Campos de más en la solicitud (otro archivo, un rango) se ignoran: el ID solo sale de las propiedades.
    const ping = gas.doPost(signedRequest('ping', { spreadsheetId: 'OtraHojaAjena_0123456789abcdef', range: 'A1:Z999' }));
    expect(JSON.parse(ping.data)).toMatchObject({ ok: true });
    const get = gas.doPost(signedRequest('getInvitation', { token: TOKEN_A, spreadsheetId: 'OtraHojaAjena_0123456789abcdef' }));
    expect(JSON.parse(get.data)).toMatchObject({ ok: true, result: { invitation: { group: 'Familia Ejemplo A' } } });
    expect(new Set(gas.state.opened)).toEqual(new Set([SHEET_ID]));
  });

  it('sin hoja registrada o con la hoja inaccesible: error claro, el panel no dice "conectado" y nada se guarda', async () => {
    for (const variant of ['sin registrar', 'inaccesible'] as const) {
      const { app, gas, responses } = sheetsApp({ registered: variant === 'inaccesible' });
      if (variant === 'inaccesible') gas.state.accessible = false;
      const code = variant === 'inaccesible' ? 'sheet_unavailable' : 'sheet_not_configured';
      expect(JSON.parse(gas.doPost(signedRequest('ping', {})).data)).toMatchObject({ ok: false, status: 503, code });
      const get = await request(app).get(`/api/invitations/${TOKEN_A}`);
      expect(get.status, variant).toBe(503);
      expect(get.body.error).toBe('storage_unavailable');
      const put = await request(app).put(`/api/invitations/${TOKEN_A}/rsvp`).send(rsvpBody(['INV-001-P1']));
      expect(put.status).toBe(503);
      expect(put.body.outcome).toBeUndefined();
      expect(responses()).toEqual([]);
      const admin = await adminAgent(app);
      const status = (await admin.get('/api/admin/backend')).body;
      expect(status).toMatchObject({ mode: 'sheets', ready: false });
      expect(status.detail).toMatch(variant === 'inaccesible' ? /No se pudo abrir la hoja registrada/ : /no tiene registrada la hoja/);
    }
  });

  it('ID registrado con espacios, con forma inválida, u openById que devuelve null', async () => {
    const withSpaces = sheetsApp();
    withSpaces.gas.props.BT_SPREADSHEET_ID = ` ${SHEET_ID} `;
    expect((await request(withSpaces.app).get(`/api/invitations/${TOKEN_A}`)).status).toBe(200);

    const pasted = sheetsApp();
    pasted.gas.props.BT_SPREADSHEET_ID = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`;
    expect(JSON.parse(pasted.gas.doPost(signedRequest('ping', {})).data)).toMatchObject({ ok: false, status: 503, code: 'sheet_not_configured', message: expect.stringMatching(/no es un ID de hoja válido/) });
    expect(pasted.gas.state.opened).toEqual([]);

    const nulled = sheetsApp();
    nulled.gas.state.returnsNull = true;
    for (const op of ['ping', 'summary'] as const) {
      expect(JSON.parse(nulled.gas.doPost(signedRequest(op, {})).data), op).toMatchObject({ ok: false, status: 503, code: 'sheet_unavailable' });
    }
    expect((await request(nulled.app).put(`/api/invitations/${TOKEN_A}/rsvp`).send(rsvpBody(['INV-001-P1']))).status).toBe(503);
    expect(nulled.responses()).toEqual([]);
  });

  it('"Preparar estructura" desde la hoja registra su ID y desde entonces la aplicación web la atiende', async () => {
    const { app, gas } = sheetsApp({ registered: false });
    expect((await request(app).get(`/api/invitations/${TOKEN_A}`)).status).toBe(503);
    gas.menu('btSetup');
    expect(gas.props.BT_SPREADSHEET_ID).toBe(SHEET_ID);
    expect((await request(app).get(`/api/invitations/${TOKEN_A}`)).status).toBe(200);
    // El menú no funciona fuera de la hoja (sin contexto activo): no registra nada por accidente.
    const outside = createGas(sampleTabs(), { registered: false });
    expect(() => outside.fn('btSetup')).toThrow();
    expect(outside.props.BT_SPREADSHEET_ID).toBeUndefined();
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
  });

  it('revocar desde el menú se respeta al generar enlaces; filas EJEMPLO/DEMO nunca reciben enlace ni se atienden', async () => {
    const tabs = sampleTabs();
    tabs.Invitaciones.push(['EJEMPLO-001', '', 'Familia Ejemplo Olvidada', '', '', 2, 'sí', TOKEN_C, '', '']);
    tabs.Invitaciones.push(['EJEMPLO-002', '', 'Otra fila de ejemplo', '', '', 2, 'sí', '', '', '']);
    tabs.Invitaciones.push(['INV-003', '', 'Familia Nueva', '', '', 2, 'sí', '', '', '']);
    const { app, gas } = sheetsApp({ tabs });
    expect((await request(app).get(`/api/invitations/${TOKEN_C}`)).status).toBe(404);
    const inv = () => gas.sheets.get('Invitaciones')!.values;
    expect(gas.fn('fillMissingTokens_', gas.ss)).toBe(1);
    expect(inv().find((r) => r[0] === 'INV-003')![7]).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(inv().find((r) => r[0] === 'EJEMPLO-002')![7]).toBe('');
    gas.fn('replaceToken_', gas.ss, 'INV-001', true);
    expect(inv()[1][7]).toBe('revocado');
    expect((await request(app).get(`/api/invitations/${TOKEN_A}`)).status).toBe(404);
    expect(gas.fn('fillMissingTokens_', gas.ss)).toBe(0); // no revive el enlace revocado
    expect(inv()[1][7]).toBe('revocado');
    const admin = await adminAgent(app);
    const issues = JSON.stringify((await admin.get('/api/admin/backend')).body.issues);
    expect(issues).toMatch(/Enlace revocado/);
  });

  it('ID de invitación repetido o persona compartida: no se atiende ni se escribe, se pide revisar', async () => {
    const tabs = sampleTabs();
    // Fila copiada de INV-001 sin cambiar el ID (en otras mayúsculas) y con su propio enlace.
    tabs.Invitaciones.push(['inv-001', '', 'Familia Copiada', '', '', 1, 'sí', TOKEN_C, '', '']);
    const { app, responses } = sheetsApp({ tabs });
    for (const token of [TOKEN_C, TOKEN_A]) {
      const get = await request(app).get(`/api/invitations/${token}`);
      expect(get.status, token).toBe(409);
      expect(get.body.error).toBe('needs_review');
      expect(JSON.stringify(get.body)).not.toMatch(/Ana Ejemplo|Familia Ejemplo A/);
      const put = await request(app).put(`/api/invitations/${token}/rsvp`).send(rsvpBody([]));
      expect(put.status).toBe(409);
    }
    expect(responses()).toEqual([]);
    expect((await request(app).get(`/api/invitations/${TOKEN_B}`)).status).toBe(200); // las demás siguen

    const shared = sampleTabs();
    shared.Personas.push(['INV-001-P1', 'INV-002', 'Persona en dos invitaciones', 'sí']);
    const other = sheetsApp({ tabs: shared });
    expect((await request(other.app).get(`/api/invitations/${TOKEN_A}`)).body.error).toBe('needs_review');
    expect((await request(other.app).get(`/api/invitations/${TOKEN_B}`)).body.error).toBe('needs_review');
  });

  it('"activa" no reconocida o una respuesta mal capturada a mano: se pide revisar y no cuenta en los totales', async () => {
    const tabs = sampleTabs();
    tabs.Personas[2][3] = 'baja'; // INV-001-P2
    tabs.Respuestas.push(['INV-002', 'INV-002-P1', 'sí', '1', '2027-01-15T19:20:00-06:00', 'a-mano-0001']);
    const { app } = sheetsApp({ tabs });
    for (const token of [TOKEN_A, TOKEN_B]) {
      const get = await request(app).get(`/api/invitations/${token}`);
      expect(get.status, token).toBe(409);
      expect(get.body.error).toBe('needs_review');
      expect(get.body.response).toBeUndefined();
    }
    const admin = await adminAgent(app);
    const status = (await admin.get('/api/admin/backend')).body;
    expect(status.summary).toMatchObject({ attending: 0, declined: 0, pending: 2 });
    const issues = status.issues.map((i: { id: string; message: string }) => `${i.id}: ${i.message}`).join('\n');
    expect(issues).toMatch(/INV-001-P2: La columna "activa" debe ser sí o no/);
    expect(issues).toMatch(/INV-002: El estado debe ser "asistirá" o "no asistirá"/);
  });

  it('borrar a mano la fila de una respuesta no reinicia la revisión: un teléfono atrasado recibe conflicto', async () => {
    const { app, gas, responses } = sheetsApp();
    expect((await request(app).put(`/api/invitations/${TOKEN_A}/rsvp`).send(rsvpBody(['INV-001-P1']))).body.invitation.revision).toBe(1);
    // Alguien borra la fila en la hoja (en lugar de usar el procedimiento).
    const tab = gas.sheets.get('Respuestas')!;
    tab.values = tab.values.slice(0, 1);
    const view = (await request(app).get(`/api/invitations/${TOKEN_A}`)).body;
    expect(view).toMatchObject({ response: null, revision: 2 });
    const b = await request(app).put(`/api/invitations/${TOKEN_A}/rsvp`).send(rsvpBody(['INV-001-P2'], { expectedRevision: 2 }));
    expect(b.body.invitation.revision).toBe(3);
    // El teléfono que vio la revisión 1 no sobrescribe la respuesta nueva.
    const stale = await request(app).put(`/api/invitations/${TOKEN_A}/rsvp`).send(rsvpBody(['INV-001-P4'], { expectedRevision: 1 }));
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe('conflict');
    expect(responses()).toEqual([['INV-001', 'INV-001-P2', 'asistirá', '3', expect.any(String), expect.any(String)]]);
    // Una respuesta capturada a mano también cuenta al revisar la lista.
    tab.values[1][3] = '7';
    gas.menu('btCheck');
    tab.values = tab.values.slice(0, 1);
    expect((await request(app).get(`/api/invitations/${TOKEN_A}`)).body.revision).toBe(8);
  });

  it('un detalle menor (teléfono, lado) no bloquea a la familia; desactivada con "no" responde como inexistente', async () => {
    const tabs = sampleTabs();
    tabs.Invitaciones[1][4] = '123'; // teléfono mal capturado
    tabs.Invitaciones[1][1] = 'tía'; // lado no reconocido
    tabs.Invitaciones[2][6] = 'no'; // INV-002 desactivada…
    tabs.Personas.push(['INV-001-P1', 'INV-002', 'Copia', 'sí']); // …y además comparte una persona con INV-001
    tabs.Personas.splice(1, 1); // INV-001 conserva sus demás personas (P1 queda solo en INV-002)
    const { app } = sheetsApp({ tabs });
    const a = await request(app).get(`/api/invitations/${TOKEN_A}`);
    expect(a.status).toBe(200);
    expect(a.body.people.map((p: { id: string }) => p.id)).toEqual(['INV-001-P2', 'INV-001-P3', 'INV-001-P4']);
    expect((await request(app).put(`/api/invitations/${TOKEN_A}/rsvp`).send(rsvpBody(['INV-001-P2']))).status).toBe(200);
    expect((await request(app).get(`/api/invitations/${TOKEN_B}`)).status).toBe(404);
    const admin = await adminAgent(app);
    const status = (await admin.get('/api/admin/backend')).body;
    const issues = status.issues.map((i: { id: string; message: string }) => `${i.id}: ${i.message}`).join('\n');
    expect(issues).toMatch(/INV-001: El teléfono "123" no es válido/);
    expect(issues).toMatch(/INV-001: El lado "tía" no es válido/);
    expect(status.summary).toMatchObject({ attending: 1 }); // la familia con un detalle menor sí cuenta
  });

  it('respuesta a mano con una persona repetida (sin distinguir mayúsculas): revisar, sin respuesta visible y fuera de los totales', async () => {
    const tabs = sampleTabs();
    tabs.Invitaciones[2][5] = 2; // INV-002 con cupo 2 y dos personas activas
    tabs.Personas[6][3] = 'sí';
    tabs.Respuestas.push(['INV-002', 'INV-002-P1, inv-002-p1', 'asistirá', '1', '2027-01-15T19:20:00-06:00', 'a-mano-0002']);
    const { app, gas, responses } = sheetsApp({ tabs });
    const get = await request(app).get(`/api/invitations/${TOKEN_B}`);
    expect(get.status).toBe(409);
    expect(get.body.error).toBe('needs_review');
    expect(get.body.response).toBeUndefined();
    expect((await request(app).put(`/api/invitations/${TOKEN_B}/rsvp`).send(rsvpBody(['INV-002-P1'], { expectedRevision: 1 }))).status).toBe(409);
    expect(responses()).toEqual([['INV-002', 'INV-002-P1, inv-002-p1', 'asistirá', '1', expect.any(String), 'a-mano-0002']]); // no se corrige sola
    const admin = await adminAgent(app);
    const status = (await admin.get('/api/admin/backend')).body;
    expect(status.summary).toMatchObject({ attending: 0, attendingPeople: 0, pending: 2 });
    expect(status.issues.map((i: { tab: string; id: string; message: string }) => `${i.tab} ${i.id}: ${i.message}`).join('\n')).toMatch(
      /Respuestas INV-002: La respuesta repite a la persona inv-002-p1/,
    );
    gas.fn('refreshSummary_', gas.ss);
    const resumen = Object.fromEntries(gas.sheets.get('Resumen')!.values.filter((r) => r.length === 2));
    expect(resumen).toMatchObject({ 'Invitaciones que asistirán': 0, 'Personas confirmadas': 0 });

    // La misma respuesta sin repetir es válida y se cuenta.
    const fixed = sampleTabs();
    fixed.Invitaciones[2][5] = 2;
    fixed.Personas[6][3] = 'sí';
    fixed.Respuestas.push(['INV-002', 'INV-002-P1, INV-002-P2', 'asistirá', '1', '2027-01-15T19:20:00-06:00', 'a-mano-0003']);
    const ok = sheetsApp({ tabs: fixed });
    const view = await request(ok.app).get(`/api/invitations/${TOKEN_B}`);
    expect(view.status).toBe(200);
    expect(view.body.response).toMatchObject({ status: 'attending', attending: 2 });
    const okAdmin = await adminAgent(ok.app);
    expect((await okAdmin.get('/api/admin/backend')).body.summary).toMatchObject({ attending: 1, attendingPeople: 2 });
  });

  it('una respuesta válida del script y otra repetida a mano para la misma invitación: revisar, reportar y no contar', async () => {
    const tabs = sampleTabs();
    tabs.Respuestas.push(['INV-002', 'INV-002-P1', 'asistirá', '1', '2027-01-15T19:20:00-06:00', 'r-000000001']);
    tabs.Respuestas.push(['INV-002', 'INV-002-P1, INV-002-P1', 'asistirá', '2', '2027-01-15T19:25:00-06:00', 'a-mano-0004']);
    const { app, gas } = sheetsApp({ tabs });
    const get = await request(app).get(`/api/invitations/${TOKEN_B}`);
    expect(get.status).toBe(409);
    expect(get.body.error).toBe('needs_review');
    const admin = await adminAgent(app);
    const status = (await admin.get('/api/admin/backend')).body;
    expect(status.summary).toMatchObject({ attending: 0, attendingPeople: 0, pending: 2, inReview: 1 });
    const issues = status.issues.map((i: { tab: string; id: string; message: string }) => `${i.tab} ${i.id}: ${i.message}`).join('\n');
    expect(issues).toMatch(/Invitaciones INV-002: En revisión: .*Hay más de una respuesta para esta invitación/);
    expect(issues).toMatch(/Respuestas INV-002: La respuesta repite a la persona INV-002-P1/);
    gas.fn('refreshSummary_', gas.ss);
    const resumen = Object.fromEntries(gas.sheets.get('Resumen')!.values.filter((r) => r.length === 2));
    expect(resumen).toMatchObject({ 'Invitaciones que asistirán': 0, 'Personas confirmadas': 0, 'Invitaciones sin respuesta': 2, 'De ellas, en revisión (ver "Revisar la lista")': 1 });
  });

  it('la escritura no pisa una fila de Respuestas que cambió de lugar; el Resumen usa las reglas del servidor', async () => {
    const tabs = sampleTabs();
    tabs.Respuestas.push(['INV-002', 'INV-002-P1', 'asistirá', '1', '2027-01-15T19:20:00-06:00', 'otra-familia-01']);
    const gas = createGas(tabs);
    const table = gas.fn('readTab_', gas.ss, (gas.ctx.BtRules as { RESPONSES_TAB: unknown }).RESPONSES_TAB);
    const response = { invitationId: 'INV-001', personIds: ['INV-001-P1'], status: 'attending', revision: 1, updatedAt: 'x', requestId: 'r-000000001' };
    expect(() => gas.fn('writeResponse_', table, 2, response)).toThrow(/cambió de lugar/);
    expect(gas.sheets.get('Respuestas')!.values[1][0]).toBe('INV-002');

    gas.fn('refreshSummary_', gas.ss);
    const resumen = Object.fromEntries(gas.sheets.get('Resumen')!.values.filter((r) => r.length === 2));
    expect(resumen).toMatchObject({ 'Invitaciones activas': 2, 'Cupo asignado': 6, 'Personas autorizadas activas': 5, 'Invitaciones que asistirán': 1, 'Personas confirmadas': 1 });
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
