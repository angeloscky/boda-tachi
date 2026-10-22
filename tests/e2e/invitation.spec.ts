import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { adminLogin, seedInvitation, ADMIN_PASSWORD } from './helpers';

const SHOTS = 'docs/capturas';
fs.mkdirSync(SHOTS, { recursive: true });

test('(1)(3) recorrido completo: abrir, consultar, confirmar y volver a abrir', async ({ page, request }, info) => {
  const inv = await seedInvitation(request, 'Familia Prueba Recorrido', 3);
  await page.goto(`/i/${inv.token}`);

  const seal = page.getByRole('button', { name: 'Abrir invitación' });
  await expect(seal).toBeVisible();
  await expect(page.getByText('Para Familia Prueba Recorrido')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-01-sobre.png` });
  await seal.click();
  await expect(page.getByRole('dialog', { name: 'Apertura de la invitación' })).toBeHidden({ timeout: 5000 });
  await expect(page.getByRole('heading', { level: 1, name: /Sofía e Isaac/ })).toBeVisible();
  await expect(page.getByText('Invitación para')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-02-portada.png` });

  // Contenido y datos del evento
  await expect(page.getByText('Queremos compartir este día contigo.')).toBeVisible();
  for (const name of ['Bibiano Vázquez Mora', 'María Jesús González Hernández', 'Elena Aguilar Cervantes', 'Carlos Patzka Aguirre', 'Gerardo Vázquez Mora', 'Alma Idalia Villalobos González']) {
    await expect(page.getByText(name, { exact: false }).first()).toBeAttached();
  }
  await expect(page.getByText('Te invitamos a vestir completamente de negro.')).toBeAttached();
  await expect(page.getByText(/solo para adultos/).first()).toBeAttached();

  // Enlaces externos: destino correcto, pestaña nueva y sin filtrar el enlace personal
  const links = {
    'maps-ceremonia': 'https://maps.app.goo.gl/v6wqtCa2jvmqhKu56',
    'maps-recepcion': 'https://www.google.com/maps/?cid=10313593131170748878',
    'gift-liverpool': 'https://mesaderegalos.liverpool.com.mx/milistaderegalos/60031248',
  };
  for (const [id, href] of Object.entries(links)) {
    const a = page.getByTestId(id);
    await expect(a).toHaveAttribute('href', href);
    await expect(a).toHaveAttribute('target', '_blank');
    await expect(a).toHaveAttribute('rel', /noopener/);
    await expect(a).toHaveAttribute('rel', /noreferrer/);
  }
  const popupPromise = page.waitForEvent('popup');
  // No se visita el sitio real durante la prueba: se intercepta la pestaña nueva.
  await page.context().route(/maps\.app\.goo\.gl|google\.com\/maps|liverpool\.com\.mx/, (r) => r.fulfill({ status: 200, body: 'ok' }));
  await page.getByTestId('maps-ceremonia').click();
  const popup = await popupPromise;
  expect(popup.url()).toContain('maps.app.goo.gl/v6wqtCa2jvmqhKu56');
  await popup.close();

  // Captura de página completa: sin foco residual y sin la barra fija (que quedaría a media página).
  await page.evaluate(() => {
    document.querySelectorAll('.reveal').forEach((e) => e.classList.add('in'));
    (document.activeElement as HTMLElement | null)?.blur();
    document.querySelector<HTMLElement>('.bottom-nav')!.style.visibility = 'hidden';
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-03-invitacion-completa.png`, fullPage: true });
  await page.evaluate(() => (document.querySelector<HTMLElement>('.bottom-nav')!.style.visibility = ''));

  // Confirmación
  await page.getByRole('link', { name: 'Confirmar', exact: true }).click();
  await page.getByLabel('Sí, asistiremos').check();
  await page.getByLabel('2 adultos').check();
  await page.getByRole('button', { name: 'Enviar confirmación' }).click();
  const saved = page.getByTestId('rsvp-saved');
  await expect(saved).toContainText('Recibimos tu respuesta');
  await expect(saved).toContainText('Asistirán 2 adultos');
  await saved.screenshot({ path: `${SHOTS}/${info.project.name}-04-confirmacion-guardada.png` });

  // Volver a abrir el enlace: la respuesta está registrada y se puede cambiar
  await page.goto(`/i/${inv.token}#confirmar`);
  await page.reload();
  await expect(page.getByTestId('rsvp-saved')).toContainText('Tu respuesta está registrada');
  await expect(page.getByTestId('rsvp-saved')).toContainText('Asistirán 2 adultos');
  await page.getByRole('button', { name: 'Cambiar mi respuesta' }).click();
  await expect(page.getByLabel('2 adultos')).toBeChecked();
  await page.getByLabel('3 adultos').check();
  await page.getByRole('button', { name: 'Actualizar mi respuesta' }).click();
  await expect(page.getByTestId('rsvp-saved')).toContainText('Asistirán 3 adultos');

  // El administrador la consulta
  await adminLogin(request);
  const row = await (await request.get(`/api/admin/invitations/${inv.id}`)).json();
  expect(row).toMatchObject({ attendance: 'attending', adults: 3 });
});

test('(9) si el servidor falla no se muestra éxito, se conservan los datos y se puede reintentar', async ({ page, request }) => {
  const inv = await seedInvitation(request, 'Familia Prueba Fallo', 2);
  await page.goto(`/i/${inv.token}#confirmar`);
  await page.route('**/api/invitations/*/rsvp', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"server_error","message":"Ocurrió un error en el servidor. Inténtalo de nuevo."}' }));
  await page.getByLabel('Sí, asistiremos').check();
  await page.getByLabel('2 adultos').check();
  await page.getByRole('button', { name: 'Enviar confirmación' }).click();
  await expect(page.getByRole('alert')).toContainText('Tu respuesta no se ha guardado');
  await expect(page.getByTestId('rsvp-saved')).toHaveCount(0);
  await expect(page.getByLabel('Sí, asistiremos')).toBeChecked();
  await expect(page.getByLabel('2 adultos')).toBeChecked();

  // Sin conexión: mismo comportamiento
  await page.unroute('**/api/invitations/*/rsvp');
  await page.route('**/api/invitations/*/rsvp', (r) => r.abort('internetdisconnected'));
  await page.getByRole('button', { name: 'Enviar confirmación' }).click();
  await expect(page.getByRole('alert')).toContainText('No pudimos comunicarnos con el servidor');
  await expect(page.getByTestId('rsvp-saved')).toHaveCount(0);

  await adminLogin(request);
  expect((await (await request.get(`/api/admin/invitations/${inv.id}`)).json()).attendance).toBe('pending');

  await page.unroute('**/api/invitations/*/rsvp');
  await page.getByRole('button', { name: 'Enviar confirmación' }).click();
  await expect(page.getByTestId('rsvp-saved')).toContainText('Asistirán 2 adultos');
  expect((await (await request.get(`/api/admin/invitations/${inv.id}`)).json()).adults).toBe(2);
});

test('(5) un doble toque en enviar deja una sola respuesta', async ({ page, request }) => {
  const inv = await seedInvitation(request, 'Familia Doble Toque', 2);
  await page.goto(`/i/${inv.token}#confirmar`);
  let puts = 0;
  await page.route('**/api/invitations/*/rsvp', async (r) => {
    puts++;
    await new Promise((res) => setTimeout(res, 400));
    await r.continue();
  });
  await page.getByLabel('No podremos asistir').check();
  const btn = page.getByRole('button', { name: 'Enviar confirmación' });
  await btn.dblclick();
  await expect(page.getByTestId('rsvp-saved')).toContainText('no podrán asistir');
  expect(puts).toBe(1);
});

test('(2) navegación por teclado y movimiento reducido', async ({ browser, request }, info) => {
  const inv = await seedInvitation(request, 'Familia Teclado', 2);
  const context = await browser.newContext({ ...(info.project.use as object), reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto(`/i/${inv.token}`);
  const seal = page.getByRole('button', { name: 'Abrir invitación' });
  await expect(seal).toBeFocused();
  // Con el sobre abierto, Tab no sale hacia el contenido oculto
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => !!document.activeElement?.closest('main'))).toBe(false);
  await seal.focus();
  await page.keyboard.press('Enter');
  // Con movimiento reducido el sobre se abre al instante.
  await expect(page.getByRole('dialog', { name: 'Apertura de la invitación' })).toBeHidden({ timeout: 800 });
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Ir a confirmar asistencia' });
  await expect(skip).toBeFocused();
  const box = await skip.boundingBox();
  expect(box && box.y >= 0 && box.height > 20).toBeTruthy(); // visible al recibir el foco
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#confirmar$/);
  // Llegar a la confirmación y responder solo con teclado
  const yes = page.getByLabel('Sí, asistiremos');
  await yes.focus();
  await page.keyboard.press('Space');
  await expect(yes).toBeChecked();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Space');
  await expect(page.getByLabel('1 adulto')).toBeChecked();
  await page.getByRole('button', { name: 'Enviar confirmación' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('rsvp-saved')).toBeVisible();
  // Escape omite la animación
  const p2 = await context.newPage();
  await p2.goto(`/i/${inv.token}`);
  await p2.evaluate(() => sessionStorage.clear());
  await p2.reload();
  await p2.keyboard.press('Escape');
  await expect(p2.getByRole('dialog', { name: 'Apertura de la invitación' })).toBeHidden();
  await context.close();
});

test('página general, enlace inexistente e invitación sin lugares', async ({ page, request }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Ver la invitación sin animación' }).click();
  await expect(page.getByText('Confirma con tu enlace personal')).toBeVisible();
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', 'Sofía e Isaac · 22 de mayo de 2027');

  await page.goto('/i/ZZZZZZZZZZZZZZZZZZZZZZZZ#confirmar');
  await expect(page.getByRole('alert')).toContainText('No encontramos esta invitación');
  // Un enlace truncado también avisa, en la portada y en la confirmación
  await page.goto('/i/abc#confirmar');
  await expect(page.getByRole('alert')).toContainText('No encontramos esta invitación');
  await expect(page.getByRole('note').filter({ hasText: 'No encontramos esta invitación personal' })).toBeAttached();

  const inv = await seedInvitation(request, 'Familia Pendiente de Lugares', null);
  await page.goto(`/i/${inv.token}#confirmar`);
  await expect(page.getByText('Aún estamos preparando los detalles de tu invitación')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enviar confirmación' })).toHaveCount(0);
  // La vista previa para compartir no incluye datos de la familia
  const html = await (await request.get(`/i/${inv.token}`)).text();
  expect(html).not.toContain('Familia Pendiente de Lugares');
});

test('(8) administración: inaccesible sin sesión y muestra la confirmación con sesión', async ({ page, request, playwright }, info) => {
  const anon = await playwright.request.newContext({ baseURL: 'http://localhost:3200' });
  expect((await anon.get('/api/admin/invitations')).status()).toBe(401);
  expect((await anon.get('/api/admin/export.csv')).status()).toBe(401);
  await anon.dispose();

  const inv = await seedInvitation(request, 'Familia Panel Admin', 4);
  await request.put(`/api/invitations/${inv.token}/rsvp`, { data: { status: 'attending', adults: 4 } });

  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Panel de invitaciones' })).toBeVisible();
  await page.getByLabel('Contraseña').fill('incorrecta');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('alert')).toContainText('Contraseña incorrecta');
  await page.getByLabel('Contraseña').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Invitaciones' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Datos de demostración' }).selectOption('include');
  await page.getByPlaceholder('Buscar por nombre').fill(inv.code);
  const row = page.getByRole('row', { name: new RegExp(inv.code) });
  await expect(row).toContainText('Asistirá · 4');
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-05-admin-lista.png`, fullPage: true });
  await row.getByRole('button', { name: 'Mensaje para Familia Panel Admin' }).click();
  await expect(page.getByText('Este panel no envía mensajes')).toBeVisible();
  await expect(page.locator('.adm-wa-bubble')).toContainText(inv.link);
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-06-admin-mensaje.png` });
});
