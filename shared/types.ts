import type { GuestView, RosterSummary, RsvpStatus, Side } from './rsvp-rules.js';

export type { RsvpRequest, RsvpStatus, Side } from './rsvp-rules.js';

export type AttendanceStatus = 'pending' | RsvpStatus;
export type CommStatus = 'none' | 'prepared' | 'sent' | 'delivered' | 'failed';

/** Dónde se guardan las confirmaciones. */
export type BackendMode = 'demo' | 'sheets' | 'disabled';

/** Lo que ve un invitado al abrir su enlace. Solo datos de su propia invitación. */
export interface PublicInvitation extends GuestView {
  /** demo: datos ficticios y respuestas de prueba; live: registro real. */
  mode: 'demo' | 'live';
}

export interface SaveRsvpResult {
  invitation: PublicInvitation;
  /** saved: nueva revisión; unchanged: igual a la vigente; replay: la misma solicitud ya estaba guardada. */
  outcome: 'saved' | 'unchanged' | 'replay';
}

export interface AdminPerson {
  id: string;
  name: string;
  active: boolean;
}

export interface AdminInvitation {
  id: number;
  /** id_invitacion estable. */
  code: string;
  side: Side | null;
  /** Nombre del grupo. */
  name: string;
  contact: string | null;
  phone: string | null;
  seats: number | null;
  token: string;
  linkRevoked: boolean;
  enabled: boolean;
  notes: string | null;
  people: AdminPerson[];
  attendance: AttendanceStatus;
  selectedPersonIds: string[];
  attendingCount: number;
  revision: number;
  respondedAt: string | null;
  responseSource: 'guest' | 'admin' | null;
  comm: { status: CommStatus; source: string | null; at: string | null };
  createdAt: string;
  updatedAt: string;
}

export interface AdminSummary extends RosterSummary {
  rsvpOpen: boolean;
}

export interface BackendStatus {
  mode: BackendMode;
  ready: boolean;
  detail: string;
  /** Solo la demostración local administra la lista desde este panel; con Sheets se hace en la hoja. */
  canManageList: boolean;
  summary?: AdminSummary;
  issues?: { severity: 'error' | 'warning'; tab: string; id: string; message: string }[];
}

export interface ImportRowResult {
  tab: 'Invitaciones' | 'Personas';
  line: number;
  id: string;
  label: string;
  action: 'create' | 'update' | 'unchanged' | 'error';
  errors: string[];
  warnings: string[];
}

export interface ImportPreview {
  rows: ImportRowResult[];
  /** Avisos sobre el resultado completo (p. ej. más personas que cupo). */
  general: string[];
  canApply: boolean;
  counts: { create: number; update: number; unchanged: number; error: number };
}

export interface ApiError {
  error: string;
  message: string;
}
