import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createApp } from '../../server/app.js';
import { openDb, type DB } from '../../server/db.js';
import type { AppConfig } from '../../server/config.js';

export const ADMIN_PASSWORD = 'contraseña-de-prueba-123';

export function tempDbPath(name = 'test') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boda-test-'));
  return path.join(dir, `${name}.sqlite`);
}

export function testConfig(dbPath: string): AppConfig {
  return {
    port: 0,
    publicBaseUrl: 'https://boda.example',
    dbPath,
    adminPasswordHash: null,
    adminPasswordPlain: ADMIN_PASSWORD,
    cookieSecure: false,
    clientDir: path.join(os.tmpdir(), 'no-client'),
    messagingProvider: 'simulation',
    production: false,
  };
}

export function makeApp(dbPath = tempDbPath()) {
  const db = openDb(dbPath);
  const app = createApp(db, testConfig(dbPath));
  return { app, db, dbPath };
}

export async function adminAgent(app: ReturnType<typeof makeApp>['app']) {
  const agent = request.agent(app);
  const res = await agent.post('/api/admin/login').send({ password: ADMIN_PASSWORD });
  if (res.status !== 200) throw new Error(`login falló: ${res.status}`);
  return agent;
}

export async function createInv(agent: request.Agent, body: Record<string, unknown>) {
  const res = await agent.post('/api/admin/invitations').send(body);
  if (res.status !== 201) throw new Error(`alta falló: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { id: number; token: string; link: string; code: string };
}

export function countResponses(db: DB, invitationId: number) {
  return (db.prepare('SELECT COUNT(*) AS n FROM responses WHERE invitation_id = ?').get(invitationId) as { n: number }).n;
}
