/**
 * Cliente del conector servidor ⇄ Apps Script (Google Sheets privado).
 *
 * - Solo envía operaciones explícitas de CONNECTOR_OPS; no hay lectura ni escritura de rangos.
 * - Firma cada solicitud con HMAC-SHA256 (secreto compartido, solo en el servidor y en las
 *   propiedades privadas del script) y exige una respuesta firmada que repita la operación y el nonce.
 * - Sigue a mano las redirecciones de Apps Script (POST /exec → 302 → GET googleusercontent),
 *   solo hacia hosts de Google Apps Script, y trata cualquier otra cosa como error.
 * - Nunca toma una respuesta opaca o no verificable como prueba de que algo se guardó.
 */
import crypto from 'node:crypto';
import { CONNECTOR_VERSION, signingString, type ConnectorOp } from '../../shared/rsvp-rules.js';

export interface SheetsConfig {
  url: string;
  secret: string;
  timeoutMs: number;
}

export interface FetchResponseLike {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}
export type FetchLike = (
  url: string,
  init: { method: 'GET' | 'POST'; headers?: Record<string, string>; body?: string; redirect: 'manual'; signal?: AbortSignal },
) => Promise<FetchResponseLike>;

export class ConnectorError extends Error {
  constructor(
    public code: string,
    message: string,
    public retryable: boolean,
  ) {
    super(message);
  }
}

/** Respuesta ya verificada del script. */
export type ScriptResult<T> =
  | { ok: true; result: T }
  | { ok: false; status?: number; code: string; message: string; retryable?: boolean; current?: unknown };

const ALLOWED_HOSTS = new Set(['script.google.com', 'script.googleusercontent.com']);
const WEBAPP_RE = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,}\/exec$/;
export const MIN_SECRET_LENGTH = 32;

/** Valida la configuración; devuelve el motivo si no sirve. */
export function sheetsConfigProblem(url: string | null, secret: string | null): string | null {
  if (!url) return 'Falta SHEETS_WEBAPP_URL (URL /exec de la implementación de Apps Script).';
  if (!WEBAPP_RE.test(url)) return 'SHEETS_WEBAPP_URL debe tener la forma https://script.google.com/macros/s/…/exec.';
  if (!secret) return 'Falta SHEETS_SHARED_SECRET.';
  if (secret.length < MIN_SECRET_LENGTH) return `SHEETS_SHARED_SECRET debe tener al menos ${MIN_SECRET_LENGTH} caracteres.`;
  return null;
}

const hmacHex = (secret: string, text: string) => crypto.createHmac('sha256', secret).update(text, 'utf8').digest('hex');
const sameHex = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function createSheetsClient(cfg: SheetsConfig, fetchImpl: FetchLike = fetch as unknown as FetchLike) {
  async function call<T>(op: ConnectorOp, payload: unknown): Promise<ScriptResult<T>> {
    const ts = Date.now();
    const nonce = crypto.randomBytes(16).toString('base64url');
    const payloadJson = JSON.stringify(payload ?? {});
    const sig = hmacHex(cfg.secret, signingString(['req', CONNECTOR_VERSION, op, ts, nonce, payloadJson]));
    const body = JSON.stringify({ v: CONNECTOR_VERSION, op, ts, nonce, payload: payloadJson, sig });
    const signal = AbortSignal.timeout(cfg.timeoutMs);

    let url = cfg.url;
    let res: FetchResponseLike | null = null;
    let method: 'GET' | 'POST' = 'POST';
    for (let hop = 0; hop < 4; hop++) {
      try {
        res = await fetchImpl(url, {
          method,
          headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
          body: method === 'POST' ? body : undefined,
          redirect: 'manual',
          signal,
        });
      } catch (err) {
        const timeout = (err as Error)?.name === 'TimeoutError' || (err as Error)?.name === 'AbortError';
        throw new ConnectorError(timeout ? 'timeout' : 'network', timeout ? 'Apps Script no respondió a tiempo.' : 'No se pudo conectar con Apps Script.', true);
      }
      if (![301, 302, 303].includes(res.status)) break;
      const location = res.headers.get('location');
      let next: URL;
      try {
        next = new URL(location ?? '', url);
      } catch {
        throw new ConnectorError('bad_redirect', 'Apps Script devolvió una redirección inválida.', true);
      }
      if (next.hostname === 'accounts.google.com') {
        throw new ConnectorError('auth_required', 'La implementación de Apps Script pide iniciar sesión: debe publicarse con acceso "Cualquier persona".', false);
      }
      if (next.protocol !== 'https:' || !ALLOWED_HOSTS.has(next.hostname)) {
        throw new ConnectorError('bad_redirect', `Redirección hacia un host no permitido (${next.hostname}).`, false);
      }
      // 301/302/303 tras un POST se siguen con GET y sin cuerpo (así entrega Apps Script el resultado).
      url = next.toString();
      method = 'GET';
      res = null;
    }
    if (!res) throw new ConnectorError('too_many_redirects', 'Demasiadas redirecciones desde Apps Script.', true);
    if (res.status !== 200) {
      throw new ConnectorError(`http_${res.status}`, `Apps Script respondió con estado ${res.status}.`, res.status >= 500 || res.status === 429);
    }
    let parsed: { v?: unknown; op?: unknown; nonce?: unknown; data?: unknown; sig?: unknown; ok?: unknown; code?: unknown };
    try {
      parsed = JSON.parse(await res.text());
    } catch {
      throw new ConnectorError('bad_response', 'Apps Script no devolvió JSON (¿implementación o permisos incorrectos?).', true);
    }
    if (parsed && parsed.ok === false && parsed.code === 'unauthorized' && parsed.sig === undefined) {
      throw new ConnectorError('unauthorized', 'Apps Script rechazó la firma: el secreto del servidor y el del script no coinciden.', false);
    }
    if (
      !parsed ||
      parsed.v !== CONNECTOR_VERSION ||
      parsed.op !== op ||
      parsed.nonce !== nonce ||
      typeof parsed.data !== 'string' ||
      typeof parsed.sig !== 'string'
    ) {
      throw new ConnectorError('unverifiable', 'La respuesta de Apps Script no corresponde a esta solicitud.', true);
    }
    const expected = hmacHex(cfg.secret, signingString(['res', CONNECTOR_VERSION, op, nonce, parsed.data]));
    if (!sameHex(expected, parsed.sig)) throw new ConnectorError('bad_signature', 'La firma de la respuesta de Apps Script no es válida.', false);
    try {
      return JSON.parse(parsed.data) as ScriptResult<T>;
    } catch {
      throw new ConnectorError('bad_response', 'El contenido firmado de Apps Script no es JSON.', true);
    }
  }
  return { call };
}

export type SheetsClient = ReturnType<typeof createSheetsClient>;
