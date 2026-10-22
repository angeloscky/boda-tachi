import crypto from 'node:crypto';
import type {
  AdminInvitation,
  AdminSummary,
  AttendanceStatus,
  CommStatus,
  ImportPreview,
  ImportRowResult,
  PublicInvitation,
  RsvpInput,
} from '../shared/types.js';
import { normalizePhone } from '../shared/message.js';
import { getSetting, now, tx, type DB } from './db.js';
import { parseCsv, toCsv } from './csv.js';

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const MAX_SEATS = 30;
const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;
export const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

export const newToken = () => crypto.randomBytes(18).toString('base64url'); // 144 bits, 24 caracteres

interface Row {
  id: number;
  code: string;
  token: string;
  name: string;
  phone: string | null;
  seats: number | null;
  enabled: number;
  is_demo: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
  r_status: 'attending' | 'declined' | null;
  r_adults: number | null;
  r_updated_at: string | null;
  c_status: CommStatus | null;
  c_source: string | null;
  c_at: string | null;
}

const SELECT = `
  SELECT i.*, r.status AS r_status, r.adults AS r_adults, r.updated_at AS r_updated_at,
         c.status AS c_status, c.source AS c_source, c.created_at AS c_at
  FROM invitations i
  LEFT JOIN responses r ON r.invitation_id = i.id
  LEFT JOIN communications c ON c.id = (SELECT MAX(id) FROM communications WHERE invitation_id = i.id)
`;

function toAdmin(row: Row): AdminInvitation {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    phone: row.phone,
    seats: row.seats,
    token: row.token,
    enabled: row.enabled === 1,
    isDemo: row.is_demo === 1,
    notes: row.notes,
    attendance: (row.r_status ?? 'pending') as AttendanceStatus,
    adults: row.r_adults ?? 0,
    respondedAt: row.r_updated_at,
    comm: { status: row.c_status ?? 'none', source: row.c_source, at: row.c_at },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const rsvpOpen = (db: DB) => getSetting(db, 'rsvp_open') !== 'false';

// ---------------------------------------------------------------- invitado

function findByToken(db: DB, token: string): Row {
  if (!TOKEN_RE.test(token)) throw new HttpError(404, 'not_found', 'No encontramos esta invitación.');
  const row = db.prepare(`${SELECT} WHERE i.token = ? AND i.enabled = 1`).get(token) as Row | undefined;
  if (!row) throw new HttpError(404, 'not_found', 'No encontramos esta invitación.');
  return row;
}

function toPublic(db: DB, row: Row): PublicInvitation {
  const closedReason = row.seats === null ? 'seats_unassigned' : !rsvpOpen(db) ? 'rsvp_closed' : null;
  return {
    name: row.name,
    seats: row.seats,
    canRespond: closedReason === null,
    closedReason,
    response: row.r_status ? { status: row.r_status, adults: row.r_adults ?? 0, updatedAt: row.r_updated_at! } : null,
  };
}

export function getPublicInvitation(db: DB, token: string): PublicInvitation {
  return toPublic(db, findByToken(db, token));
}

export function validateRsvp(body: unknown, seats: number | null): RsvpInput {
  const b = (body ?? {}) as Record<string, unknown>;
  if (b.status !== 'attending' && b.status !== 'declined') {
    throw new HttpError(400, 'invalid_status', 'Indica si asistirás o no.');
  }
  const adults = b.adults;
  if (typeof adults !== 'number' || !Number.isInteger(adults)) {
    throw new HttpError(400, 'invalid_adults', 'El número de asistentes debe ser un número entero.');
  }
  if (adults < 0) throw new HttpError(400, 'invalid_adults', 'El número de asistentes no puede ser negativo.');
  if (b.status === 'declined' && adults !== 0) {
    throw new HttpError(400, 'invalid_adults', 'Si no asistirás, el número de asistentes debe ser 0.');
  }
  if (b.status === 'attending') {
    if (adults < 1) throw new HttpError(400, 'invalid_adults', 'Indica cuántos adultos asistirán.');
    if (seats === null) throw new HttpError(409, 'seats_unassigned', 'Esta invitación aún no tiene lugares asignados.');
    if (adults > seats) {
      throw new HttpError(
        400,
        'too_many_adults',
        `Tu invitación tiene ${seats} ${seats === 1 ? 'lugar' : 'lugares'}; no es posible confirmar ${adults}.`,
      );
    }
  }
  return { status: b.status, adults };
}

/**
 * Guarda (o actualiza) la única respuesta vigente. Repetir la misma respuesta no
 * crea filas ni cambia la revisión, así que un doble toque o un reintento es inocuo.
 */
function upsertResponse(db: DB, invitationId: number, input: RsvpInput, source: 'guest' | 'admin') {
  const t = now();
  const current = db.prepare('SELECT status, adults FROM responses WHERE invitation_id = ?').get(invitationId) as
    | { status: string; adults: number }
    | undefined;
  if (current && current.status === input.status && current.adults === input.adults) return;
  db.prepare(
    `INSERT INTO responses (invitation_id, status, adults, source, revision, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT(invitation_id) DO UPDATE SET
       status = excluded.status, adults = excluded.adults, source = excluded.source,
       revision = responses.revision + 1, updated_at = excluded.updated_at`,
  ).run(invitationId, input.status, input.adults, source, t, t);
  db.prepare('INSERT INTO response_history (invitation_id, status, adults, source, recorded_at) VALUES (?, ?, ?, ?, ?)').run(
    invitationId,
    input.status,
    input.adults,
    source,
    t,
  );
}

export function saveGuestResponse(db: DB, token: string, body: unknown): PublicInvitation {
  return tx(db, () => {
    const row = findByToken(db, token);
    if (row.seats === null) throw new HttpError(409, 'seats_unassigned', 'Esta invitación aún no tiene lugares asignados.');
    if (!rsvpOpen(db)) throw new HttpError(409, 'rsvp_closed', 'La confirmación de asistencia ya está cerrada.');
    const input = validateRsvp(body, row.seats);
    upsertResponse(db, row.id, input, 'guest');
    return toPublic(db, findByToken(db, token));
  });
}

// ---------------------------------------------------------------- administración

export function getInvitation(db: DB, id: number): AdminInvitation {
  const row = db.prepare(`${SELECT} WHERE i.id = ?`).get(id) as Row | undefined;
  if (!row) throw new HttpError(404, 'not_found', 'La invitación no existe.');
  return toAdmin(row);
}

export function listInvitations(db: DB, opts: { q?: string; status?: string; demo?: string } = {}): AdminInvitation[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (opts.q?.trim()) {
    const like = `%${opts.q.trim().toLowerCase()}%`;
    const digits = opts.q.replace(/\D/g, '');
    where.push(`(lower(i.name) LIKE ? OR lower(i.code) LIKE ? OR lower(coalesce(i.notes, '')) LIKE ?${digits ? ' OR i.phone LIKE ?' : ''})`);
    params.push(like, like, like);
    if (digits) params.push(`%${digits}%`);
  }
  if (opts.status === 'pending') where.push('r.status IS NULL');
  else if (opts.status === 'attending' || opts.status === 'declined') {
    where.push('r.status = ?');
    params.push(opts.status);
  } else if (opts.status === 'incomplete') where.push('i.seats IS NULL');
  if (opts.demo === 'only') where.push('i.is_demo = 1');
  else if (opts.demo !== 'include') where.push('i.is_demo = 0');
  const sql = `${SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY i.name COLLATE NOCASE, i.id`;
  return (db.prepare(sql).all(...params) as unknown as Row[]).map(toAdmin);
}

export function getSummary(db: DB, includeDemo = false): AdminSummary {
  const demo = includeDemo ? '' : 'WHERE i.is_demo = 0';
  const s = db
    .prepare(
      `SELECT COUNT(*) AS invitations,
              SUM(i.seats IS NULL) AS incomplete,
              COALESCE(SUM(i.seats), 0) AS seatsAssigned,
              SUM(r.status = 'attending') AS attending,
              SUM(r.status = 'declined') AS declined,
              SUM(r.status IS NULL) AS pending,
              COALESCE(SUM(CASE WHEN r.status = 'attending' THEN r.adults END), 0) AS adultsConfirmed
       FROM invitations i LEFT JOIN responses r ON r.invitation_id = i.id ${demo}`,
    )
    .get() as Record<string, number | null>;
  return {
    invitations: s.invitations ?? 0,
    incomplete: s.incomplete ?? 0,
    seatsAssigned: s.seatsAssigned ?? 0,
    attending: s.attending ?? 0,
    declined: s.declined ?? 0,
    pending: s.pending ?? 0,
    adultsConfirmed: s.adultsConfirmed ?? 0,
    rsvpOpen: rsvpOpen(db),
  };
}

export interface InvitationInput {
  code: string;
  name: string;
  phone: string | null;
  seats: number | null;
  notes: string | null;
  enabled: boolean;
  isDemo: boolean;
}

/** Valida campos de alta/edición. Devuelve errores legibles en lugar de lanzar. */
export function checkInvitationFields(raw: {
  code?: unknown;
  name?: unknown;
  phone?: unknown;
  seats?: unknown;
  notes?: unknown;
}): { value: Omit<InvitationInput, 'enabled' | 'isDemo'>; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const code = String(raw.code ?? '').trim();
  const name = String(raw.name ?? '').trim().replace(/\s+/g, ' ');
  const phoneRaw = raw.phone === null || raw.phone === undefined ? '' : String(raw.phone).trim();
  const notes = raw.notes === null || raw.notes === undefined ? '' : String(raw.notes).trim();
  if (!code) errors.push('Falta el identificador.');
  else if (!CODE_RE.test(code)) errors.push('El identificador solo admite letras, números, "-" y "_" (máximo 40).');
  if (!name) errors.push('Falta el nombre de la invitación.');
  else if (name.length > 120) errors.push('El nombre es demasiado largo (máximo 120 caracteres).');
  let phone: string | null = null;
  if (phoneRaw) {
    phone = normalizePhone(phoneRaw);
    if (!phone) errors.push(`El teléfono "${phoneRaw}" no es válido (usa 10 dígitos o formato internacional).`);
  }
  let seats: number | null = null;
  const seatsRaw = raw.seats;
  if (seatsRaw === null || seatsRaw === undefined || String(seatsRaw).trim() === '') {
    warnings.push('Sin lugares asignados: quedará pendiente de completar.');
  } else {
    const n = typeof seatsRaw === 'number' ? seatsRaw : Number(String(seatsRaw).trim());
    if (!Number.isInteger(n)) errors.push('Los lugares deben ser un número entero.');
    else if (n < 1 || n > MAX_SEATS) errors.push(`Los lugares deben estar entre 1 y ${MAX_SEATS}.`);
    else seats = n;
  }
  if (notes.length > 500) errors.push('Las notas son demasiado largas (máximo 500 caracteres).');
  return { value: { code, name, phone, seats, notes: notes || null }, errors, warnings };
}

function confirmedAdults(db: DB, id: number): number {
  const r = db.prepare(`SELECT adults FROM responses WHERE invitation_id = ? AND status = 'attending'`).get(id) as
    | { adults: number }
    | undefined;
  return r?.adults ?? 0;
}

export function createInvitation(db: DB, body: Record<string, unknown>): AdminInvitation {
  const { value, errors } = checkInvitationFields(body);
  if (errors.length) throw new HttpError(400, 'invalid', errors.join(' '));
  return tx(db, () => {
    if (db.prepare('SELECT 1 FROM invitations WHERE code = ?').get(value.code)) {
      throw new HttpError(409, 'duplicate_code', `Ya existe una invitación con el identificador ${value.code}.`);
    }
    const t = now();
    const r = db
      .prepare(
        `INSERT INTO invitations (code, token, name, phone, seats, enabled, is_demo, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(value.code, newToken(), value.name, value.phone, value.seats, body.enabled === false ? 0 : 1, body.isDemo ? 1 : 0, value.notes, t, t);
    return getInvitation(db, Number(r.lastInsertRowid));
  });
}

export function updateInvitation(db: DB, id: number, body: Record<string, unknown>): AdminInvitation {
  const { value, errors } = checkInvitationFields(body);
  if (errors.length) throw new HttpError(400, 'invalid', errors.join(' '));
  return tx(db, () => {
    const existing = getInvitation(db, id);
    const clash = db.prepare('SELECT id FROM invitations WHERE code = ? AND id <> ?').get(value.code, id);
    if (clash) throw new HttpError(409, 'duplicate_code', `Ya existe otra invitación con el identificador ${value.code}.`);
    const confirmed = confirmedAdults(db, id);
    if (confirmed > 0 && (value.seats === null || value.seats < confirmed)) {
      throw new HttpError(
        409,
        'seats_below_confirmed',
        `Esta invitación ya confirmó ${confirmed} ${confirmed === 1 ? 'adulto' : 'adultos'}; los lugares no pueden ser menos.`,
      );
    }
    db.prepare(
      `UPDATE invitations SET code = ?, name = ?, phone = ?, seats = ?, notes = ?, enabled = ?, is_demo = ?, updated_at = ? WHERE id = ?`,
    ).run(
      value.code,
      value.name,
      value.phone,
      value.seats,
      value.notes,
      body.enabled === undefined ? (existing.enabled ? 1 : 0) : body.enabled ? 1 : 0,
      body.isDemo === undefined ? (existing.isDemo ? 1 : 0) : body.isDemo ? 1 : 0,
      now(),
      id,
    );
    return getInvitation(db, id);
  });
}

export function deleteInvitation(db: DB, id: number) {
  const r = db.prepare('DELETE FROM invitations WHERE id = ?').run(id);
  if (!r.changes) throw new HttpError(404, 'not_found', 'La invitación no existe.');
}

export function regenerateToken(db: DB, id: number): AdminInvitation {
  getInvitation(db, id);
  db.prepare('UPDATE invitations SET token = ?, updated_at = ? WHERE id = ?').run(newToken(), now(), id);
  return getInvitation(db, id);
}

export function adminSetResponse(db: DB, id: number, body: unknown): AdminInvitation {
  return tx(db, () => {
    const inv = getInvitation(db, id);
    const input = validateRsvp(body, inv.seats);
    upsertResponse(db, id, input, 'admin');
    return getInvitation(db, id);
  });
}

export function adminClearResponse(db: DB, id: number): AdminInvitation {
  return tx(db, () => {
    getInvitation(db, id);
    const r = db.prepare('DELETE FROM responses WHERE invitation_id = ?').run(id);
    if (r.changes) {
      db.prepare('INSERT INTO response_history (invitation_id, status, adults, source, recorded_at) VALUES (?, NULL, NULL, ?, ?)').run(
        id,
        'admin',
        now(),
      );
    }
    return getInvitation(db, id);
  });
}

// ---------------------------------------------------------------- CSV

export const IMPORT_HEADER = ['identificador', 'nombre', 'telefono', 'lugares_adultos', 'notas'];

const HEADER_ALIASES: Record<string, string> = {
  identificador: 'code',
  id: 'code',
  codigo: 'code',
  nombre: 'name',
  invitacion: 'name',
  familia: 'name',
  telefono: 'phone',
  celular: 'phone',
  whatsapp: 'phone',
  lugares_adultos: 'seats',
  lugares: 'seats',
  adultos: 'seats',
  notas: 'notes',
};

const normHeader = (h: string) =>
  h
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '_');

interface ParsedImport {
  preview: ImportPreview;
  rows: { code: string; value: ReturnType<typeof checkInvitationFields>['value']; action: ImportRowResult['action'] }[];
}

function analyzeImport(db: DB, csv: string): ParsedImport {
  const table = parseCsv(csv);
  const result: ImportRowResult[] = [];
  const rows: ParsedImport['rows'] = [];
  if (!table.length) {
    return {
      preview: { rows: [], canApply: false, counts: { create: 0, update: 0, unchanged: 0, error: 0 } },
      rows,
    };
  }
  const header = table[0].map((h) => HEADER_ALIASES[normHeader(h)] ?? '');
  const missing = ['code', 'name', 'seats'].filter((k) => !header.includes(k));
  if (missing.length) {
    result.push({
      line: 1,
      code: '',
      name: '',
      action: 'error',
      errors: [`Faltan columnas en el encabezado: ${missing.map((m) => ({ code: 'identificador', name: 'nombre', seats: 'lugares_adultos' })[m]).join(', ')}. Usa la plantilla.`],
      warnings: [],
    });
    return { preview: { rows: result, canApply: false, counts: { create: 0, update: 0, unchanged: 0, error: 1 } }, rows };
  }
  const col = (r: string[], key: string) => {
    const i = header.indexOf(key);
    return i >= 0 ? (r[i] ?? '') : undefined;
  };
  const seenCodes = new Map<string, number>();
  const phones = new Map<string, string>();
  for (const inv of db.prepare('SELECT code, phone FROM invitations WHERE phone IS NOT NULL').all() as { code: string; phone: string }[]) {
    phones.set(inv.phone, inv.code);
  }
  table.slice(1).forEach((r, idx) => {
    const line = idx + 2;
    const raw = { code: col(r, 'code'), name: col(r, 'name'), phone: col(r, 'phone'), seats: col(r, 'seats'), notes: col(r, 'notes') };
    const { value, errors, warnings } = checkInvitationFields(raw);
    if (value.code) {
      const prev = seenCodes.get(value.code.toLowerCase());
      if (prev) errors.push(`Identificador repetido en el archivo (también en la línea ${prev}).`);
      else seenCodes.set(value.code.toLowerCase(), line);
    }
    const existing = value.code
      ? (db.prepare('SELECT id, name, phone, seats, notes FROM invitations WHERE code = ?').get(value.code) as
          | { id: number; name: string; phone: string | null; seats: number | null; notes: string | null }
          | undefined)
      : undefined;
    if (value.phone) {
      const other = phones.get(value.phone);
      if (other && other !== value.code) warnings.push(`Mismo teléfono que ${other}; se guardan como invitaciones distintas.`);
      else phones.set(value.phone, value.code);
    }
    // En importación, una columna de notas ausente conserva las notas existentes.
    if (raw.notes === undefined && existing) value.notes = existing.notes;
    if (existing) {
      const confirmed = confirmedAdults(db, existing.id);
      if (confirmed > 0 && (value.seats === null || value.seats < confirmed)) {
        errors.push(`Ya confirmó ${confirmed} ${confirmed === 1 ? 'adulto' : 'adultos'}; los lugares no pueden ser menos.`);
      }
    }
    let action: ImportRowResult['action'] = 'create';
    if (errors.length) action = 'error';
    else if (existing) {
      const same =
        existing.name === value.name && existing.phone === value.phone && existing.seats === value.seats && existing.notes === value.notes;
      action = same ? 'unchanged' : 'update';
    }
    result.push({ line, code: value.code, name: value.name, action, errors, warnings });
    rows.push({ code: value.code, value, action });
  });
  const counts = { create: 0, update: 0, unchanged: 0, error: 0 };
  result.forEach((r) => counts[r.action]++);
  return { preview: { rows: result, canApply: counts.error === 0 && result.length > 0, counts }, rows };
}

export function previewImport(db: DB, csv: string): ImportPreview {
  return analyzeImport(db, csv).preview;
}

/** Aplica la importación completa o nada. Reimportar el mismo identificador actualiza, no duplica. */
export function applyImport(db: DB, csv: string): ImportPreview {
  return tx(db, () => {
    const { preview, rows } = analyzeImport(db, csv);
    if (!preview.canApply) throw new HttpError(400, 'import_invalid', 'El archivo tiene errores; corrígelos antes de importar.');
    const t = now();
    const insert = db.prepare(
      `INSERT INTO invitations (code, token, name, phone, seats, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const update = db.prepare(`UPDATE invitations SET name = ?, phone = ?, seats = ?, notes = ?, updated_at = ? WHERE code = ?`);
    for (const r of rows) {
      if (r.action === 'create') insert.run(r.value.code, newToken(), r.value.name, r.value.phone, r.value.seats, r.value.notes, t, t);
      else if (r.action === 'update') update.run(r.value.name, r.value.phone, r.value.seats, r.value.notes, t, r.value.code);
    }
    return preview;
  });
}

export function importTemplate(): string {
  return toCsv(IMPORT_HEADER, [
    ['FAM-001', 'Familia Ejemplo Uno', '3312345678', '4', 'Ejemplo: borra esta fila'],
    ['FAM-002', 'Ana Ejemplo', '', '1', ''],
    ['FAM-003', 'Familia Ejemplo Tres', '', '', 'Sin lugares: quedará pendiente'],
  ]);
}

const ATTENDANCE_LABEL: Record<AttendanceStatus, string> = { pending: 'pendiente', attending: 'asistirá', declined: 'no asistirá' };
const COMM_LABEL: Record<CommStatus, string> = {
  none: 'sin preparar',
  prepared: 'preparado',
  sent: 'enviado',
  delivered: 'entregado',
  failed: 'fallido',
};

export function exportCsv(db: DB, baseUrl: string, includeDemo: boolean): string {
  const list = listInvitations(db, { demo: includeDemo ? 'include' : undefined });
  return toCsv(
    [...IMPORT_HEADER, 'estado_asistencia', 'adultos_confirmados', 'fecha_respuesta', 'enlace', 'estado_comunicacion', 'origen_comunicacion', 'habilitada', 'demo'],
    list.map((i) => [
      i.code,
      i.name,
      i.phone ?? '',
      i.seats ?? '',
      i.notes ?? '',
      ATTENDANCE_LABEL[i.attendance],
      i.attendance === 'attending' ? i.adults : 0,
      i.respondedAt ?? '',
      `${baseUrl}/i/${i.token}`,
      COMM_LABEL[i.comm.status],
      i.comm.source ?? '',
      i.enabled ? 'sí' : 'no',
      i.isDemo ? 'sí' : 'no',
    ]),
  );
}

export function recordCommunication(
  db: DB,
  id: number,
  entry: { status: 'prepared' | 'sent' | 'delivered' | 'failed'; source: string; providerRef?: string; note?: string },
): AdminInvitation {
  getInvitation(db, id);
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

export { ATTENDANCE_LABEL, COMM_LABEL };
