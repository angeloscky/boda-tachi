import type { APIRequestContext, Locator, Page } from '@playwright/test';

export const ADMIN_PASSWORD = 'e2e-contraseña-123';
export const BASE = 'http://localhost:3200';
/** Segundo servidor, sin registro configurado (producción sin Google). */
export const BASE_DISABLED = 'http://localhost:3201';

export async function adminLogin(request: APIRequestContext) {
  const r = await request.post('/api/admin/login', { data: { password: ADMIN_PASSWORD } });
  if (!r.ok()) throw new Error(`login ${r.status()}`);
}

export interface Seeded {
  id: number;
  token: string;
  link: string;
  code: string;
  people: { id: string; name: string; active: boolean }[];
}

/** Crea una invitación ficticia (demostración local) con sus personas autorizadas. */
export async function seedInvitation(request: APIRequestContext, name: string, seats: number | null, people: string[] = []) {
  await adminLogin(request);
  const code = `E2E-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const r = await request.post('/api/admin/invitations', { data: { code, name, seats, people: people.map((n) => ({ name: n })) } });
  if (r.status() !== 201) throw new Error(`alta ${r.status()} ${await r.text()}`);
  return (await r.json()) as Seeded;
}

export async function adminRow(request: APIRequestContext, id: number) {
  await adminLogin(request);
  return (await (await request.get(`/api/admin/invitations/${id}`)).json()) as {
    attendance: string;
    seats: number | null;
    selectedPersonIds: string[];
    attendingCount: number;
    revision: number;
    people: { id: string; name: string; active: boolean }[];
  };
}

/** Sustituye navigator.share para registrar qué se compartiría, sin abrir el menú del sistema. */
export async function stubShare(page: Page, available = true) {
  await page.addInitScript((ok) => {
    const w = window as unknown as { __shared: unknown[] };
    w.__shared = [];
    if (ok) {
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async (data: unknown) => {
          w.__shared.push(data);
        },
      });
    } else {
      Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    }
  }, available);
}

export const shared = (page: Page) => page.evaluate(() => (window as unknown as { __shared: { url: string; title?: string; text?: string }[] }).__shared);

/** Abre el sobre sin animación. */
export async function skipEnvelope(page: Page) {
  await page.getByRole('button', { name: 'Ver la invitación sin animación' }).click();
}

/** Captura de un elemento sin las barras fijas encima (aviso, navegación inferior, salto). */
export async function elementShot(page: Page, el: Locator, path: string) {
  const hide = (v: string) =>
    page.evaluate((vis) => {
      document.querySelectorAll<HTMLElement>('.bottom-nav, .demo-banner, .skip-link').forEach((e) => (e.style.visibility = vis));
    }, v);
  await hide('hidden');
  await el.screenshot({ path });
  await hide('');
}
