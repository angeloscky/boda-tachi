import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { skipEnvelope } from './helpers';

// Vista estática (maqueta sin servidor): se compila y se sirve desde disco, sin API.
const OUT = path.resolve('dist/static-demo');
const ORIGIN = 'http://maqueta.test';

test.beforeAll(() => {
  execSync('npx vite build --mode static', { stdio: 'ignore' });
});

test.beforeEach(async ({ page }) => {
  await page.route(`${ORIGIN}/**`, (route) => {
    const rel = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.join(OUT, rel);
    if (!file.startsWith(OUT) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ path: file });
  });
});

test('vista estática: recorre el formulario y dice que la respuesta no se registró', async ({ page }) => {
  const apiCalls: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/')) apiCalls.push(r.url());
  });
  await page.goto(`${ORIGIN}/index.html`);
  await skipEnvelope(page);
  await expect(page.getByTestId('mode-banner')).toContainText('Vista de diseño sin servidor');
  await page.getByRole('link', { name: 'Confirmar', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Ana Robles Ejemplo' }).check();
  await page.getByRole('button', { name: 'Revisar respuesta' }).click();
  await page.getByRole('button', { name: 'Confirmar y guardar' }).click();
  await expect(page.getByTestId('rsvp-review')).toContainText('esta respuesta no se registró');
  await expect(page.getByTestId('rsvp-saved')).toHaveCount(0);
  expect(apiCalls).toEqual([]);

  // #general muestra la página general, sin formulario.
  await page.goto(`${ORIGIN}/index.html#general`);
  await page.reload(); // el sobre ya se abrió en esta pestaña
  await expect(page.getByTestId('rsvp-general')).toBeVisible();
  await expect(page.getByTestId('rsvp-form')).toHaveCount(0);
});
