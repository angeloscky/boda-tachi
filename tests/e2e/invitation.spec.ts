import fs from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { adminLogin, adminRow, ADMIN_PASSWORD, BASE, elementShot, seedInvitation, shared, skipEnvelope, stubShare } from './helpers';

const SHOTS = 'docs/capturas';
fs.mkdirSync(SHOTS, { recursive: true });

const ROBLES = ['Ana Ejemplo Robles', 'Bruno Ejemplo Robles', 'Carmen Ejemplo Robles', 'Diego Ejemplo Robles'];

const person = (page: Page, name: string) => page.getByRole('checkbox', { name });
const toReview = (page: Page) => page.getByRole('button', { name: 'Revisar respuesta' }).click();
const confirmSave = (page: Page) => page.getByRole('button', { name: 'Confirmar y guardar' }).click();

test('(3)(12) recorrido completo: abrir, elegir 2 de 4, revisar, guardar, volver a abrir y cambiar', async ({ page, request }, info) => {
  const inv = await seedInvitation(request, 'Familia Ejemplo Robles', 4, ROBLES);
  await page.goto(`/i/${inv.token}`);

  const seal = page.getByRole('button', { name: 'Abrir invitación' });
  await expect(seal).toBeVisible();
  await expect(page.getByText('Para Familia Ejemplo Robles')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-01-sobre.png` });
  await seal.click();
  await expect(page.getByRole('dialog', { name: 'Apertura de la invitación' })).toBeHidden({ timeout: 5000 });
  await expect(page.getByRole('heading', { level: 1, name: /Sofía e Isaac/ })).toBeVisible();
  await expect(page.getByTestId('mode-banner')).toContainText(/[Dd]emostración/);
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-02-portada.png` });

  // Contenido y datos del evento
  for (const name of ['Bibiano Vázquez Mora', 'María Jesús González Hernández', 'Elena Aguilar Cervantes', 'Carlos Patzka Aguirre', 'Gerardo Vázquez Mora', 'Alma Idalia Villalobos González']) {
    await expect(page.getByText(name, { exact: false }).first()).toBeAttached();
  }
  await expect(page.getByText('Te invitamos a vestir completamente de negro.')).toBeAttached();
  await expect(page.getByText(/solo para adultos/).first()).toBeAttached();
  await expect(page.getByText(/salón/).first()).toBeAttached();

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

  // Captura de página completa: sin foco residual y sin la barra fija (que quedaría a media página).
  await page.evaluate(() => {
    document.querySelectorAll('.reveal').forEach((e) => e.classList.add('in'));
    (document.activeElement as HTMLElement | null)?.blur();
    document.querySelector<HTMLElement>('.bottom-nav')!.style.visibility = 'hidden';
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-03-invitacion-completa.png`, fullPage: true });
  await page.evaluate(() => (document.querySelector<HTMLElement>('.bottom-nav')!.style.visibility = ''));

  // Confirmación por persona
  await page.getByRole('link', { name: 'Confirmar', exact: true }).click();
  await expect(page.getByTestId('intransferible')).toContainText('Invitación personal e intransferible.');
  await expect(page.getByTestId('intransferible')).toContainText('su lugar no podrá transferirse a otra persona');
  const form = page.getByTestId('rsvp-form');
  await expect(form).toContainText('Hemos reservado 4 lugares para ustedes.');
  for (const n of ROBLES) await expect(person(page, n)).toBeVisible();
  await person(page, ROBLES[0]).check();
  await person(page, ROBLES[2]).check();
  await elementShot(page, page.locator('#confirmar'), `${SHOTS}/${info.project.name}-04-seleccion.png`);
  await toReview(page);
  const review = page.getByTestId('rsvp-review');
  await expect(review).toContainText('Asistirán 2 personas de 4 lugares reservados.');
  await expect(review).toContainText(ROBLES[0]);
  await expect(review).toContainText(ROBLES[2]);
  await expect(review).not.toContainText(ROBLES[1]);
  await elementShot(page, review, `${SHOTS}/${info.project.name}-05-revision.png`);
  await confirmSave(page);
  const saved = page.getByTestId('rsvp-saved');
  await expect(saved).toContainText('Recibimos tu respuesta');
  await expect(saved).toContainText('Asistirán 2 personas de 4 lugares reservados.');
  await expect(saved).toContainText('Demostración: es una respuesta de prueba.');
  await elementShot(page, saved, `${SHOTS}/${info.project.name}-06-confirmacion-guardada.png`);

  // El cupo asignado no cambia aunque asistan 2.
  let row = await adminRow(request, inv.id);
  expect(row).toMatchObject({ attendance: 'attending', seats: 4, attendingCount: 2, revision: 1 });
  expect(row.selectedPersonIds).toEqual([inv.people[0].id, inv.people[2].id]);

  // Volver a abrir el enlace: la respuesta está registrada y se puede cambiar
  await page.goto(`/i/${inv.token}#confirmar`);
  await page.reload();
  await expect(page.getByTestId('rsvp-saved')).toContainText('Tu respuesta está registrada');
  await page.getByRole('button', { name: 'Cambiar mi respuesta' }).click();
  await expect(person(page, ROBLES[0])).toBeChecked();
  await expect(person(page, ROBLES[1])).not.toBeChecked();
  await person(page, ROBLES[1]).check();
  await toReview(page);
  await confirmSave(page);
  await expect(page.getByTestId('rsvp-saved')).toContainText('Asistirán 3 personas');
  row = await adminRow(request, inv.id);
  expect(row).toMatchObject({ seats: 4, attendingCount: 3, revision: 2 });

  // "Ninguno de nosotros podrá asistir"
  await page.getByRole('button', { name: 'Cambiar mi respuesta' }).click();
  await page.getByRole('checkbox', { name: 'Ninguno de nosotros podrá asistir' }).check();
  await expect(person(page, ROBLES[0])).not.toBeChecked();
  await toReview(page);
  await expect(page.getByTestId('rsvp-review')).toContainText('Nadie de esta invitación podrá asistir.');
  await confirmSave(page);
  await expect(page.getByTestId('rsvp-saved')).toContainText('Nadie de esta invitación podrá asistir.');
  row = await adminRow(request, inv.id);
  expect(row).toMatchObject({ attendance: 'declined', attendingCount: 0, seats: 4 });
});

test('cupo menor que personas: no se puede marcar a más de las reservadas', async ({ page, request }) => {
  const inv = await seedInvitation(request, 'Familia Muestra Sol', 3, ['Sol Uno', 'Sol Dos', 'Sol Tres', 'Sol Cuatro']);
  await page.goto(`/i/${inv.token}#confirmar`);
  await expect(page.getByText('Pueden confirmar hasta 3 lugares de las 4 personas de la lista.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Seleccionar a todos' })).toHaveCount(0);
  for (const n of ['Sol Uno', 'Sol Dos', 'Sol Tres']) await person(page, n).check();
  await expect(person(page, 'Sol Cuatro')).toBeDisabled();
  await toReview(page);
  await expect(page.getByTestId('rsvp-review')).toContainText('Asistirán 3 personas de 3 lugares reservados.');
});

test('(2) una familia solo ve a sus personas, nunca las de otra', async ({ page, request }) => {
  await seedInvitation(request, 'Familia Ficticia Prado', 2, ['Pablo Ficticio Prado', 'Paula Ficticia Prado']);
  const b = await seedInvitation(request, 'Marina Luna Prueba', 1, ['Marina Luna Prueba']);
  await page.goto(`/i/${b.token}#confirmar`);
  await expect(page.getByTestId('rsvp-form')).toContainText('Marca tu nombre si asistirás');
  await expect(page.getByRole('checkbox', { name: 'No podré asistir' })).toBeVisible();
  const html = await page.content();
  expect(html).not.toContain('Prado');
});

test('(1)(11) el enlace general no confirma ni consulta invitaciones, y comparte solo la URL general', async ({ page, request }, info) => {
  const apiCalls: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/')) apiCalls.push(r.url());
  });
  await stubShare(page);
  await page.goto('/');
  await skipEnvelope(page);
  await expect(page.getByTestId('rsvp-general')).toContainText('Para confirmar necesitas el enlace personal que recibiste');
  await expect(page.getByTestId('rsvp-form')).toHaveCount(0);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByTestId('intransferible')).toHaveCount(0);
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', 'Sofía e Isaac · 22 de mayo de 2027');
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', `${BASE}/`);
  await elementShot(page, page.getByTestId('rsvp-general'), `${SHOTS}/${info.project.name}-07-enlace-general.png`);
  await page.getByTestId('share-general').click();
  expect(await shared(page)).toEqual([expect.objectContaining({ url: `${BASE}/` })]);
  expect(apiCalls.filter((u) => u.includes('/api/invitations'))).toEqual([]);

  // Sin el menú del sistema: copia (o muestra) el enlace general.
  const p2 = await page.context().newPage();
  await stubShare(p2, false);
  await p2.goto('/');
  await skipEnvelope(p2);
  await p2.getByTestId('share-general').click();
  await expect(p2.locator('.share-general [role="status"]')).toContainText(`${BASE}/`);
  await p2.close();

  // Sin enlace personal no hay forma de registrar una confirmación.
  const put = await request.put('/api/invitations/general/rsvp', { data: { status: 'declined', personIds: [], expectedRevision: 0, requestId: 'general-0001' } });
  expect(put.status()).toBe(404);
});

test('(11) compartir desde un enlace personal envía solo la invitación general', async ({ page, request }) => {
  const inv = await seedInvitation(request, 'Familia Compartir Demo', 2, ['Uno Compartir', 'Dos Compartir']);
  await stubShare(page);
  await page.goto(`/i/${inv.token}`);
  await skipEnvelope(page);
  await expect(page.getByTestId('share-general')).toBeVisible();
  await expect(page.getByText('Comparte solo la invitación general.')).toBeVisible();
  await page.getByTestId('share-general').click();
  const [data] = await shared(page);
  expect(data.url).toBe(`${BASE}/`);
  expect(JSON.stringify(data)).not.toContain(inv.token);
  // Ni los metadatos ni los enlaces de la página llevan el token.
  const heads = await page.locator('head meta').evaluateAll((ms) => ms.map((m) => m.getAttribute('content') ?? ''));
  expect(heads.join(' ')).not.toContain(inv.token);
  const hrefs = await page.locator('a[href]').evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''));
  expect(hrefs.join(' ')).not.toContain(inv.token);
});

test('(8) si el servidor falla no se muestra éxito, se conserva la selección y se puede reintentar', async ({ page, request }) => {
  const inv = await seedInvitation(request, 'Familia Prueba Fallo', 2, ['Fabio Fallo', 'Flor Fallo']);
  await page.goto(`/i/${inv.token}#confirmar`);
  await page.route('**/api/invitations/*/rsvp', (r) =>
    r.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"storage_unavailable","message":"No pudimos guardar tu respuesta en este momento. No se registró; inténtalo de nuevo."}' }),
  );
  await person(page, 'Flor Fallo').check();
  await toReview(page);
  await confirmSave(page);
  await expect(page.getByRole('alert')).toContainText('Tu respuesta no se ha guardado');
  await expect(page.getByRole('alert')).toContainText('No se registró');
  await expect(page.getByTestId('rsvp-saved')).toHaveCount(0);
  await expect(page.getByTestId('rsvp-review')).toContainText('Flor Fallo');

  // Sin conexión: mismo comportamiento
  await page.unroute('**/api/invitations/*/rsvp');
  await page.route('**/api/invitations/*/rsvp', (r) => r.abort('internetdisconnected'));
  await confirmSave(page);
  await expect(page.getByRole('alert')).toContainText('No pudimos comunicarnos con el servidor');
  await expect(page.getByTestId('rsvp-saved')).toHaveCount(0);
  // La selección sigue al volver al formulario.
  await page.getByRole('button', { name: 'Cambiar selección' }).click();
  await expect(person(page, 'Flor Fallo')).toBeChecked();
  await expect(person(page, 'Fabio Fallo')).not.toBeChecked();
  expect((await adminRow(request, inv.id)).attendance).toBe('pending');

  await page.unroute('**/api/invitations/*/rsvp');
  await toReview(page);
  await confirmSave(page);
  await expect(page.getByTestId('rsvp-saved')).toContainText('Asistirá 1 persona de 2 lugares reservados.');
  expect(await adminRow(request, inv.id)).toMatchObject({ attendance: 'attending', attendingCount: 1 });
});

test('(6) si otra persona guardó antes, se muestra la respuesta vigente y se puede revisar de nuevo', async ({ page, request }, info) => {
  const inv = await seedInvitation(request, 'Familia Conflicto Demo', 3, ['Celia Conflicto', 'César Conflicto', 'Ciro Conflicto']);
  await page.goto(`/i/${inv.token}#confirmar`);
  await person(page, 'Celia Conflicto').check();
  await person(page, 'César Conflicto').check();
  await toReview(page);
  // Mientras tanto, desde otro teléfono con el mismo enlace:
  const other = await request.put(`/api/invitations/${inv.token}/rsvp`, {
    data: { status: 'attending', personIds: [inv.people[2].id], expectedRevision: 0, requestId: 'otro-telefono-0001' },
  });
  expect(other.status()).toBe(200);
  await confirmSave(page);
  const conflict = page.getByTestId('rsvp-conflict');
  await expect(conflict).toContainText('Esta invitación cambió desde otro dispositivo');
  await expect(conflict).toContainText('Respuesta vigente: Asistirá 1 persona de 3 lugares reservados. Ciro Conflicto');
  await expect(conflict).toContainText('Tu selección: Asistirán 2 personas');
  await elementShot(page, page.getByTestId('rsvp-review'), `${SHOTS}/${info.project.name}-08-conflicto.png`);
  expect((await adminRow(request, inv.id)).selectedPersonIds).toEqual([inv.people[2].id]);
  await page.getByRole('button', { name: 'Guardar mi selección' }).click();
  await expect(page.getByTestId('rsvp-saved')).toContainText('Asistirán 2 personas');
  expect(await adminRow(request, inv.id)).toMatchObject({ revision: 2, selectedPersonIds: [inv.people[0].id, inv.people[1].id] });
});

test('(5) un doble toque en guardar envía una sola solicitud', async ({ page, request }) => {
  const inv = await seedInvitation(request, 'Familia Doble Toque', 2, ['Dalia Doble', 'Darío Doble']);
  await page.goto(`/i/${inv.token}#confirmar`);
  let puts = 0;
  await page.route('**/api/invitations/*/rsvp', async (r) => {
    puts++;
    await new Promise((res) => setTimeout(res, 400));
    await r.continue();
  });
  await page.getByRole('checkbox', { name: 'Ninguno de nosotros podrá asistir' }).check();
  await toReview(page);
  await page.getByRole('button', { name: 'Confirmar y guardar' }).dblclick();
  await expect(page.getByTestId('rsvp-saved')).toContainText('Nadie de esta invitación podrá asistir.');
  expect(puts).toBe(1);
  expect((await adminRow(request, inv.id)).revision).toBe(1);
});

test('navegación por teclado y movimiento reducido', async ({ browser, request }, info) => {
  const inv = await seedInvitation(request, 'Familia Teclado', 2, ['Tania Teclado', 'Tomás Teclado']);
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
  // Responder solo con teclado
  const first = person(page, 'Tania Teclado');
  await first.focus();
  await page.keyboard.press('Space');
  await expect(first).toBeChecked();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Space');
  await expect(person(page, 'Tomás Teclado')).toBeChecked();
  await page.getByRole('button', { name: 'Revisar respuesta' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Revisa tu respuesta' })).toBeFocused();
  await page.getByRole('button', { name: 'Confirmar y guardar' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('rsvp-saved')).toBeFocused();
  // Escape omite la animación
  const p2 = await context.newPage();
  await p2.goto(`/i/${inv.token}`);
  await p2.evaluate(() => sessionStorage.clear());
  await p2.reload();
  await p2.keyboard.press('Escape');
  await expect(p2.getByRole('dialog', { name: 'Apertura de la invitación' })).toBeHidden();
  await context.close();
});

test('(7) enlace inexistente, truncado, revocado y regenerado; invitación sin cupo', async ({ page, request }) => {
  await page.goto('/i/ZZZZZZZZZZZZZZZZZZZZZZZZ#confirmar');
  await expect(page.getByRole('alert')).toContainText('No encontramos esta invitación');
  await page.goto('/i/abc#confirmar');
  await expect(page.getByRole('alert')).toContainText('No encontramos esta invitación');
  await expect(page.getByRole('note').filter({ hasText: 'No encontramos esta invitación personal' })).toBeAttached();

  const inv = await seedInvitation(request, 'Familia Enlace Revocado', 1, ['Rebeca Revocada']);
  await adminLogin(request);
  expect((await request.post(`/api/admin/invitations/${inv.id}/revoke-link`)).status()).toBe(200);
  await page.goto(`/i/${inv.token}#confirmar`);
  await expect(page.getByRole('alert')).toContainText('No encontramos esta invitación');
  await expect(page.getByTestId('rsvp-form')).toHaveCount(0);
  const regen = await (await request.post(`/api/admin/invitations/${inv.id}/regenerate-link`)).json();
  expect(regen.token).not.toBe(inv.token);
  await page.goto(`/i/${regen.token}#confirmar`);
  await expect(page.getByTestId('rsvp-form')).toBeVisible();

  const pending = await seedInvitation(request, 'Familia Pendiente de Lugares', null, []);
  await page.goto(`/i/${pending.token}#confirmar`);
  await expect(page.getByText('Aún estamos preparando los detalles de tu invitación')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Revisar respuesta' })).toHaveCount(0);
  // La vista previa para compartir no incluye datos de la familia
  const html = await (await request.get(`/i/${pending.token}`)).text();
  expect(html).not.toContain('Familia Pendiente de Lugares');
  expect(html).not.toContain(pending.token);
});

test('administración: inaccesible sin sesión; lista, edición con personas y mensaje simulado', async ({ page, request, playwright }, info) => {
  const anon = await playwright.request.newContext({ baseURL: BASE });
  expect((await anon.get('/api/admin/invitations')).status()).toBe(401);
  expect((await anon.get('/api/admin/export/invitaciones.csv')).status()).toBe(401);
  await anon.dispose();

  const inv = await seedInvitation(request, 'Familia Panel Admin', 4, ['Adela Panel', 'Alan Panel', 'Aurora Panel', 'Arturo Panel']);
  await request.put(`/api/invitations/${inv.token}/rsvp`, {
    data: { status: 'attending', personIds: [inv.people[0].id, inv.people[3].id], expectedRevision: 0, requestId: 'panel-admin-0001' },
  });

  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Panel de invitaciones' })).toBeVisible();
  await page.getByLabel('Contraseña').fill('incorrecta');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('alert')).toContainText('Contraseña incorrecta');
  await page.getByLabel('Contraseña').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Invitaciones' })).toBeVisible();
  await expect(page.getByTestId('demo-notice')).toBeVisible();
  await page.getByPlaceholder('Buscar por grupo, persona, ID o teléfono').fill('Aurora Panel');
  const row = page.getByRole('row', { name: new RegExp(inv.code) });
  await expect(row).toContainText('Asistirá · 2');
  await expect(row).toContainText('Adela Panel, Arturo Panel');
  await expect(row).toContainText('4 / 4');
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-09-admin-lista.png`, fullPage: true });

  await row.getByRole('button', { name: 'Editar Familia Panel Admin' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Nombre de la persona 1')).toHaveValue('Adela Panel');
  await expect(dialog.getByTestId('admin-link')).toContainText(inv.token);
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-10-admin-edicion.png` });
  await dialog.getByRole('button', { name: 'Cerrar' }).click();

  await row.getByRole('button', { name: 'Mensaje para Familia Panel Admin' }).click();
  await expect(page.getByText('Este panel no envía mensajes')).toBeVisible();
  await expect(page.locator('.adm-wa-bubble')).toContainText(inv.link);
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-11-admin-mensaje.png` });
});
