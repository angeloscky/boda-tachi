/**
 * Reglas de invitación y confirmación, independientes del almacenamiento.
 *
 * Las usan el adaptador local de demostración (SQLite) y el conector de Google Sheets
 * (Apps Script, que recibe este archivo empaquetado en apps-script/Code.gs). Por eso no
 * importa nada ni usa APIs de Node o del navegador: solo funciones puras.
 */

export const RULES_VERSION = 1;
export const MAX_SEATS = 30;
export const MAX_PEOPLE = 30;

/** IDs estables de invitación y de persona (nunca números de fila). */
export const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;
/** Enlace real (Google Sheets): 24 caracteres base64url, 144 bits aleatorios. */
export const LIVE_TOKEN_RE = /^[A-Za-z0-9_-]{24}$/;
/** Enlace de la demostración local: prefijo visible para que nunca pase por uno real. */
export const DEMO_TOKEN_RE = /^demo_[A-Za-z0-9_-]{24}$/;
/** Identificador de solicitud que genera el navegador para reintentar sin duplicar. */
export const REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
/** IDs reservados para datos ficticios (demostración y filas de ejemplo de las plantillas). */
export const DEMO_ID_RE = /^(demo|ejemplo)[-_]/i;
/** Valor que el menú escribe en la columna token al revocar un enlace. */
export const REVOKED_TOKEN = 'revocado';

export const SIDES = ['novia', 'novio', 'ambos'] as const;
export type Side = (typeof SIDES)[number];
export type RsvpStatus = 'attending' | 'declined';

export interface InvitationRecord {
  id: string;
  group: string;
  side: Side | null;
  contact: string | null;
  phone: string | null;
  seats: number | null;
  active: boolean;
  token: string | null;
  notes: string | null;
  /** En la hoja: enlace revocado a propósito (no se vuelve a generar solo). */
  revoked?: boolean;
}

export interface PersonRecord {
  id: string;
  invitationId: string;
  name: string;
  active: boolean;
}

/** La única respuesta vigente de una invitación. */
export interface ResponseRecord {
  invitationId: string;
  personIds: string[];
  status: RsvpStatus;
  revision: number;
  updatedAt: string;
  requestId: string;
}

export interface RsvpRequest {
  status: RsvpStatus;
  personIds: string[];
  /** Revisión que el invitado vio antes de guardar (0 si aún no había respuesta). */
  expectedRevision: number;
  requestId: string;
}

export interface RuleError {
  ok: false;
  status: number;
  code: string;
  message: string;
}

const fail = (status: number, code: string, message: string): RuleError => ({ ok: false, status, code, message });

export const NOT_FOUND_MESSAGE = 'No encontramos esta invitación.';

const key = (id: string) => id.toLowerCase();

// ---------------------------------------------------------------- solicitud del invitado

const RSVP_KEYS = ['status', 'personIds', 'expectedRevision', 'requestId'];

/**
 * Valida la forma de la solicitud. Solo admite quiénes asistirán: cualquier otro campo
 * (cupo, nombres, teléfono, cantidad de asistentes…) se rechaza en lugar de ignorarse.
 */
export function parseRsvpRequest(body: unknown): { ok: true; value: RsvpRequest } | RuleError {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(400, 'invalid_request', 'La solicitud no es válida.');
  const b = body as Record<string, unknown>;
  const extra = Object.keys(b).filter((k) => RSVP_KEYS.indexOf(k) < 0);
  if (extra.length) {
    return fail(400, 'forbidden_fields', `La confirmación solo indica quiénes asistirán; no acepta los campos: ${extra.join(', ')}.`);
  }
  if (b.status !== 'attending' && b.status !== 'declined') return fail(400, 'invalid_status', 'Indica si asistirán o no.');
  if (!Array.isArray(b.personIds) || b.personIds.length > MAX_PEOPLE) {
    return fail(400, 'invalid_people', 'La selección de personas no es válida.');
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const raw of b.personIds) {
    if (typeof raw !== 'string' || !ID_RE.test(raw)) return fail(400, 'invalid_people', 'La selección de personas no es válida.');
    if (seen.has(key(raw))) return fail(400, 'duplicate_person', 'Una persona aparece más de una vez en la selección.');
    seen.add(key(raw));
    ids.push(raw);
  }
  if (b.status === 'declined' && ids.length) {
    return fail(400, 'declined_with_people', 'Si nadie podrá asistir, no selecciones personas.');
  }
  if (b.status === 'attending' && !ids.length) {
    return fail(400, 'no_people_selected', 'Selecciona al menos a una persona que asistirá.');
  }
  const rev = b.expectedRevision;
  if (typeof rev !== 'number' || !Number.isInteger(rev) || rev < 0 || rev > 1e9) {
    return fail(400, 'invalid_revision', 'Vuelve a abrir tu invitación e inténtalo de nuevo.');
  }
  if (typeof b.requestId !== 'string' || !REQUEST_ID_RE.test(b.requestId)) {
    return fail(400, 'invalid_request_id', 'La solicitud no es válida.');
  }
  return { ok: true, value: { status: b.status, personIds: ids, expectedRevision: rev, requestId: b.requestId } };
}

// ---------------------------------------------------------------- decisión

export interface RsvpContext {
  invitation: Pick<InvitationRecord, 'id' | 'seats' | 'active'>;
  /** Personas de esta invitación (activas e inactivas). */
  people: PersonRecord[];
  current: ResponseRecord | null;
  rsvpOpen: boolean;
  now: string;
  /**
   * Revisión sin respuesta vigente (0 si nunca hubo). Al borrar una respuesta, la revisión
   * no vuelve a 0: así un dispositivo que vio la respuesta borrada recibe un conflicto.
   */
  baseRevision?: number;
}

export type RsvpDecision =
  | { ok: true; action: 'write' | 'unchanged' | 'replay'; response: ResponseRecord }
  | (RuleError & { current?: ResponseRecord | null });

const sameIds = (a: string[], b: string[]) => {
  if (a.length !== b.length) return false;
  const s = new Set(a.map(key));
  return b.every((id) => s.has(key(id)));
};

/**
 * Decide qué hacer con una solicitud del invitado. El almacenamiento solo ejecuta la
 * decisión, dentro de su transacción o bloqueo:
 * - replay: la misma solicitud ya está guardada (reintento o doble toque); no se escribe.
 * - unchanged: la selección es igual a la vigente; no se escribe ni cambia la revisión.
 * - write: nueva revisión, si el invitado partió de la revisión vigente.
 * - conflict: alguien guardó otra respuesta desde que el invitado abrió la suya.
 */
export function decideRsvp(ctx: RsvpContext, req: RsvpRequest): RsvpDecision {
  const { invitation, current } = ctx;
  if (!invitation.active) return fail(404, 'not_found', NOT_FOUND_MESSAGE);
  if (current && current.requestId === req.requestId) {
    // Repetir la misma solicitud no duplica; reutilizar su ID con otra selección es un error, no un éxito.
    if (current.status === req.status && sameIds(current.personIds, req.personIds)) return { ok: true, action: 'replay', response: current };
    return fail(409, 'request_id_reused', 'Esta solicitud ya se usó con otra selección. Revisa tu respuesta y vuelve a guardarla.');
  }
  if (!ctx.rsvpOpen) return fail(409, 'rsvp_closed', 'La confirmación de asistencia ya está cerrada.');
  if (invitation.seats === null) {
    return fail(409, 'seats_unassigned', 'Esta invitación aún no tiene lugares asignados.');
  }
  const own = ctx.people.filter((p) => key(p.invitationId) === key(invitation.id));
  const byKey = new Map(own.map((p) => [key(p.id), p] as const));
  const selected: PersonRecord[] = [];
  for (const id of req.personIds) {
    const person = byKey.get(key(id));
    if (!person) return fail(400, 'unknown_person', 'La selección incluye a alguien que no forma parte de esta invitación.');
    if (!person.active) return fail(400, 'inactive_person', 'La selección incluye a alguien que ya no está en esta invitación.');
    selected.push(person);
  }
  if (selected.length > invitation.seats) {
    const s = invitation.seats;
    return fail(
      400,
      'over_capacity',
      `Esta invitación tiene ${s} ${s === 1 ? 'lugar' : 'lugares'}; no es posible confirmar a ${selected.length} personas.`,
    );
  }
  // Orden canónico: el de la lista de personas, no el del navegador.
  const order = own.map((p) => key(p.id));
  const personIds = selected.sort((a, b) => order.indexOf(key(a.id)) - order.indexOf(key(b.id))).map((p) => p.id);
  if (current && current.status === req.status && sameIds(current.personIds, personIds)) {
    return { ok: true, action: 'unchanged', response: current };
  }
  const currentRevision = current ? current.revision : (ctx.baseRevision ?? 0);
  if (req.expectedRevision !== currentRevision) {
    return {
      ...fail(409, 'conflict', 'Esta invitación se actualizó desde otro dispositivo mientras la revisabas.'),
      current,
    };
  }
  return {
    ok: true,
    action: 'write',
    response: {
      invitationId: invitation.id,
      personIds,
      status: req.status,
      revision: currentRevision + 1,
      updatedAt: ctx.now,
      requestId: req.requestId,
    },
  };
}

// ---------------------------------------------------------------- vista del invitado

export interface GuestView {
  name: string;
  seats: number | null;
  /** Solo las personas activas de esta invitación. */
  people: { id: string; name: string }[];
  revision: number;
  response: { status: RsvpStatus; personIds: string[]; attending: number; updatedAt: string } | null;
  canRespond: boolean;
  closedReason: 'seats_unassigned' | 'no_people' | 'rsvp_closed' | null;
}

/** Lo único que ve quien abre un enlace personal: datos de su propia invitación. */
export function toGuestView(
  invitation: Pick<InvitationRecord, 'group' | 'seats'>,
  people: PersonRecord[],
  current: ResponseRecord | null,
  rsvpOpen: boolean,
  baseRevision = 0,
): GuestView {
  const active = people.filter((p) => p.active);
  const activeKeys = new Set(active.map((p) => key(p.id)));
  const closedReason =
    invitation.seats === null ? 'seats_unassigned' : !active.length ? 'no_people' : !rsvpOpen ? 'rsvp_closed' : null;
  const selected = current ? current.personIds.filter((id) => activeKeys.has(key(id))) : [];
  return {
    name: invitation.group,
    seats: invitation.seats,
    people: active.map((p) => ({ id: p.id, name: p.name })),
    revision: current ? current.revision : baseRevision,
    response: current
      ? { status: current.status, personIds: selected, attending: current.status === 'attending' ? selected.length : 0, updatedAt: current.updatedAt }
      : null,
    canRespond: closedReason === null,
    closedReason,
  };
}

// ---------------------------------------------------------------- lectura de filas (CSV o Google Sheets)

/** Normaliza un teléfono a dígitos E.164 sin "+". Asume México (52) si son 10 dígitos. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, '');
  if (!d) return null;
  if (d.length === 10) d = '52' + d;
  else if (d.length === 13 && d.indexOf('521') === 0) d = '52' + d.slice(3); // formato antiguo de móvil
  if (d.length < 11 || d.length > 15) return null;
  return d;
}

const text = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
const stripAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Casilla de verificación de Sheets (TRUE/FALSE) o texto "sí"/"no". Vacío = valor por defecto. */
export function parseBool(v: unknown, fallback: boolean): boolean | null {
  if (v === true || v === false) return v;
  const t = stripAccents(text(v).toLowerCase());
  if (!t) return fallback;
  if (['si', 'true', 'verdadero', '1', 'x', 'activa', 'activo'].indexOf(t) >= 0) return true;
  if (['no', 'false', 'falso', '0', 'inactiva', 'inactivo'].indexOf(t) >= 0) return false;
  return null;
}

export interface RowResult<T> {
  value: T;
  errors: string[];
  warnings: string[];
  /**
   * Solo invitaciones: los errores que impiden atenderla (ID, grupo, cupo, activa, token).
   * Un teléfono, lado, contacto o notas mal capturados se reportan, pero no dejan a la familia sin confirmar.
   */
  blocking?: string[];
}

export const ACTIVE_ERROR = 'La columna "activa" debe ser sí o no.';

export function parseInvitationRow(raw: Record<string, unknown>): RowResult<InvitationRecord> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const blocking: string[] = [];
  const block = (msg: string) => {
    errors.push(msg);
    blocking.push(msg);
  };
  const id = text(raw.id);
  const group = text(raw.group).replace(/\s+/g, ' ');
  const contact = text(raw.contact).replace(/\s+/g, ' ');
  const sideRaw = stripAccents(text(raw.side).toLowerCase());
  const phoneRaw = text(raw.phone);
  const notes = text(raw.notes);
  const tokenRaw = text(raw.token);
  if (!id) block('Falta el ID de la invitación.');
  else if (!ID_RE.test(id)) block('El ID solo admite letras, números, "-" y "_" (máximo 40).');
  if (!group) block('Falta el nombre del grupo.');
  else if (group.length > 120) block('El nombre del grupo es demasiado largo (máximo 120 caracteres).');
  if (contact.length > 120) errors.push('El contacto principal es demasiado largo (máximo 120 caracteres).');
  let side: Side | null = null;
  if (sideRaw) {
    if ((SIDES as readonly string[]).indexOf(sideRaw) >= 0) side = sideRaw as Side;
    else errors.push(`El lado "${text(raw.side)}" no es válido; usa novia, novio o ambos.`);
  }
  let phone: string | null = null;
  if (phoneRaw) {
    phone = normalizePhone(phoneRaw);
    if (!phone) errors.push(`El teléfono "${phoneRaw}" no es válido (usa 10 dígitos o formato internacional).`);
  }
  let seats: number | null = null;
  const seatsText = text(raw.seats);
  if (!seatsText) warnings.push('Sin cupo asignado: no podrá confirmar hasta asignarlo.');
  else {
    const n = typeof raw.seats === 'number' ? raw.seats : Number(seatsText);
    if (!Number.isInteger(n)) block('El cupo debe ser un número entero.');
    else if (n < 1 || n > MAX_SEATS) block(`El cupo debe estar entre 1 y ${MAX_SEATS}.`);
    else seats = n;
  }
  const active = parseBool(raw.active, true);
  if (active === null) block(ACTIVE_ERROR);
  const revoked = tokenRaw.toLowerCase() === REVOKED_TOKEN;
  if (tokenRaw && !revoked && !LIVE_TOKEN_RE.test(tokenRaw) && !DEMO_TOKEN_RE.test(tokenRaw)) block('El token no tiene el formato esperado.');
  if (notes.length > 500) errors.push('Las notas son demasiado largas (máximo 500 caracteres).');
  return {
    // Un valor de "activa" no reconocido cuenta como inactiva (y se reporta como error).
    value: { id, group, side, contact: contact || null, phone, seats, active: active === true, token: revoked ? null : tokenRaw || null, notes: notes || null, revoked },
    errors,
    warnings,
    blocking,
  };
}

export function parsePersonRow(raw: Record<string, unknown>): RowResult<PersonRecord> {
  const errors: string[] = [];
  const id = text(raw.id);
  const invitationId = text(raw.invitationId);
  const name = text(raw.name).replace(/\s+/g, ' ');
  if (!id) errors.push('Falta el ID de la persona.');
  else if (!ID_RE.test(id)) errors.push('El ID de persona solo admite letras, números, "-" y "_" (máximo 40).');
  if (!invitationId) errors.push('Falta el ID de invitación de la persona.');
  if (!name) errors.push('Falta el nombre autorizado.');
  else if (name.length > 120) errors.push('El nombre es demasiado largo (máximo 120 caracteres).');
  const active = parseBool(raw.active, true);
  if (active === null) errors.push(ACTIVE_ERROR);
  return { value: { id, invitationId, name, active: active === true }, errors, warnings: [] };
}

/**
 * Orden estable de las personas de una invitación en la hoja: por ID con orden natural
 * (P2 antes que P10). Ordenar o mover filas en Sheets no cambia lo que ve la familia.
 */
export function sortPeopleById<T extends { id: string }>(people: T[]): T[] {
  return people.slice().sort((a, b) => naturalCompare(a.id, b.id));
}

/** Comparación natural sin Intl (funciona igual en Node y en Apps Script). */
export function naturalCompare(a: string, b: string): number {
  const ca = a.toLowerCase().match(/\d+|\D+/g) ?? [];
  const cb = b.toLowerCase().match(/\d+|\D+/g) ?? [];
  for (let i = 0; i < Math.min(ca.length, cb.length); i++) {
    const x = ca[i];
    const y = cb[i];
    if (x === y) continue;
    const nx = /^\d/.test(x) && /^\d/.test(y);
    if (nx) {
      const d = Number(x) - Number(y);
      if (d) return d;
      continue;
    }
    return x < y ? -1 : 1;
  }
  return ca.length - cb.length;
}

export const STATUS_LABEL: Record<RsvpStatus, string> = { attending: 'asistirá', declined: 'no asistirá' };

export function parseStatusLabel(v: unknown): RsvpStatus | null {
  const t = stripAccents(text(v).toLowerCase());
  if (t === 'asistira' || t === 'attending') return 'attending';
  if (t === 'no asistira' || t === 'declined') return 'declined';
  return null;
}

/** "P1, P2" ⇄ ["P1", "P2"]. */
export const joinIds = (ids: string[]) => ids.join(', ');
export const splitIds = (v: unknown) =>
  text(v)
    .split(/[,;\s]+/)
    .filter(Boolean);

export function parseResponseRow(raw: Record<string, unknown>): RowResult<ResponseRecord> {
  const errors: string[] = [];
  const invitationId = text(raw.invitationId);
  const status = parseStatusLabel(raw.status);
  const personIds = splitIds(raw.personIds);
  const revision = Number(text(raw.revision));
  if (!invitationId) errors.push('Falta el ID de invitación de la respuesta.');
  if (!status) errors.push('El estado debe ser "asistirá" o "no asistirá".');
  if (!Number.isInteger(revision) || revision < 1) errors.push('La revisión debe ser un entero mayor que 0.');
  if (status === 'declined' && personIds.length) errors.push('Una respuesta "no asistirá" no lleva personas seleccionadas.');
  if (status === 'attending' && !personIds.length) errors.push('Una respuesta "asistirá" necesita personas seleccionadas.');
  return {
    value: {
      invitationId,
      personIds,
      status: status ?? 'declined',
      revision: Number.isInteger(revision) ? revision : 0,
      updatedAt: text(raw.updatedAt),
      requestId: text(raw.requestId),
    },
    errors,
    warnings: [],
  };
}

// ---------------------------------------------------------------- revisión de la lista y totales

export interface RosterIssue {
  severity: 'error' | 'warning';
  tab: 'Invitaciones' | 'Personas' | 'Respuestas';
  id: string;
  message: string;
}

/**
 * Revisa la lista completa (lo que el menú "Revisar la lista" muestra en Sheets y lo que
 * la vista previa de importación aplica localmente). No combina registros por apellido
 * ni por teléfono: solo avisa.
 */
export function checkRoster(
  invitations: InvitationRecord[],
  people: PersonRecord[],
  responses: ResponseRecord[],
  opts: { live: boolean },
): RosterIssue[] {
  const issues: RosterIssue[] = [];
  const add = (severity: RosterIssue['severity'], tab: RosterIssue['tab'], id: string, message: string) =>
    issues.push({ severity, tab, id, message });
  const invById = new Map<string, InvitationRecord>();
  const tokens = new Map<string, string>();
  const phones = new Map<string, string>();
  for (const inv of invitations) {
    if (invById.has(key(inv.id))) add('error', 'Invitaciones', inv.id, 'ID de invitación repetido.');
    else invById.set(key(inv.id), inv);
    if (opts.live && DEMO_ID_RE.test(inv.id)) add('error', 'Invitaciones', inv.id, 'Este ID es de demostración; no debe estar en la lista real.');
    if (inv.token) {
      if (opts.live && !LIVE_TOKEN_RE.test(inv.token)) add('error', 'Invitaciones', inv.id, 'El token no es un enlace real válido (¿viene de la demostración?).');
      const other = tokens.get(inv.token);
      if (other) add('error', 'Invitaciones', inv.id, `Token repetido (también en ${other}).`);
      else tokens.set(inv.token, inv.id);
    } else if (inv.revoked) add('warning', 'Invitaciones', inv.id, 'Enlace revocado: genera uno nuevo con el menú si corresponde.');
    else if (inv.active) add('warning', 'Invitaciones', inv.id, 'Sin enlace personal todavía.');
    if (inv.phone) {
      const other = phones.get(inv.phone);
      if (other) add('warning', 'Invitaciones', inv.id, `Mismo teléfono que ${other}; se mantienen como invitaciones distintas.`);
      else phones.set(inv.phone, inv.id);
    }
  }
  const personIds = new Set<string>();
  const activeCount = new Map<string, number>();
  for (const p of people) {
    if (personIds.has(key(p.id))) add('error', 'Personas', p.id, 'ID de persona repetido.');
    personIds.add(key(p.id));
    if (!invById.has(key(p.invitationId))) add('error', 'Personas', p.id, `La invitación ${p.invitationId} no existe.`);
    if (p.active) activeCount.set(key(p.invitationId), (activeCount.get(key(p.invitationId)) ?? 0) + 1);
  }
  for (const inv of invById.values()) {
    if (!inv.active) continue;
    const n = activeCount.get(key(inv.id)) ?? 0;
    if (!n) add('warning', 'Invitaciones', inv.id, 'Sin personas autorizadas: no podrá confirmar asistencia.');
    else if (inv.seats !== null && n > inv.seats) {
      add('warning', 'Invitaciones', inv.id, `${n} personas autorizadas y cupo de ${inv.seats}: solo podrán confirmar ${inv.seats}.`);
    } else if (inv.seats !== null && n < inv.seats) {
      add('warning', 'Invitaciones', inv.id, `Cupo de ${inv.seats} y ${n === 1 ? '1 persona autorizada' : `${n} personas autorizadas`}: el cupo extra no se puede usar (la invitación es intransferible).`);
    }
  }
  const responded = new Set<string>();
  const personById = new Map(people.map((p) => [key(p.id), p] as const));
  for (const r of responses) {
    if (responded.has(key(r.invitationId))) add('error', 'Respuestas', r.invitationId, 'Hay más de una respuesta para esta invitación.');
    responded.add(key(r.invitationId));
    const inv = invById.get(key(r.invitationId));
    if (!inv) {
      add('error', 'Respuestas', r.invitationId, 'La invitación de esta respuesta no existe.');
      continue;
    }
    for (const pid of r.personIds) {
      const p = personById.get(key(pid));
      if (!p || key(p.invitationId) !== key(inv.id)) add('error', 'Respuestas', r.invitationId, `La persona ${pid} no pertenece a esta invitación.`);
      else if (!p.active) add('warning', 'Respuestas', r.invitationId, `La persona ${pid} está confirmada pero ya no está activa.`);
    }
    if (inv.seats !== null && r.personIds.length > inv.seats) {
      add('error', 'Respuestas', r.invitationId, `Confirma ${r.personIds.length} personas con cupo de ${inv.seats}.`);
    }
  }
  return issues;
}

export const REVIEW_MESSAGE = 'Tu invitación tiene un detalle pendiente de revisar. Escríbenos y lo resolvemos.';

interface SheetRows {
  invitations: RowResult<InvitationRecord>[];
  people: RowResult<PersonRecord>[];
  responses: RowResult<ResponseRecord>[];
}

/**
 * Problemas de la hoja que impiden atender a una invitación sin arriesgar los datos de otra.
 * La hoja se edita a mano, así que antes de leer o escribir se exige: su fila sin errores,
 * su ID único, sus personas válidas y exclusivas, y a lo sumo una respuesta válida.
 * Lista vacía = se puede atender.
 */
export function invitationBlockers(target: RowResult<InvitationRecord>, rows: SheetRows): string[] {
  const out: string[] = [];
  const id = key(target.value.id);
  const targetErrors = target.blocking ?? target.errors;
  if (targetErrors.length) out.push(`Invitación ${target.value.id}: ${targetErrors.join(' ')}`);
  if (rows.invitations.filter((r) => key(r.value.id) === id).length > 1) out.push(`ID de invitación repetido: ${target.value.id}.`);
  const own = rows.people.filter((r) => key(r.value.invitationId) === id);
  for (const p of own) {
    if (p.errors.length) out.push(`Persona ${p.value.id || '(sin ID)'}: ${p.errors.join(' ')}`);
    const sameId = rows.people.filter((r) => key(r.value.id) === key(p.value.id));
    if (sameId.length > 1) out.push(`ID de persona repetido: ${p.value.id}.`);
  }
  const responses = rows.responses.filter((r) => key(r.value.invitationId) === id);
  if (responses.length > 1) out.push('Hay más de una respuesta para esta invitación.');
  else if (responses.length === 1 && responses[0].errors.length) out.push(`Respuesta: ${responses[0].errors.join(' ')}`);
  return out;
}

/** Errores de formato de cada fila, para la revisión de la lista y el panel. */
export function rowIssues(rows: SheetRows): RosterIssue[] {
  const issues: RosterIssue[] = [];
  const push = (tab: RosterIssue['tab'], id: string, errors: string[]) => {
    for (const message of errors) issues.push({ severity: 'error', tab, id: id || '(sin ID)', message });
  };
  rows.invitations.forEach((r) => push('Invitaciones', r.value.id, r.errors));
  rows.people.forEach((r) => push('Personas', r.value.id, r.errors));
  rows.responses.forEach((r) => push('Respuestas', r.value.invitationId, r.errors));
  return issues;
}

export interface RosterSummary {
  invitations: number;
  incomplete: number;
  seatsAssigned: number;
  people: number;
  attendingPeople: number;
  attending: number;
  declined: number;
  pending: number;
  /** Lugares asignados que una respuesta ya dejó sin usar; quedan a decisión de los novios. */
  unusedSeats: number;
}

/** Totales derivados del registro vigente (invitaciones activas). */
export function summarize(invitations: InvitationRecord[], people: PersonRecord[], responses: ResponseRecord[]): RosterSummary {
  const active = invitations.filter((i) => i.active);
  const activeIds = new Set(active.map((i) => key(i.id)));
  const activePeople = new Map(people.filter((p) => p.active && activeIds.has(key(p.invitationId))).map((p) => [key(p.id), p] as const));
  const byInv = new Map(responses.map((r) => [key(r.invitationId), r] as const));
  const s: RosterSummary = { invitations: active.length, incomplete: 0, seatsAssigned: 0, people: activePeople.size, attendingPeople: 0, attending: 0, declined: 0, pending: 0, unusedSeats: 0 };
  for (const inv of active) {
    if (inv.seats === null) s.incomplete++;
    else s.seatsAssigned += inv.seats;
    const r = byInv.get(key(inv.id));
    if (!r) {
      s.pending++;
      continue;
    }
    const n = r.status === 'attending' ? r.personIds.filter((id) => activePeople.get(key(id))?.invitationId.toLowerCase() === key(inv.id)).length : 0;
    if (r.status === 'attending') {
      s.attending++;
      s.attendingPeople += n;
    } else s.declined++;
    if (inv.seats !== null) s.unusedSeats += Math.max(0, inv.seats - n);
  }
  return s;
}

// ---------------------------------------------------------------- conector servidor ⇄ Apps Script

/** Únicas operaciones que acepta el conector. No hay lectura ni escritura de rangos arbitrarios. */
export const CONNECTOR_OPS = ['ping', 'getInvitation', 'saveResponse', 'summary'] as const;
export type ConnectorOp = (typeof CONNECTOR_OPS)[number];
export const CONNECTOR_VERSION = 1;
/** Margen de reloj aceptado entre el servidor y Apps Script. */
export const CONNECTOR_MAX_SKEW_MS = 5 * 60_000;

/** Texto que se firma con HMAC-SHA256 en ambos sentidos. */
export const signingString = (parts: (string | number)[]) => parts.map(String).join('\n');
