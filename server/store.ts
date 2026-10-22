/**
 * Almacenamiento de las confirmaciones, intercambiable:
 * - demo: adaptador local (SQLite) con datos ficticios.
 * - sheets: conector a Apps Script + Google Sheets privado (preparado; no conectado todavía).
 * - disabled: sin registro configurado. La confirmación aparece como no habilitada y nunca
 *   cae en silencio a la demostración ni devuelve éxitos ficticios.
 */
import type { BackendStatus, PublicInvitation, SaveRsvpResult } from '../shared/types.js';
import {
  LIVE_TOKEN_RE,
  NOT_FOUND_MESSAGE,
  toGuestView,
  type PersonRecord,
  type ResponseRecord,
  type RosterIssue,
  type RosterSummary,
  type RsvpRequest,
} from '../shared/rsvp-rules.js';
import type { DB } from './db.js';
import { HttpError } from './errors.js';
import { getGuestInvitation, getSummary, saveGuestResponse } from './invitations.js';
import { ConnectorError, type SheetsClient } from './sheets/client.js';

export interface GuestStore {
  readonly mode: BackendStatus['mode'];
  /** Lo que la interfaz muestra al invitado: demo, live o disabled. */
  readonly uiMode: 'demo' | 'live' | 'disabled';
  getInvitation(token: string): Promise<PublicInvitation>;
  saveResponse(token: string, req: RsvpRequest): Promise<SaveRsvpResult>;
  status(): Promise<BackendStatus>;
}

export function createLocalStore(db: DB): GuestStore {
  return {
    mode: 'demo',
    uiMode: 'demo',
    getInvitation: async (token) => getGuestInvitation(db, token),
    saveResponse: async (token, req) => saveGuestResponse(db, token, req),
    status: async () => ({
      mode: 'demo',
      ready: true,
      detail: 'Demostración local con datos ficticios (SQLite). No es el registro de producción.',
      canManageList: true,
      summary: getSummary(db),
    }),
  };
}

const NOT_ENABLED = 'La confirmación en línea todavía no está habilitada.';

/** Sin registro: ni se lee ni se escribe nada. */
export function createDisabledStore(mode: 'disabled' | 'sheets', detail: string): GuestStore {
  const fail = async (): Promise<never> => {
    throw new HttpError(503, 'rsvp_not_enabled', NOT_ENABLED);
  };
  return {
    mode,
    uiMode: 'disabled',
    getInvitation: fail,
    saveResponse: fail,
    status: async () => ({ mode, ready: false, detail, canManageList: false }),
  };
}

interface ScriptInvitation {
  invitation: { group: string; seats: number | null };
  people: PersonRecord[];
  response: ResponseRecord | null;
  rsvpOpen: boolean;
}

function viewFrom(result: ScriptInvitation): PublicInvitation {
  if (!result || !result.invitation || !Array.isArray(result.people)) {
    throw new ConnectorError('bad_result', 'Apps Script devolvió un resultado incompleto.', true);
  }
  return { ...toGuestView(result.invitation, result.people, result.response, result.rsvpOpen === true), mode: 'live' };
}

export function createSheetsStore(client: SheetsClient, log: (msg: string) => void = console.error): GuestStore {
  /** Cualquier falla del conector es reintentable para el invitado y nunca se muestra como éxito. */
  async function call<T>(op: Parameters<SheetsClient['call']>[0], payload: unknown, unavailable: string) {
    try {
      return await client.call<T>(op, payload);
    } catch (err) {
      const e = err instanceof ConnectorError ? err : new ConnectorError('unknown', String((err as Error)?.message ?? err), true);
      log(`[sheets] ${op}: ${e.code} · ${e.message}`);
      throw new HttpError(503, 'storage_unavailable', unavailable);
    }
  }
  const scriptError = (data: { status?: number; code: string; message: string; retryable?: boolean }, unavailable: string) => {
    if (data.retryable || !data.status || data.status >= 500) {
      console.error(`[sheets] ${data.code}: ${data.message}`);
      return new HttpError(503, 'storage_unavailable', unavailable);
    }
    return new HttpError(data.status, data.code, data.message);
  };

  return {
    mode: 'sheets',
    uiMode: 'live',
    async getInvitation(token) {
      // Un enlace de demostración nunca se consulta en el registro real.
      if (!LIVE_TOKEN_RE.test(token)) throw new HttpError(404, 'not_found', NOT_FOUND_MESSAGE);
      const unavailable = 'No pudimos cargar tu invitación en este momento. Inténtalo de nuevo.';
      const data = await call<ScriptInvitation>('getInvitation', { token }, unavailable);
      if (!data.ok) throw scriptError(data, unavailable);
      return viewFrom(data.result);
    },
    async saveResponse(token, req) {
      if (!LIVE_TOKEN_RE.test(token)) throw new HttpError(404, 'not_found', NOT_FOUND_MESSAGE);
      const unavailable = 'No pudimos guardar tu respuesta en este momento. No se registró; inténtalo de nuevo.';
      const data = await call<ScriptInvitation & { outcome: SaveRsvpResult['outcome'] }>('saveResponse', { token, request: req }, unavailable);
      if (!data.ok) {
        if (data.code === 'conflict' && data.current) {
          throw new HttpError(409, 'conflict', data.message, { current: viewFrom(data.current as ScriptInvitation) });
        }
        throw scriptError(data, unavailable);
      }
      const outcome = data.result.outcome;
      if (outcome !== 'saved' && outcome !== 'unchanged' && outcome !== 'replay') {
        throw new HttpError(503, 'storage_unavailable', unavailable);
      }
      return { invitation: viewFrom(data.result), outcome };
    },
    async status() {
      try {
        const data = await client.call<{ summary: RosterSummary & { rsvpOpen: boolean }; issues: RosterIssue[] }>('summary', {});
        if (!data.ok) return { mode: 'sheets', ready: false, detail: `Apps Script respondió: ${data.message}`, canManageList: false };
        return {
          mode: 'sheets',
          ready: true,
          detail: 'Conectado a Google Sheets mediante Apps Script.',
          canManageList: false,
          summary: data.result.summary,
          issues: data.result.issues,
        };
      } catch (err) {
        const msg = err instanceof ConnectorError ? err.message : 'Error desconocido.';
        return { mode: 'sheets', ready: false, detail: `Sin conexión con Apps Script: ${msg}`, canManageList: false };
      }
    },
  };
}
