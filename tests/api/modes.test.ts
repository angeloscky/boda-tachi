import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../server/app.js';
import { openDb } from '../../server/db.js';
import { loadConfig, parseBackend } from '../../server/config.js';
import { seedDemo, demoLinks } from '../../server/demo-data.js';
import { adminAgent, rsvpBody, tempDbPath, testConfig } from './helpers.js';

function clientDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boda-client-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><head><meta property="og:image" content="%PUBLIC_BASE_URL%/og.jpg" /><title>x</title></head><body></body></html>');
  return dir;
}

describe('estados honestos de la aplicación', () => {
  it('producción sin Google configurado: confirmación no habilitada y sin caer a la demostración', async () => {
    // Aunque exista una base de demostración con familias, sin RSVP_BACKEND no se usa.
    const dbPath = tempDbPath('prod');
    const db = openDb(dbPath);
    seedDemo(db);
    const demoToken = demoLinks(db, '')[0].token;
    const app = createApp(db, testConfig(dbPath, { production: true, rsvpBackend: 'disabled', clientDir: clientDir() }));
    for (const token of [demoToken, 'AAAAAAAAAAAAAAAAAAAAAAAA']) {
      const get = await request(app).get(`/api/invitations/${token}`);
      expect(get.status).toBe(503);
      expect(get.body.error).toBe('rsvp_not_enabled');
      const put = await request(app).put(`/api/invitations/${token}/rsvp`).send(rsvpBody(['DEMO-001-P1']));
      expect(put.status).toBe(503);
    }
    expect((await request(app).get('/api/health')).body).toEqual({ ok: true, rsvp: 'disabled' });
    const html = (await request(app).get('/')).text;
    expect(html).toContain('<meta name="bt-rsvp-mode" content="disabled" />');
    const admin = await adminAgent(app);
    expect((await admin.get('/api/admin/backend')).body).toMatchObject({ mode: 'disabled', ready: false, canManageList: false });
    expect((await admin.get('/api/admin/invitations')).status).toBe(409);
    expect((db.prepare('SELECT COUNT(*) AS n FROM responses').get() as { n: number }).n).toBe(0);
    db.close();
  });

  it('Google Sheets elegido pero sin URL o secreto válidos: no conectado, nunca éxito ficticio', async () => {
    for (const sheets of [
      { url: null, secret: null },
      { url: 'https://evil.example/exec', secret: 'x'.repeat(40) },
      { url: 'https://script.google.com/macros/s/AKfycbxxxxxxxxxxxxxxxxxxxxxxxx/exec', secret: 'corto' },
    ]) {
      const app = createApp(null, testConfig('/tmp/x.sqlite', { rsvpBackend: 'sheets', sheets: { ...sheets, timeoutMs: 1000 } }));
      const get = await request(app).get('/api/invitations/AAAAAAAAAAAAAAAAAAAAAAAA');
      expect(get.status, JSON.stringify(sheets)).toBe(503);
      expect(get.body.error).toBe('rsvp_not_enabled');
      const admin = await adminAgent(app);
      const status = (await admin.get('/api/admin/backend')).body;
      expect(status).toMatchObject({ mode: 'sheets', ready: false });
      expect(status.detail).toMatch(/no está configurado/);
    }
  });

  it('RSVP_BACKEND vacío equivale a deshabilitado y un valor desconocido detiene el arranque', () => {
    expect(parseBackend(undefined)).toBe('disabled');
    expect(parseBackend('')).toBe('disabled');
    expect(parseBackend('demo')).toBe('demo');
    expect(() => parseBackend('simulacion')).toThrow(/no es válido/);
    const prev = process.env.RSVP_BACKEND;
    delete process.env.RSVP_BACKEND;
    try {
      expect(loadConfig({ clientDir: '/tmp/a', dbPath: '/tmp/b/c.sqlite' }).rsvpBackend).toBe('disabled');
    } finally {
      if (prev !== undefined) process.env.RSVP_BACKEND = prev;
    }
  });

  it('en producción exige PUBLIC_BASE_URL y no arranca la demostración por descuido', () => {
    const keys = ['NODE_ENV', 'PUBLIC_BASE_URL', 'RSVP_BACKEND', 'DEMO_IN_PRODUCTION'] as const;
    const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    const paths = { clientDir: '/tmp/a', dbPath: '/tmp/b/c.sqlite' };
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.PUBLIC_BASE_URL;
      delete process.env.RSVP_BACKEND;
      delete process.env.DEMO_IN_PRODUCTION;
      expect(() => loadConfig(paths)).toThrow(/PUBLIC_BASE_URL/);
      process.env.PUBLIC_BASE_URL = 'https://boda.example';
      expect(loadConfig(paths).rsvpBackend).toBe('disabled');
      process.env.RSVP_BACKEND = 'demo';
      expect(() => loadConfig(paths)).toThrow(/DEMO_IN_PRODUCTION/);
      process.env.DEMO_IN_PRODUCTION = '1';
      expect(loadConfig(paths).rsvpBackend).toBe('demo');
    } finally {
      for (const k of keys) {
        if (prev[k] === undefined) delete process.env[k];
        else process.env[k] = prev[k];
      }
    }
  });

  it('la demostración se anuncia como tal y el HTML no lleva credenciales personales', async () => {
    const dbPath = tempDbPath('demo');
    const db = openDb(dbPath);
    seedDemo(db);
    const token = demoLinks(db, '')[0].token;
    const app = createApp(db, testConfig(dbPath, { clientDir: clientDir() }));
    const html = (await request(app).get(`/i/${token}`)).text;
    expect(html).toContain('<meta name="bt-rsvp-mode" content="demo" />');
    expect(html).toContain('<meta name="bt-general-url" content="https://boda.example/" />');
    expect(html).toContain('<meta property="og:url" content="https://boda.example/" />');
    expect(html).not.toContain(token);
    expect((await request(app).get(`/api/invitations/${token}`)).body.mode).toBe('demo');
    db.close();
  });

  it('las familias de demostración son ficticias y llevan prefijos que no pasan por reales', () => {
    const db = openDb(tempDbPath('seed'));
    expect(seedDemo(db)).toBe(5);
    expect(seedDemo(db)).toBe(0); // idempotente
    for (const l of demoLinks(db, 'https://x')) {
      expect(l.code).toMatch(/^DEMO-/);
      expect(l.token).toMatch(/^demo_/);
    }
    db.close();
  });
});
