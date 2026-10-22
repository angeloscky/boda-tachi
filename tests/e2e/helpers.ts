import type { APIRequestContext } from '@playwright/test';

export const ADMIN_PASSWORD = 'e2e-contraseña-123';

export async function adminLogin(request: APIRequestContext) {
  const r = await request.post('/api/admin/login', { data: { password: ADMIN_PASSWORD } });
  if (!r.ok()) throw new Error(`login ${r.status()}`);
}

/** Crea una invitación sintética con identificador único. */
export async function seedInvitation(request: APIRequestContext, name: string, seats: number | null) {
  await adminLogin(request);
  const code = `E2E-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const r = await request.post('/api/admin/invitations', { data: { code, name, seats, isDemo: true } });
  if (r.status() !== 201) throw new Error(`alta ${r.status()} ${await r.text()}`);
  return (await r.json()) as { id: number; token: string; link: string; code: string };
}
