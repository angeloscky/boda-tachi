import { describe, expect, it } from 'vitest';
import { adminAgent, makeApp } from './helpers.js';
import { parseCsv } from '../../server/csv.js';
import { buildInviteMessage, normalizePhone } from '../../shared/message.js';

const CSV = [
  'identificador,nombre,telefono,lugares_adultos,notas',
  'FAM-001,Familia Pérez López,33 1234 5678,4,',
  'FAM-002,"Ana Martínez, y acompañante",,2,mesa 3',
  'FAM-003,Familia Pérez Gómez,3312345678,,',
].join('\r\n');

describe('importación y exportación CSV', () => {
  it('(10) reimportar el mismo archivo no duplica invitaciones', async () => {
    const { app, db } = makeApp();
    const admin = await adminAgent(app);
    const preview = await admin.post('/api/admin/import/preview').send({ csv: CSV });
    expect(preview.body.canApply).toBe(true);
    expect(preview.body.counts).toEqual({ create: 3, update: 0, unchanged: 0, error: 0 });
    // Mismo teléfono en dos familias con el mismo apellido: aviso, no fusión.
    expect(preview.body.rows[2].warnings.join(' ')).toMatch(/Mismo teléfono que FAM-001/);
    expect(preview.body.rows[2].warnings.join(' ')).toMatch(/pendiente/);
    await admin.post('/api/admin/import/apply').send({ csv: CSV }).expect(200);
    const tokensBefore = (await admin.get('/api/admin/invitations')).body.map((r: { token: string }) => r.token).sort();

    const again = await admin.post('/api/admin/import/apply').send({ csv: CSV });
    expect(again.body.counts).toEqual({ create: 0, update: 0, unchanged: 3, error: 0 });
    const count = (db.prepare('SELECT COUNT(*) AS n FROM invitations').get() as { n: number }).n;
    expect(count).toBe(3);
    const tokensAfter = (await admin.get('/api/admin/invitations')).body.map((r: { token: string }) => r.token).sort();
    expect(tokensAfter).toEqual(tokensBefore); // los enlaces ya compartidos siguen funcionando

    const changed = CSV.replace('FAM-002,"Ana Martínez, y acompañante",,2', 'FAM-002,"Ana Martínez, y acompañante",,3');
    const upd = await admin.post('/api/admin/import/apply').send({ csv: changed });
    expect(upd.body.counts).toEqual({ create: 0, update: 1, unchanged: 2, error: 0 });
    expect((db.prepare("SELECT seats FROM invitations WHERE code = 'FAM-002'").get() as { seats: number }).seats).toBe(3);
  });

  it('muestra errores antes de aplicar y no aplica nada si hay errores', async () => {
    const { app, db } = makeApp();
    const admin = await adminAgent(app);
    const bad = [
      'identificador;nombre;telefono;lugares_adultos',
      'OK-1;Familia Correcta;;2',
      'OK-1;Familia Repetida;;2',
      ';Sin identificador;;1',
      'X-3;;;1',
      'X-4;Familia Teléfono;123;1',
      'X-5;Familia Lugares;;dos',
      'X-6;Familia Negativa;;-1',
    ].join('\n');
    const preview = await admin.post('/api/admin/import/preview').send({ csv: bad });
    expect(preview.body.canApply).toBe(false);
    expect(preview.body.counts.error).toBe(6);
    const res = await admin.post('/api/admin/import/apply').send({ csv: bad });
    expect(res.status).toBe(400);
    expect((db.prepare('SELECT COUNT(*) AS n FROM invitations').get() as { n: number }).n).toBe(0);
    const noHeader = await admin.post('/api/admin/import/preview').send({ csv: 'a,b\n1,2' });
    expect(noHeader.body.rows[0].errors[0]).toMatch(/Faltan columnas/);
  });

  it('la exportación protege contra fórmulas y es reimportable', async () => {
    const { app } = makeApp();
    const admin = await adminAgent(app);
    await admin.post('/api/admin/invitations').send({ code: 'Z-1', name: '=HYPERLINK("http://x")', seats: 1 }).expect(201);
    const csv = (await admin.get('/api/admin/export.csv')).text;
    expect(csv.startsWith('﻿')).toBe(true);
    const rows = parseCsv(csv);
    expect(rows[1][1].startsWith("'=")).toBe(true);
    const tpl = (await admin.get('/api/admin/template.csv')).text;
    expect(parseCsv(tpl)[0]).toEqual(['identificador', 'nombre', 'telefono', 'lugares_adultos', 'notas']);
    const reimport = await admin.post('/api/admin/import/preview').send({ csv });
    expect(reimport.body.rows[0].action).toBe('unchanged'); // la comilla protectora se retira al reimportar
  });
});

describe('preparación de mensajes', () => {
  it('prepara el mensaje sin enviarlo y separa comunicación de asistencia', async () => {
    const { app } = makeApp();
    const admin = await adminAgent(app);
    const inv = (await admin.post('/api/admin/invitations').send({ code: 'M-1', name: 'Familia Mensaje', seats: 2, phone: '3398765432' })).body;
    const msg = (await admin.get(`/api/admin/invitations/${inv.id}/message`)).body;
    expect(msg.text).toContain('Familia Mensaje');
    expect(msg.text).toContain(inv.link);
    expect(msg.text).toContain('2 lugares');
    expect(msg.waUrl).toMatch(/^https:\/\/wa\.me\/523398765432\?text=/);
    expect(msg.comm.status).toBe('none');

    const prepared = (await admin.post(`/api/admin/invitations/${inv.id}/message/prepare`)).body;
    expect(prepared.comm).toMatchObject({ status: 'prepared', source: 'simulation' });
    expect(prepared.note).toMatch(/no se envió/);
    const row = (await admin.get(`/api/admin/invitations/${inv.id}`)).body;
    expect(row.attendance).toBe('pending'); // preparar no confirma asistencia

    const manual = (await admin.post(`/api/admin/invitations/${inv.id}/message/manual`).send({ status: 'sent' })).body;
    expect(manual.comm).toMatchObject({ status: 'sent', source: 'manual' });
    expect((await admin.post(`/api/admin/invitations/${inv.id}/message/manual`).send({ status: 'read' })).status).toBe(400);
    const csv = (await admin.get('/api/admin/messages.csv')).text;
    expect(csv).toContain('enviado');
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
