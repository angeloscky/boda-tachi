import type { PublicInvitation, RsvpRequest, SaveRsvpResult } from '../../shared/types';

export class ApiFailure extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    /** Cuerpo completo del error (p. ej. la respuesta vigente en un conflicto). */
    public body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

const GENERIC = 'No pudimos comunicarnos con el servidor. Revisa tu conexión e inténtalo de nuevo.';
const SERVER_DOWN = 'El servidor no respondió correctamente. Inténtalo de nuevo en un momento.';

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      credentials: 'same-origin',
      headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
    });
  } catch {
    throw new ApiFailure('network', GENERIC, 0);
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* respuesta sin JSON */
  }
  if (!res.ok) {
    const d = (data ?? {}) as { error?: string; message?: string };
    throw new ApiFailure(d.error ?? 'server', d.message ?? SERVER_DOWN, res.status, (data ?? {}) as Record<string, unknown>);
  }
  // Un 200 sin el cuerpo esperado tampoco cuenta como guardado.
  if (data === null) throw new ApiFailure('server', SERVER_DOWN, res.status);
  return data as T;
}

export const fetchInvitation = (token: string) => request<PublicInvitation>(`/api/invitations/${encodeURIComponent(token)}`);

export async function saveRsvp(token: string, input: RsvpRequest): Promise<SaveRsvpResult> {
  const out = await request<SaveRsvpResult>(`/api/invitations/${encodeURIComponent(token)}/rsvp`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
  if (!out?.invitation?.response || !['saved', 'unchanged', 'replay'].includes(out.outcome)) throw new ApiFailure('server', SERVER_DOWN, 200);
  return out;
}

/** Identificador de solicitud: el mismo en los reintentos de un mismo envío, para no duplicar. */
export function newRequestId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
