/**
 * Adaptador local de DEMOSTRACIÓN sobre SQLite: invitaciones, personas y respuestas de prueba.
 * No es el registro de producción (ese será Google Sheets); sirve para revisar y probar.
 * Las reglas de confirmación viven en shared/rsvp-rules.ts y son las mismas que usa Apps Script.
 */
import crypto from 'node:crypto';
import type {
  AdminInvitation,
  AdminSummary,
  AttendanceStatus,
  CommStatus,
  ImportPreview,
  ImportRowResult,
  PublicInvitation,
  SaveRsvpResult,
  Side,
} from '../shared/types.js';
import {
  DEMO_TOKEN_RE,
  ID_RE,
  MAX_PEOPLE,
  NOT_FOUND_MESSAGE,
  STATUS_LABEL,
  decideRsvp,
  joinIds,
  parseInvitationRow,
  parsePersonRow,
  parseRsvpRequest,
  summarize,
  toGuestView,
  type InvitationRecord,
  type PersonRecord,
  type ResponseRecord,
  type RsvpRequest,
} from '../shared/rsvp-rules.js';
import { INVITATIONS_TAB, PEOPLE_TAB, RESPONSES_TAB, headersOf, type ColumnDef } from '../shared/sheets-schema.js';
import { TEMPLATES, type TemplateName } from '../shared/sheets-templates.js';
import { getSetting, now, tx, type DB } from './db.js';
import { parseCsv, toCsv } from './csv.js';
import { HttpError } from './errors.js';

export { HttpError };

/** Enlace de demostración: prefijo demo_ + 144 bits aleatorios. Nunca es válido como enlace real. */
export const newDemoToken = () => `demo_${crypto.randomBytes(18).toString('base64url')}`;
const newRequestId = (prefix: string) => `${prefix}_${crypto.randomBytes(12).toString('base64url')}`;
const notFound = () => new HttpError(404, 'not_found', NOT_FOUND_MESSAGE);
const lower = (s: string) => s.toLowerCase();

interface InvRow {
  id: number;
  code: string;
  token: string;
  token_revoked_at: string | null;
  name: string;
  side: Side | null;
  contact: string | null;
  phone: string | null;
  seats: number | null;
  enabled: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
  r_status: 'attending' | 'declined' | null;
  r_person_ids: string | null;
  r_revision: number | null;
  r_request_id: string | null;
  r_updated_at: string | null;
  r_source: 'guest' | 'admin' | null;
  c_status: CommStatus | null;
  c_source: string | null;
  c_at: string | null;
}

interface PersonRow {
  id: number;
  invitation_id: number;
  code: string;
  name: string;
  active: number;
  position: number;
}

const SELECT = `
  SELECT i.*, r.status AS r_status, r.person_ids AS r_person_ids, r.revision AS r_revision,
         r.request_id AS r_request_id, r.updated_at AS r_updated_at, r.source AS r_source,
         c.status AS c_status, c.source AS c_source, c.created_at AS c_at
  FROM invitations i
  LEFT JOIN responses r ON r.invitation_id = i.id
  LEFT JOIN communications c ON c.id = (SELECT MAX(id) FROM communications WHERE invitation_id = i.id)
`;

const peopleOf = (db: DB, invitationId: number) =>
  db.prepare('SELECT * FROM people WHERE invitation_id = ? ORDER BY position, id').all(invitationId) as unknown as PersonRow[];

function allPeople(db: DB): Map<number, PersonRow[]> {
  const map = new Map<number, PersonRow[]>();
  for (const p of db.prepare('SELECT * FROM people ORDER BY invitation_id, position, id').all() as unknown as PersonRow[]) {
    const list = map.get(p.invitation_id) ?? [];
    list.push(p);
    map.set(p.invitation_id, list);
  }
  return map;
}

const invRecord = (r: InvRow): InvitationRecord => ({
  id: r.code,
  group: r.name,
  side: r.side,
  contact: r.contact,
  phone: r.phone,
  seats: r.seats,
  active: r.enabled === 1,
  token: r.token_revoked_at ? null : r.token,
  notes: r.notes,
});

const personRecords = (r: InvRow, people: PersonRow[]): PersonRecord[] =>
  people.map((p) => ({ id: p.code, invitationId: r.code, name: p.name, active: p.active === 1 }));

const responseRecord = (r: InvRow): ResponseRecord | null =>
  r.r_status
    ? {
        invitationId: r.code,
        personIds: JSON.parse(r.r_person_ids ?? '[]') as string[],
        status: r.r_status,
        revision: r.r_revision ?? 1,
        updatedAt: r.r_updated_at ?? '',
        requestId: r.r_request_id ?? '',
      }
    : null;

export const rsvpOpen = (db: DB) => getSetting(db, 'rsvp_open') !== 'false';

function writeResponse(db: DB, invitationId: number, r: ResponseRecord, source: 'guest' | 'admin') {
  db.prepare(
    `INSERT INTO responses (invitation_id, status, adults, person_ids, request_id, source, revision, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(invitation_id) DO UPDATE SET
       status = excluded.status, adults = excluded.adults, person_ids = excluded.person_ids,
       request_id = excluded.request_id, source = excluded.source, revision = excluded.revision,
       updated_at = excluded.updated_at`,
  ).run(invitationId, r.status, r.personIds.length, JSON.stringify(r.personIds), r.requestId, source, r.revision, r.updatedAt, r.updatedAt);
  db.prepare(
    `INSERT INTO response_history (invitation_id, status, adults, person_ids, revision, request_id, source, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(invitationId, r.status, r.personIds.length, JSON.stringify(r.personIds), r.revision, r.requestId, source, r.updatedAt);
}

// ---------------------------------------------------------------- invitado

function findByToken(db: DB, token: string): InvRow {
  if (!DEMO_TOKEN_RE.test(token)) throw notFound();
  const row = db.prepare(`${SELECT} WHERE i.token = ? AND i.enabled = 1 AND i.token_revoked_at IS NULL`).get(token) as InvRow | undefined;
  if (!row) throw notFound();
  return row;
}

function guestView(db: DB, row: InvRow): PublicInvitation {
  const people = personRecords(row, peopleOf(db, row.id));
  return { ...toGuestView(invRecord(row), people, responseRecord(row), rsvpOpen(db)), mode: 'demo' };
}

export function getGuestInvitation(db: DB, token: string): PublicInvitation {
  return guestView(db, findByToken(db, token));
}

/** Lee, valida y escribe dentro de una sola transacción con bloqueo de escritura. */
export function saveGuestResponse(db: DB, token: string, req: RsvpRequest): SaveRsvpResult {
  return tx(db, () => {
    const row = findByToken(db, token);
    const decision = decideRsvp(
      {
        invitation: { id: row.code, seats: row.seats, active: row.enabled === 1 },
        people: personRecords(row, peopleOf(db, row.id)),
        current: responseRecord(row),
        rsvpOpen: rsvpOpen(db),
        now: now(),
      },
      req,
    );
    if (!decision.ok) {
      throw new HttpError(decision.status, decision.code, decision.message, decision.code === 'conflict' ? { current: guestView(db, row) } : undefined);
    }
    if (decision.action === 'write') writeResponse(db, row.id, decision.response, 'guest');
    return { invitation: guestView(db, findByToken(db, token)), outcome: decision.action === 'write' ? 'saved' : decision.action };
  });
}

// ---------------------------------------------------------------- administración

function toAdmin(row: InvRow, people: PersonRow[]): AdminInvitation {
  const resp = responseRecord(row);
  const activeKeys = new Set(people.filter((p) => p.active === 1).map((p) => lower(p.code)));
  const selected = resp?.personIds ?? [];
  return {
    id: row.id,
    code: row.code,
    side: row.side,
    name: row.name,
    contact: row.contact,
    phone: row.phone,
    seats: row.seats,
    token: row.token,
    linkRevoked: Boolean(row.token_revoked_at),
    enabled: row.enabled === 1,
    notes: row.notes,
    people: people.map((p) => ({ id: p.code, name: p.name, active: p.active === 1 })),
    attendance: (resp?.status ?? 'pending') as AttendanceStatus,
    selectedPersonIds: selected,
    attendingCount: resp?.status === 'attending' ? selected.filter((id) => activeKeys.has(lower(id))).length : 0,
    revision: resp?.revision ?? 0,
    respondedAt: row.r_updated_at,
    responseSource: row.r_source,
    comm: { status: row.c_status ?? 'none', source: row.c_source, at: row.c_at },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getRow(db: DB, id: number): InvRow {
  const row = db.prepare(`${SELECT} WHERE i.id = ?`).get(id) as InvRow | undefined;
  if (!row) throw new HttpError(404, 'not_found', 'La invitación no existe.');
  return row;
}

export function getInvitation(db: DB, id: number): AdminInvitation {
  return toAdmin(getRow(db, id), peopleOf(db, id));
}

export function listInvitations(db: DB, opts: { q?: string; status?: string } = {}): AdminInvitation[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (opts.q?.trim()) {
    const like = `%${opts.q.trim().toLowerCase()}%`;
    const digits = opts.q.replace(/\D/g, '');
    where.push(
      `(lower(i.name) LIKE ? OR lower(i.code) LIKE ? OR lower(coalesce(i.contact, '')) LIKE ? OR lower(coalesce(i.notes, '')) LIKE ?
        OR EXISTS (SELECT 1 FROM people p WHERE p.invitation_id = i.id AND lower(p.name) LIKE ?)${digits ? ' OR i.phone LIKE ?' : ''})`,
    );
    params.push(like, like, like, like, like);
    if (digits) params.push(`%${digits}%`);
  }
  if (opts.status === 'pending') where.push('r.status IS NULL');
  else if (opts.status === 'attending' || opts.status === 'declined') {
    where.push('r.status = ?');
    params.push(opts.status);
  } else if (opts.status === 'incomplete') where.push('(i.seats IS NULL OR NOT EXISTS (SELECT 1 FROM people p WHERE p.invitation_id = i.id AND p.active = 1))');
  else if (opts.status === 'revoked') where.push('(i.token_revoked_at IS NOT NULL OR i.enabled = 0)');
  const sql = `${SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY i.code COLLATE NOCASE, i.id`;
  const people = allPeople(db);
  return (db.prepare(sql).all(...params) as unknown as InvRow[]).map((r) => toAdmin(r, people.get(r.id) ?? []));
}

function allRecords(db: DB) {
  const rows = db.prepare(SELECT).all() as unknown as InvRow[];
  const people = allPeople(db);
  return {
    invitations: rows.map(invRecord),
    people: rows.flatMap((r) => personRecords(r, people.get(r.id) ?? [])),
    responses: rows.map(responseRecord).filter((r): r is ResponseRecord => r !== null),
  };
}

export function getSummary(db: DB): AdminSummary {
  const r = allRecords(db);
  return { ...summarize(r.invitations, r.people, r.responses), rsvpOpen: rsvpOpen(db) };
}

export interface PersonInput {
  id?: unknown;
  name?: unknown;
  active?: unknown;
}

interface PeoplePlan {
  id: number | null;
  code: string;
  name: string;
  active: boolean;
}

/** Campos de alta/edición con las mismas reglas que la importación y que la hoja. */
function checkInvitationBody(body: Record<string, unknown>) {
  return parseInvitationRow({
    id: body.code,
    group: body.name,
    side: body.side,
    contact: body.contact,
    phone: body.phone,
    seats: body.seats,
    active: body.enabled === undefined ? true : body.enabled === true,
    notes: body.notes,
    token: '',
  });
}

function personCodeTaken(db: DB, code: string, exceptId?: number) {
  return Boolean(db.prepare('SELECT 1 FROM people WHERE code = ? COLLATE NOCASE AND id <> ?').get(code, exceptId ?? -1));
}

/**
 * Lista de personas de una invitación. Las existentes se conservan por su ID (no se borran:
 * se desactivan); las nuevas reciben un ID estable INV-x-Pn si no traen uno.
 */
function planPeople(db: DB, code: string, input: unknown, existing: PersonRow[]): PeoplePlan[] {
  if (!Array.isArray(input)) throw new HttpError(400, 'invalid_people', 'La lista de personas no es válida.');
  if (input.length > MAX_PEOPLE) throw new HttpError(400, 'invalid_people', `Máximo ${MAX_PEOPLE} personas por invitación.`);
  const byCode = new Map(existing.map((p) => [lower(p.code), p] as const));
  const seen = new Set<string>();
  const plan: PeoplePlan[] = [];
  const pending: { name: string; active: boolean; index: number }[] = [];
  input.forEach((raw: PersonInput, index) => {
    const name = String(raw?.name ?? '').trim().replace(/\s+/g, ' ');
    if (!name) throw new HttpError(400, 'invalid_people', 'Cada persona necesita un nombre.');
    if (name.length > 120) throw new HttpError(400, 'invalid_people', 'Un nombre es demasiado largo (máximo 120 caracteres).');
    const active = raw?.active === undefined ? true : raw.active === true;
    const id = raw?.id === undefined || raw.id === null || raw.id === '' ? null : String(raw.id).trim();
    if (id === null) {
      pending.push({ name, active, index });
      plan.push({ id: null, code: '', name, active });
      return;
    }
    if (!ID_RE.test(id)) throw new HttpError(400, 'invalid_people', `El ID de persona "${id}" no es válido.`);
    if (seen.has(lower(id))) throw new HttpError(400, 'invalid_people', `El ID de persona ${id} está repetido.`);
    seen.add(lower(id));
    const prev = byCode.get(lower(id));
    if (!prev && personCodeTaken(db, id)) throw new HttpError(409, 'duplicate_person', `El ID de persona ${id} ya pertenece a otra invitación.`);
    plan.push({ id: prev?.id ?? null, code: prev?.code ?? id, name, active });
  });
  const missing = existing.filter((p) => !seen.has(lower(p.code)));
  if (missing.length) {
    throw new HttpError(400, 'people_missing', `No se borran personas (${missing.map((p) => p.name).join(', ')}): desmárcalas como inactivas.`);
  }
  // IDs nuevos: INV-001-P1, P2… sin reutilizar ninguno existente.
  let n = 1;
  for (const p of pending) {
    let candidate = `${code}-P${n}`;
    while (seen.has(lower(candidate)) || personCodeTaken(db, candidate)) candidate = `${code}-P${++n}`;
    seen.add(lower(candidate));
    plan[p.index].code = candidate;
    n++;
  }
  return plan;
}

function applyPeople(db: DB, invitationId: number, plan: PeoplePlan[]) {
  const t = now();
  const ins = db.prepare('INSERT INTO people (invitation_id, code, name, active, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const upd = db.prepare('UPDATE people SET name = ?, active = ?, position = ?, updated_at = ? WHERE id = ? AND invitation_id = ?');
  plan.forEach((p, position) => {
    if (p.id === null) ins.run(invitationId, p.code, p.name, p.active ? 1 : 0, position, t, t);
    else upd.run(p.name, p.active ? 1 : 0, position, t, p.id, invitationId);
  });
}

/** Lo que una respuesta vigente impide cambiar: cupo por debajo de lo confirmado y desactivar a quien confirmó. */
function guardAgainstResponse(row: InvRow, seats: number | null, activeCodes: Set<string>) {
  const resp = responseRecord(row);
  if (!resp || resp.status !== 'attending') return;
  if (seats === null || seats < resp.personIds.length) {
    const n = resp.personIds.length;
    throw new HttpError(409, 'seats_below_confirmed', `Esta invitación ya confirmó a ${n} ${n === 1 ? 'persona' : 'personas'}; el cupo no puede ser menor.`);
  }
  const gone = resp.personIds.filter((id) => !activeCodes.has(lower(id)));
  if (gone.length) {
    throw new HttpError(409, 'person_in_response', 'Una persona que se desactiva está confirmada en la respuesta vigente. Cambia o borra la respuesta primero.');
  }
}

export function createInvitation(db: DB, body: Record<string, unknown>): AdminInvitation {
  const { value, errors } = checkInvitationBody(body);
  if (errors.length) throw new HttpError(400, 'invalid', errors.join(' '));
  return tx(db, () => {
    if (db.prepare('SELECT 1 FROM invitations WHERE code = ? COLLATE NOCASE').get(value.id)) {
      throw new HttpError(409, 'duplicate_code', `Ya existe una invitación con el ID ${value.id}.`);
    }
    const plan = planPeople(db, value.id, body.people ?? [], []);
    const t = now();
    const r = db
      .prepare(
        `INSERT INTO invitations (code, token, name, side, contact, phone, seats, enabled, is_demo, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      )
      .run(value.id, newDemoToken(), value.group, value.side, value.contact, value.phone, value.seats, value.active ? 1 : 0, value.notes, t, t);
    const id = Number(r.lastInsertRowid);
    applyPeople(db, id, plan);
    return getInvitation(db, id);
  });
}

export function updateInvitation(db: DB, id: number, body: Record<string, unknown>): AdminInvitation {
  return tx(db, () => {
    const row = getRow(db, id);
    // Lo que no viene en el cuerpo se conserva tal como está.
    const keep = <T,>(v: unknown, current: T) => (v === undefined ? current : v);
    const merged = {
      code: keep(body.code, row.code),
      name: keep(body.name, row.name),
      side: keep(body.side, row.side),
      contact: keep(body.contact, row.contact),
      phone: keep(body.phone, row.phone),
      seats: keep(body.seats, row.seats),
      notes: keep(body.notes, row.notes),
      enabled: keep(body.enabled, row.enabled === 1),
    };
    const { value, errors } = checkInvitationBody(merged);
    if (errors.length) throw new HttpError(400, 'invalid', errors.join(' '));
    if (lower(value.id) !== lower(row.code)) throw new HttpError(400, 'code_immutable', 'El ID de una invitación es estable y no se cambia.');
    const existing = peopleOf(db, id);
    const plan = body.people === undefined ? existing.map((p) => ({ id: p.id, code: p.code, name: p.name, active: p.active === 1 })) : planPeople(db, row.code, body.people, existing);
    guardAgainstResponse(row, value.seats, new Set(plan.filter((p) => p.active).map((p) => lower(p.code))));
    db.prepare('UPDATE invitations SET name = ?, side = ?, contact = ?, phone = ?, seats = ?, notes = ?, enabled = ?, updated_at = ? WHERE id = ?').run(
      value.group,
      value.side,
      value.contact,
      value.phone,
      value.seats,
      value.notes,
      value.active ? 1 : 0,
      now(),
      id,
    );
    applyPeople(db, id, plan);
    return getInvitation(db, id);
  });
}

export function deleteInvitation(db: DB, id: number) {
  const r = db.prepare('DELETE FROM invitations WHERE id = ?').run(id);
  if (!r.changes) throw new HttpError(404, 'not_found', 'La invitación no existe.');
}

/** Enlace nuevo: el anterior deja de funcionar de inmediato. */
export function regenerateToken(db: DB, id: number): AdminInvitation {
  getRow(db, id);
  db.prepare('UPDATE invitations SET token = ?, token_revoked_at = NULL, updated_at = ? WHERE id = ?').run(newDemoToken(), now(), id);
  return getInvitation(db, id);
}

/** Revoca el enlace sin generar otro (p. ej. si se reenvió a quien no debía). */
export function revokeToken(db: DB, id: number): AdminInvitation {
  getRow(db, id);
  db.prepare('UPDATE invitations SET token_revoked_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), id);
  return getInvitation(db, id);
}

/** Respuesta recibida por otro medio. Mismas reglas que el invitado, salvo el cierre de confirmaciones. */
export function adminSetResponse(db: DB, id: number, body: unknown): AdminInvitation {
  return tx(db, () => {
    const row = getRow(db, id);
    const b = (body ?? {}) as Record<string, unknown>;
    const current = responseRecord(row);
    const parsed = parseRsvpRequest({ status: b.status, personIds: b.personIds, expectedRevision: current?.revision ?? 0, requestId: newRequestId('admin') });
    if (!parsed.ok) throw new HttpError(parsed.status, parsed.code, parsed.message);
    const decision = decideRsvp(
      { invitation: { id: row.code, seats: row.seats, active: true }, people: personRecords(row, peopleOf(db, id)), current, rsvpOpen: true, now: now() },
      parsed.value,
    );
    if (!decision.ok) throw new HttpError(decision.status, decision.code, decision.message);
    if (decision.action === 'write') writeResponse(db, id, decision.response, 'admin');
    return getInvitation(db, id);
  });
}

export function adminClearResponse(db: DB, id: number): AdminInvitation {
  return tx(db, () => {
    getRow(db, id);
    const r = db.prepare('DELETE FROM responses WHERE invitation_id = ?').run(id);
    if (r.changes) {
      db.prepare('INSERT INTO response_history (invitation_id, status, adults, source, recorded_at) VALUES (?, NULL, NULL, ?, ?)').run(id, 'admin', now());
    }
    return getInvitation(db, id);
  });
}

// ---------------------------------------------------------------- CSV con la estructura de las pestañas

const normHeader = (h: string) =>
  h
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '_');

/** Encabezados de la versión anterior de la plantilla, aceptados para no romper archivos ya preparados. */
const LEGACY_INVITATION_HEADERS: Record<string, string> = {
  identificador: 'id',
  id: 'id',
  nombre: 'group',
  familia: 'group',
  lugares_adultos: 'seats',
  lugares: 'seats',
};

interface Table {
  keys: Set<string>;
  rows: { line: number; raw: Record<string, string> }[];
  missing: string[];
}

function readTable(csv: string, tab: { columns: ColumnDef[] }, legacy: Record<string, string> = {}): Table {
  const table = parseCsv(csv);
  const byHeader = new Map(tab.columns.map((c) => [normHeader(c.header), c.key] as const));
  const header = (table[0] ?? []).map((h) => byHeader.get(normHeader(h)) ?? legacy[normHeader(h)] ?? '');
  const keys = new Set(header.filter(Boolean));
  const missing = tab.columns.filter((c) => c.required && !keys.has(c.key)).map((c) => c.header);
  // Quita la comilla protectora que la exportación antepone a celdas tipo fórmula.
  const rows = table.slice(1).map((r, idx) => {
    const raw: Record<string, string> = {};
    header.forEach((k, i) => {
      if (k) raw[k] = (r[i] ?? '').replace(/^'(?=[=+\-@])/, '');
    });
    return { line: idx + 2, raw };
  });
  return { keys, rows, missing };
}

export interface ImportInput {
  invitations?: string;
  people?: string;
}

interface ImportPlan {
  preview: ImportPreview;
  invitations: { action: ImportRowResult['action']; value: InvitationRecord; existingId: number | null }[];
  people: { action: ImportRowResult['action']; value: PersonRecord; existingId: number | null }[];
}

function analyzeImport(db: DB, input: ImportInput): ImportPlan {
  const rows: ImportRowResult[] = [];
  const general: string[] = [];
  const plan: ImportPlan = { preview: { rows, general, canApply: false, counts: { create: 0, update: 0, unchanged: 0, error: 0 } }, invitations: [], people: [] };
  if (!input.invitations?.trim() && !input.people?.trim()) {
    general.push('Elige al menos un archivo: Invitaciones.csv o Personas.csv.');
    return plan;
  }
  const existingInv = new Map(
    (db.prepare(SELECT).all() as unknown as InvRow[]).map((r) => [lower(r.code), r] as const),
  );
  const fileInv = new Map<string, InvitationRecord>();
  let tokensIgnored = false;

  if (input.invitations?.trim()) {
    const t = readTable(input.invitations, INVITATIONS_TAB, LEGACY_INVITATION_HEADERS);
    if (t.missing.length) {
      rows.push({ tab: 'Invitaciones', line: 1, id: '', label: '', action: 'error', errors: [`Faltan columnas: ${t.missing.join(', ')}. Usa la plantilla.`], warnings: [] });
    } else {
      const seen = new Map<string, number>();
      const phones = new Map<string, string>();
      for (const r of existingInv.values()) if (r.phone) phones.set(r.phone, r.code);
      for (const { line, raw } of t.rows) {
        const prev = raw.id ? existingInv.get(lower(raw.id.trim())) : undefined;
        // Una columna ausente conserva el valor existente.
        const pick = (k: string, current: unknown) => (t.keys.has(k) ? raw[k] : current);
        const parsed = parseInvitationRow({
          id: raw.id,
          group: pick('group', prev?.name),
          side: pick('side', prev?.side),
          contact: pick('contact', prev?.contact),
          phone: pick('phone', prev?.phone),
          seats: pick('seats', prev?.seats),
          active: pick('active', prev ? prev.enabled === 1 : true),
          notes: pick('notes', prev?.notes),
          token: '',
        });
        const { value, errors, warnings } = parsed;
        if (raw.token?.trim()) tokensIgnored = true;
        if (value.id) {
          const dup = seen.get(lower(value.id));
          if (dup) errors.push(`ID repetido en el archivo (también en la línea ${dup}).`);
          else seen.set(lower(value.id), line);
        }
        if (value.phone) {
          const other = phones.get(value.phone);
          if (other && lower(other) !== lower(value.id)) warnings.push(`Mismo teléfono que ${other}; se guardan como invitaciones distintas.`);
          else phones.set(value.phone, value.id);
        }
        if (prev) {
          value.id = prev.code; // conserva la escritura original del ID
          const resp = responseRecord(prev);
          if (resp?.status === 'attending' && (value.seats === null || value.seats < resp.personIds.length)) {
            errors.push(`Ya confirmó a ${resp.personIds.length} personas; el cupo no puede ser menor.`);
          }
        }
        let action: ImportRowResult['action'] = errors.length ? 'error' : prev ? 'unchanged' : 'create';
        if (!errors.length && prev) {
          const changed = [
            prev.name !== value.group && 'grupo',
            prev.side !== value.side && 'lado',
            prev.contact !== value.contact && 'contacto',
            prev.phone !== value.phone && (value.phone ? 'teléfono' : 'teléfono (se borra)'),
            prev.seats !== value.seats && `cupo ${prev.seats ?? 'pendiente'} → ${value.seats ?? 'pendiente'}`,
            (prev.enabled === 1) !== value.active && (value.active ? 'se activa' : 'se desactiva'),
            prev.notes !== value.notes && 'notas',
          ].filter(Boolean);
          if (changed.length) {
            action = 'update';
            warnings.unshift(`Cambia: ${changed.join(', ')}.`);
          }
        }
        rows.push({ tab: 'Invitaciones', line, id: value.id, label: value.group, action, errors, warnings });
        plan.invitations.push({ action, value, existingId: prev?.id ?? null });
        if (action !== 'error') fileInv.set(lower(value.id), value);
      }
    }
  }

  const existingPeople = new Map(
    (db.prepare('SELECT p.*, i.code AS inv_code FROM people p JOIN invitations i ON i.id = p.invitation_id').all() as unknown as (PersonRow & {
      inv_code: string;
    })[]).map((p) => [lower(p.code), p] as const),
  );
  const finalPeople = new Map<string, { invitationId: string; name: string; active: boolean }>();
  for (const p of existingPeople.values()) finalPeople.set(lower(p.code), { invitationId: p.inv_code, name: p.name, active: p.active === 1 });

  if (input.people?.trim()) {
    const t = readTable(input.people, PEOPLE_TAB);
    if (t.missing.length) {
      rows.push({ tab: 'Personas', line: 1, id: '', label: '', action: 'error', errors: [`Faltan columnas: ${t.missing.join(', ')}. Usa la plantilla.`], warnings: [] });
    } else {
      const seen = new Map<string, number>();
      const names = new Map<string, string>();
      for (const p of existingPeople.values()) names.set(lower(p.name), p.inv_code);
      for (const { line, raw } of t.rows) {
        const prev = raw.id ? existingPeople.get(lower(raw.id.trim())) : undefined;
        const { value, errors, warnings } = parsePersonRow({
          id: raw.id,
          invitationId: raw.invitationId,
          name: raw.name,
          active: t.keys.has('active') ? raw.active : prev ? prev.active === 1 : true,
        });
        if (value.id) {
          const dup = seen.get(lower(value.id));
          if (dup) errors.push(`ID de persona repetido en el archivo (también en la línea ${dup}).`);
          else seen.set(lower(value.id), line);
        }
        const inv = existingInv.get(lower(value.invitationId)) ?? null;
        if (value.invitationId && !inv && !fileInv.has(lower(value.invitationId))) {
          errors.push(`La invitación ${value.invitationId} no existe (ni en el sistema ni en el archivo de invitaciones).`);
        }
        if (prev && lower(prev.inv_code) !== lower(value.invitationId)) {
          errors.push(`Esta persona pertenece a ${prev.inv_code}; una persona no cambia de invitación.`);
        }
        if (prev && inv && !value.active) {
          const resp = responseRecord(inv);
          if (resp?.status === 'attending' && resp.personIds.some((id) => lower(id) === lower(prev.code))) {
            errors.push('Está confirmada en la respuesta vigente; cambia la respuesta antes de desactivarla.');
          }
        }
        const sameName = names.get(lower(value.name));
        if (value.name && sameName && lower(sameName) !== lower(value.invitationId)) {
          warnings.push(`Mismo nombre que una persona de ${sameName}; se mantienen como personas distintas.`);
        }
        if (value.name) names.set(lower(value.name), value.invitationId);
        if (prev) value.id = prev.code;
        let action: ImportRowResult['action'] = errors.length ? 'error' : prev ? 'unchanged' : 'create';
        if (!errors.length && prev) {
          const changed = [prev.name !== value.name && 'nombre', (prev.active === 1) !== value.active && (value.active ? 'se activa' : 'se desactiva')].filter(Boolean);
          if (changed.length) {
            action = 'update';
            warnings.unshift(`Cambia: ${changed.join(', ')}.`);
          }
        }
        rows.push({ tab: 'Personas', line, id: value.id, label: value.name, action, errors, warnings });
        plan.people.push({ action, value, existingId: prev?.id ?? null });
        if (action !== 'error') finalPeople.set(lower(value.id), { invitationId: value.invitationId, name: value.name, active: value.active });
      }
    }
  }

  // Avisos sobre el resultado completo: personas frente al cupo de cada invitación tocada.
  const touched = new Set([...plan.invitations.map((i) => lower(i.value.id)), ...plan.people.map((p) => lower(p.value.invitationId))]);
  for (const k of touched) {
    const inv = fileInv.get(k) ?? (existingInv.get(k) ? invRecord(existingInv.get(k)!) : null);
    if (!inv || !inv.active) continue;
    const n = [...finalPeople.values()].filter((p) => p.active && lower(p.invitationId) === k).length;
    if (!n) general.push(`${inv.id}: sin personas autorizadas; no podrá confirmar asistencia.`);
    else if (inv.seats !== null && n > inv.seats) general.push(`${inv.id}: ${n} personas autorizadas y cupo de ${inv.seats}; solo podrán confirmar ${inv.seats}.`);
  }
  if (tokensIgnored) general.push('La columna token se ignora: la demostración genera sus propios enlaces y nunca usa enlaces reales.');

  rows.forEach((r) => plan.preview.counts[r.action]++);
  plan.preview.canApply = plan.preview.counts.error === 0 && rows.length > 0;
  return plan;
}

export function previewImport(db: DB, input: ImportInput): ImportPreview {
  return analyzeImport(db, input).preview;
}

/** Aplica todo o nada. Reimportar un ID actualiza su registro; nunca crea otro ni combina registros. */
export function applyImport(db: DB, input: ImportInput): ImportPreview {
  return tx(db, () => {
    const plan = analyzeImport(db, input);
    if (!plan.preview.canApply) throw new HttpError(400, 'import_invalid', 'El archivo tiene errores; corrígelos antes de importar.');
    const t = now();
    const insInv = db.prepare(
      `INSERT INTO invitations (code, token, name, side, contact, phone, seats, enabled, is_demo, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    );
    const updInv = db.prepare('UPDATE invitations SET name = ?, side = ?, contact = ?, phone = ?, seats = ?, enabled = ?, notes = ?, updated_at = ? WHERE id = ?');
    for (const { action, value: v, existingId } of plan.invitations) {
      if (action === 'create') insInv.run(v.id, newDemoToken(), v.group, v.side, v.contact, v.phone, v.seats, v.active ? 1 : 0, v.notes, t, t);
      else if (action === 'update') updInv.run(v.group, v.side, v.contact, v.phone, v.seats, v.active ? 1 : 0, v.notes, t, existingId);
    }
    const invId = (code: string) => (db.prepare('SELECT id FROM invitations WHERE code = ? COLLATE NOCASE').get(code) as { id: number }).id;
    const nextPos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM people WHERE invitation_id = ?');
    const insP = db.prepare('INSERT INTO people (invitation_id, code, name, active, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const updP = db.prepare('UPDATE people SET name = ?, active = ?, updated_at = ? WHERE id = ?');
    for (const { action, value: p, existingId } of plan.people) {
      if (action === 'create') {
        const id = invId(p.invitationId);
        insP.run(id, p.id, p.name, p.active ? 1 : 0, (nextPos.get(id) as { n: number }).n, t, t);
      } else if (action === 'update') updP.run(p.name, p.active ? 1 : 0, t, existingId);
    }
    return plan.preview;
  });
}

export function templateCsv(name: TemplateName): string {
  const t = TEMPLATES[name];
  return toCsv(t.header, t.rows);
}

/**
 * Exporta con la estructura de las pestañas. La columna token sale vacía: los enlaces de la
 * demostración nunca deben llegar a la hoja real (el menú Boda genera los reales).
 */
export function exportTab(db: DB, name: TemplateName): string {
  const r = allRecords(db);
  if (name === 'invitaciones') {
    return toCsv(
      headersOf(INVITATIONS_TAB),
      r.invitations.map((i) => INVITATIONS_TAB.columns.map((c) => {
        if (c.key === 'token' || c.key === 'link') return '';
        if (c.key === 'active') return i.active ? 'sí' : 'no';
        const v = (i as unknown as Record<string, unknown>)[c.key];
        return v ?? '';
      })),
    );
  }
  if (name === 'personas') {
    return toCsv(headersOf(PEOPLE_TAB), r.people.map((p) => [p.id, p.invitationId, p.name, p.active ? 'sí' : 'no']));
  }
  return toCsv(
    headersOf(RESPONSES_TAB),
    r.responses.map((x) => [x.invitationId, joinIds(x.personIds), STATUS_LABEL[x.status], x.revision, x.updatedAt, x.requestId]),
  );
}

const COMM_LABEL: Record<CommStatus, string> = {
  none: 'sin preparar',
  prepared: 'preparado',
  sent: 'enviado',
  delivered: 'entregado',
  failed: 'fallido',
};

export function recordCommunication(
  db: DB,
  id: number,
  entry: { status: 'prepared' | 'sent' | 'delivered' | 'failed'; source: string; providerRef?: string; note?: string },
): AdminInvitation {
  getRow(db, id);
  db.prepare('INSERT INTO communications (invitation_id, status, source, provider_ref, note, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    id,
    entry.status,
    entry.source,
    entry.providerRef ?? null,
    entry.note ?? null,
    now(),
  );
  return getInvitation(db, id);
}

export { COMM_LABEL };
