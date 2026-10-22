import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { adminAgent, createInv, makeApp } from './helpers.js';
import { parseCsv } from '../../server/csv.js';
import { buildInviteMessage, normalizePhone } from '../../shared/message.js';
import { buildTemplates } from '../../scripts/build-apps-script.js';

const INV = [
  'id_invitacion,lado,grupo,contacto_principal,telefono,cupo,activa,token,enlace,notas',
  'INV-001,novia,Familia Pérez Ejemplo,Ana Pérez,33 1234 5678,4,sí,,,',
  'INV-002,novio,"Ana Martínez, y acompañante",,,2,sí,,,mesa 3',
  'INV-003,ambos,Familia Pérez Gómez,,3312345678,,sí,,,',
].join('\r\n');
const PEOPLE = [
  'id_persona,id_invitacion,nombre,activa',
  'INV-001-P1,INV-001,Ana Pérez Ejemplo,sí',
  'INV-001-P2,INV-001,Luis Pérez Ejemplo,sí',
  'INV-002-P1,INV-002,Ana Martínez Ejemplo,sí',
  'INV-002-P2,INV-002,Acompañante Ejemplo,sí',
  'INV-003-P1,INV-003,Ana Pérez Ejemplo,sí',
].join('\r\n');

const shuffle = (csv: string, order: number[]) => {
  const lines = csv.split('\r\n');
  return [lines[0], ...order.map((i) => lines[i])].join('\r\n');
};

describe('importación con la estructura de Google Sheets', () => {
  it('reimportar los mismos IDs actualiza o deja igual, nunca duplica ni cambia enlaces', async () => {
    const { app, db } = makeApp();
    const admin = await adminAgent(app);
    const preview = (await admin.post('/api/admin/import/preview').send({ invitations: INV, people: PEOPLE })).body;
    expect(preview.canApply).toBe(true);
    expect(preview.counts).toEqual({ create: 8, update: 0, unchanged: 0, error: 0 });
    // Mismo teléfono o mismo nombre: aviso, nunca fusión.
    const warn = preview.rows.flatMap((r: { warnings: string[] }) => r.warnings).join(' ');
    expect(warn).toMatch(/Mismo teléfono que INV-001/);
    expect(warn).toMatch(/Mismo nombre que una persona de INV-001/);
    await admin.post('/api/admin/import/apply').send({ invitations: INV, people: PEOPLE }).expect(200);
    const before = (await admin.get('/api/admin/invitations')).body as { code: string; token: string; people: { id: string }[] }[];

    const again = (await admin.post('/api/admin/import/apply').send({ invitations: INV, people: PEOPLE })).body;
    expect(again.counts).toEqual({ create: 0, update: 0, unchanged: 8, error: 0 });
    expect((db.prepare('SELECT COUNT(*) AS n FROM invitations').get() as { n: number }).n).toBe(3);
    expect((db.prepare('SELECT COUNT(*) AS n FROM people').get() as { n: number }).n).toBe(5);

    const changed = INV.replace('Ana Martínez, y acompañante",,,2', 'Ana Martínez, y acompañante",,,3');
    const upd = (await admin.post('/api/admin/import/apply').send({ invitations: changed })).body;
    expect(upd.counts).toEqual({ create: 0, update: 1, unchanged: 2, error: 0 });
    expect(upd.rows.find((r: { id: string }) => r.id === 'INV-002').warnings[0]).toMatch(/cupo 2 → 3/);
    const after = (await admin.get('/api/admin/invitations')).body as typeof before;
    expect(after.map((r) => [r.code, r.token])).toEqual(before.map((r) => [r.code, r.token]));
  });

  it('ordenar las filas del archivo no cambia identidades, personas ni enlaces', async () => {
    const { app } = makeApp();
    const admin = await adminAgent(app);
    await admin.post('/api/admin/import/apply').send({ invitations: INV, people: PEOPLE }).expect(200);
    const snapshot = async () =>
      ((await admin.get('/api/admin/invitations')).body as { code: string; token: string; people: { id: string; name: string }[] }[])
        .map((r) => ({ code: r.code, token: r.token, people: r.people.map((p) => `${p.id}:${p.name}`).sort() }))
        .sort((a, b) => a.code.localeCompare(b.code));
    const before = await snapshot();
    const res = (await admin.post('/api/admin/import/apply').send({ invitations: shuffle(INV, [3, 1, 2]), people: shuffle(PEOPLE, [5, 3, 1, 4, 2]) })).body;
    expect(res.counts.unchanged).toBe(8);
    expect(await snapshot()).toEqual(before);
  });

  it('muestra errores antes de aplicar y no aplica nada si hay uno solo', async () => {
    const { app, db } = makeApp();
    const admin = await adminAgent(app);
    await createInv(admin, { code: 'OTRA', name: 'Otra familia', seats: 2, people: ['Persona Otra'] });
    const badInv = [
      'id_invitacion;grupo;telefono;cupo;lado',
      'OK-1;Familia Correcta;;2;novia',
      'OK-1;Familia Repetida;;2;',
      ';Sin ID;;1;',
      'X-3;;;1;',
      'X-4;Familia Teléfono;123;1;',
      'X-5;Familia Cupo;;dos;',
      'X-6;Familia Lado;;1;primos',
    ].join('\n');
    const badPeople = [
      'id_persona,id_invitacion,nombre',
      'OK-1-P1,OK-1,Persona Correcta',
      'OK-1-P1,OK-1,Persona Repetida',
      'NADIE-P1,NO-EXISTE,Persona Huérfana',
      'OTRA-P1,OK-1,Persona Que Cambia De Familia',
    ].join('\n');
    const preview = (await admin.post('/api/admin/import/preview').send({ invitations: badInv, people: badPeople })).body;
    expect(preview.canApply).toBe(false);
    expect(preview.counts.error).toBe(9);
    const errors = preview.rows.flatMap((r: { errors: string[] }) => r.errors).join(' | ');
    expect(errors).toMatch(/una persona no cambia de invitación/);
    expect(errors).toMatch(/NO-EXISTE no existe/);
    expect(errors).toMatch(/novia, novio o ambos/);
    const res = await admin.post('/api/admin/import/apply').send({ invitations: badInv, people: badPeople });
    expect(res.status).toBe(400);
    expect((db.prepare('SELECT COUNT(*) AS n FROM invitations').get() as { n: number }).n).toBe(1);
    const noHeader = (await admin.post('/api/admin/import/preview').send({ invitations: 'a,b\n1,2' })).body;
    expect(noHeader.rows[0].errors[0]).toMatch(/Faltan columnas: id_invitacion, grupo/);
  });

  it('acepta encabezados de la plantilla anterior y avisa si hay más personas que cupo', async () => {
    const { app } = makeApp();
    const admin = await adminAgent(app);
    const legacy = 'identificador,nombre,telefono,lugares_adultos,notas\nL-1,Familia Antigua,,1,';
    const people = 'id_persona,id_invitacion,nombre,activa\nL-1-P1,L-1,Uno,sí\nL-1-P2,L-1,Dos,sí';
    const preview = (await admin.post('/api/admin/import/preview').send({ invitations: legacy, people })).body;
    expect(preview.canApply).toBe(true);
    expect(preview.general.join(' ')).toMatch(/L-1: 2 personas autorizadas y cupo de 1/);
  });

  it('exporta las pestañas sin enlaces de demostración y protege contra fórmulas', async () => {
    const { app } = makeApp();
    const admin = await adminAgent(app);
    const inv = await createInv(admin, { code: 'Z-1', name: '=HYPERLINK("http://x")', seats: 1, people: ['Uno'] });
    const csv = (await admin.get('/api/admin/export/invitaciones.csv')).text;
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).not.toContain(inv.token);
    const rows = parseCsv(csv);
    expect(rows[0]).toEqual(['id_invitacion', 'lado', 'grupo', 'contacto_principal', 'telefono', 'cupo', 'activa', 'token', 'enlace', 'notas']);
    expect(rows[1][2].startsWith("'=")).toBe(true);
    expect(rows[1][7]).toBe('');
    const people = (await admin.get('/api/admin/export/personas.csv')).text;
    const reimport = (await admin.post('/api/admin/import/preview').send({ invitations: csv, people })).body;
    expect(reimport.rows.every((r: { action: string }) => r.action === 'unchanged')).toBe(true); // la comilla protectora se retira
  });

  it('las plantillas del repositorio coinciden con las del panel y solo traen ejemplos ficticios', async () => {
    const { app } = makeApp();
    const admin = await adminAgent(app);
    const root = path.resolve(__dirname, '../..');
    for (const [file, body] of Object.entries(buildTemplates())) {
      expect(fs.readFileSync(path.join(root, file), 'utf8'), `${file} desactualizado: npm run sheets:build`).toBe(body);
    }
    const tpl = (await admin.get('/api/admin/templates/personas.csv')).text;
    expect(tpl).toBe(buildTemplates()['google-sheets/plantillas/Personas.csv']);
    expect(tpl).toMatch(/Ejemplo|Ficticio|Prueba|Muestra/);
    // La plantilla se puede importar tal cual (vista previa) sin errores.
    const preview = (await admin.post('/api/admin/import/preview').send({
      invitations: buildTemplates()['google-sheets/plantillas/Invitaciones.csv'],
      people: tpl,
    })).body;
    expect(preview.counts.error).toBe(0);
  });
});

describe('preparación de mensajes', () => {
  it('prepara el mensaje sin enviarlo y separa comunicación de asistencia', async () => {
    const { app } = makeApp();
    const admin = await adminAgent(app);
    const inv = await createInv(admin, { code: 'M-1', name: 'Familia Mensaje', seats: 2, phone: '3398765432', people: ['Uno'] });
    const msg = (await admin.get(`/api/admin/invitations/${inv.id}/message`)).body;
    expect(msg.text).toContain('Familia Mensaje');
    expect(msg.text).toContain(inv.link);
    expect(msg.text).toContain('2 lugares');
    expect(msg.waUrl).toMatch(/^https:\/\/wa\.me\/523398765432\?text=/);
    expect(msg.comm.status).toBe('none');

    const prepared = (await admin.post(`/api/admin/invitations/${inv.id}/message/prepare`)).body;
    expect(prepared.comm).toMatchObject({ status: 'prepared', source: 'simulation' });
    expect(prepared.note).toMatch(/no se envió/);
    expect((await admin.get(`/api/admin/invitations/${inv.id}`)).body.attendance).toBe('pending');

    const manual = (await admin.post(`/api/admin/invitations/${inv.id}/message/manual`).send({ status: 'sent' })).body;
    expect(manual.comm).toMatchObject({ status: 'sent', source: 'manual' });
    expect((await admin.post(`/api/admin/invitations/${inv.id}/message/manual`).send({ status: 'read' })).status).toBe(400);
    expect((await admin.get('/api/admin/messages.csv')).text).toContain('enviado');
  });

  it('normaliza teléfonos mexicanos e internacionales', () => {
    expect(normalizePhone('33 1234 5678')).toBe('523312345678');
    expect(normalizePhone('+52 1 33 1234 5678')).toBe('523312345678');
    expect(normalizePhone('+1 (415) 555-0100')).toBe('14155550100');
    expect(normalizePhone('123')).toBeNull();
    expect(normalizePhone('')).toBeNull();
  });

  it('omite la línea de lugares cuando no están asignados', () => {
    const text = buildInviteMessage({ name: 'Familia X', seats: null, link: 'https://x/i/abc' });
    expect(text).not.toMatch(/lugar/);
    expect(text).not.toMatch(/\n\n\n/);
  });
});
