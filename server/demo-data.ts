/**
 * Familias FICTICIAS de la demostración local. IDs con prefijo DEMO- y enlaces con prefijo
 * demo_: no pueden confundirse con invitaciones reales ni funcionar contra Google Sheets.
 */
import type { DB } from './db.js';
import { createInvitation } from './invitations.js';

export const DEMO_FAMILIES = [
  {
    code: 'DEMO-001',
    side: 'novia',
    name: 'Familia Ejemplo Robles',
    contact: 'Ana Robles Ejemplo',
    phone: '3300000001',
    seats: 4,
    people: ['Ana Robles Ejemplo', 'Luis Robles Ejemplo', 'Sara Robles Ejemplo', 'Tomás Robles Ejemplo'],
  },
  { code: 'DEMO-002', side: 'novio', name: 'Familia Ficticia Prado', contact: 'Julián Prado Ficticio', phone: null, seats: 2, people: ['Julián Prado Ficticio', 'Carmen Prado Ficticia'] },
  { code: 'DEMO-003', side: 'ambos', name: 'Marina Luna Prueba', contact: 'Marina Luna Prueba', phone: null, seats: 1, people: ['Marina Luna Prueba'] },
  {
    code: 'DEMO-004',
    side: 'novia',
    name: 'Familia Muestra Sol',
    contact: 'Inés Sol Muestra',
    phone: '3300000004',
    seats: 3,
    people: ['Inés Sol Muestra', 'Raúl Sol Muestra', 'Paula Sol Muestra', 'Diego Sol Muestra'],
  },
  { code: 'DEMO-005', side: 'novio', name: 'Familia Pendiente Demo', contact: null, phone: null, seats: null, people: [] },
] as const;

/** Crea las familias ficticias que falten. Devuelve cuántas creó. */
export function seedDemo(db: DB): number {
  let created = 0;
  for (const f of DEMO_FAMILIES) {
    if (db.prepare('SELECT 1 FROM invitations WHERE code = ? COLLATE NOCASE').get(f.code)) continue;
    createInvitation(db, {
      code: f.code,
      side: f.side,
      name: f.name,
      contact: f.contact,
      phone: f.phone,
      seats: f.seats,
      notes: 'Dato ficticio de demostración',
      people: f.people.map((name) => ({ name })),
    });
    created++;
  }
  return created;
}

export function demoLinks(db: DB, baseUrl: string) {
  return (db.prepare("SELECT code, name, token FROM invitations WHERE token_revoked_at IS NULL AND enabled = 1 ORDER BY code").all() as {
    code: string;
    name: string;
    token: string;
  }[]).map((r) => ({ ...r, link: `${baseUrl}/i/${r.token}` }));
}
