import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { ADMIN_PASSWORD, BASE_DISABLED, elementShot, skipEnvelope } from './helpers';

const SHOTS = 'docs/capturas';
fs.mkdirSync(SHOTS, { recursive: true });

test.use({ baseURL: BASE_DISABLED });

test('(9) producción sin registro: no cae a la demostración ni simula éxitos', async ({ page, request }, info) => {
  const health = await (await request.get('/api/health')).json();
  expect(health.rsvp).toBe('disabled');
  // Un enlace con forma de enlace real y uno de demostración: ninguno se consulta ni se guarda.
  for (const token of ['AbCdEfGhIjKlMnOpQrStUvWx', 'demo_AbCdEfGhIjKlMnOpQrStUvWx']) {
    const get = await request.get(`/api/invitations/${token}`);
    expect(get.status()).toBe(503);
    expect((await get.json()).error).toBe('rsvp_not_enabled');
    const put = await request.put(`/api/invitations/${token}/rsvp`, { data: { status: 'declined', personIds: [], expectedRevision: 0, requestId: 'sin-registro-01' } });
    expect(put.status()).toBe(503);
  }

  await page.goto('/i/AbCdEfGhIjKlMnOpQrStUvWx#confirmar');
  await expect(page.getByTestId('rsvp-not-enabled')).toContainText('La confirmación en línea todavía no está habilitada');
  await expect(page.getByTestId('rsvp-form')).toHaveCount(0);
  await expect(page.getByTestId('rsvp-saved')).toHaveCount(0);
  await expect(page.getByTestId('mode-banner')).toHaveCount(0);
  await elementShot(page, page.getByTestId('rsvp-not-enabled'), `${SHOTS}/${info.project.name}-12-sin-registro.png`);

  await page.goto('/');
  await skipEnvelope(page);
  await expect(page.getByTestId('rsvp-general')).toBeVisible();

  // El panel dice que no hay registro y no ofrece administrar una lista local.
  await page.goto('/admin');
  await page.getByLabel('Contraseña').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Sin registro de confirmaciones' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nueva invitación' })).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-13-admin-sin-registro.png`, fullPage: true });
});
