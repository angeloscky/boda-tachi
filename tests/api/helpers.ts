import crypto from 'node:crypto';
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

export function testConfig(dbPath: string, overrides: Partial<AppConfig> = {}): AppConfig {
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
    trustProxy: 0,
    rsvpBackend: 'demo',
    sheets: { url: null, secret: null, timeoutMs: 2000 },
    ...overrides,
  };
}

export function makeApp(dbPath = tempDbPath()) {
  const db = openDb(dbPath);
  const app = createApp(db, testConfig(dbPath));
  return { app, db, dbPath };
}

export async function adminAgent(app: Parameters<typeof request.agent>[0]) {
  const agent = request.agent(app);
  const res = await agent.post('/api/admin/login').send({ password: ADMIN_PASSWORD });
  if (res.status !== 200) throw new Error(`login falló: ${res.status}`);
  return agent;
}

export interface CreatedInv {
  id: number;
  token: string;
  link: string;
  code: string;
  people: { id: string; name: string; active: boolean }[];
}

/** Alta con personas: `people` es una lista de nombres. */
export async function createInv(agent: request.Agent, body: Record<string, unknown> & { people?: string[] }) {
  const res = await agent.post('/api/admin/invitations').send({ ...body, people: (body.people ?? []).map((name) => ({ name })) });
  if (res.status !== 201) throw new Error(`alta falló: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as CreatedInv;
}

export const reqId = () => crypto.randomBytes(9).toString('base64url');

/** Cuerpo de confirmación válido. */
export function rsvpBody(personIds: string[], opts: { status?: 'attending' | 'declined'; expectedRevision?: number; requestId?: string } = {}) {
  return {
    status: opts.status ?? (personIds.length ? 'attending' : 'declined'),
    personIds,
    expectedRevision: opts.expectedRevision ?? 0,
    requestId: opts.requestId ?? reqId(),
  };
}

export function countResponses(db: DB, invitationId: number) {
  return (db.prepare('SELECT COUNT(*) AS n FROM responses WHERE invitation_id = ?').get(invitationId) as { n: number }).n;
}

export function historyCount(db: DB, invitationId: number) {
  return (db.prepare('SELECT COUNT(*) AS n FROM response_history WHERE invitation_id = ?').get(invitationId) as { n: number }).n;
}
