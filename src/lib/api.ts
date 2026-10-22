import type { PublicInvitation, RsvpInput } from '../../shared/types';

export class ApiFailure extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

const GENERIC = 'No pudimos comunicarnos con el servidor. Revisa tu conexión e inténtalo de nuevo.';

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
    throw new ApiFailure(d.error ?? 'server', d.message ?? GENERIC, res.status);
  }
  return data as T;
}

export const fetchInvitation = (token: string) =>
  request<PublicInvitation>(`/api/invitations/${encodeURIComponent(token)}`);

export const saveRsvp = (token: string, input: RsvpInput) =>
  request<PublicInvitation>(`/api/invitations/${encodeURIComponent(token)}/rsvp`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
