# Boda Sofía e Isaac · Invitación digital

Invitación web para el 22 de mayo de 2027 (Zapopan, Jalisco). Hay un **enlace general** con los detalles de la boda y un **enlace personal** por familia, con el que cada invitación elige quiénes de sus personas autorizadas asistirán.

- **Interfaz:** React + Vite + TypeScript (`src/`)
- **API:** Express (`server/`), un solo proceso Node que sirve la interfaz y la API
- **Reglas de confirmación:** `shared/rsvp-rules.ts`, las mismas en el servidor y en Apps Script
- **Registro principal (futuro):** Google Sheets privado mediante Apps Script. **Preparado, no conectado** (ver [`google-sheets/README.md`](google-sheets/README.md))
- **Demostración local:** SQLite con familias ficticias, solo para revisar y probar
- **Datos del evento:** `shared/event.ts` (único lugar para editar textos, horarios, enlaces y secciones opcionales)

## Modos de la confirmación

`RSVP_BACKEND` decide dónde se guardan las respuestas. La interfaz muestra siempre el estado real:

| Modo | Qué ve el invitado | Datos |
| --- | --- | --- |
| *(vacío)* — sin registro | "La confirmación en línea todavía no está habilitada". No hay formulario ni éxitos simulados. | Ninguno. Nunca cae a la demostración. |
| `demo` | Aviso "Demostración local con familias ficticias". Las respuestas se guardan como respuestas de prueba. | SQLite (`DB_PATH`), enlaces `demo_…` que nunca sirven en el registro real. |
| `sheets` | Confirmación normal. Éxito solo cuando Apps Script confirma la escritura. | Hoja privada de Google. Conexión pendiente. |
| Vista estática (`npm run build:static`) | Diseño y formulario con una familia ficticia; al guardar dice que la respuesta **no** se registró. | Ninguno. |

## Probar la demostración

Requisitos: Node.js 22.13 o superior (probado con 22.22) y Git. En Windows funciona igual desde PowerShell.

```bash
git clone https://github.com/angeloscky/boda-tachi.git
cd boda-tachi
npm install
copy .env.example .env        # en macOS/Linux: cp .env.example .env
# en .env: ADMIN_PASSWORD=una-clave-local
npm run demo                  # compila y arranca en modo demo: http://localhost:3000
```

La consola muestra los enlaces personales de las cinco familias ficticias (`DEMO-001…005`):

| ID | Familia | Personas | Cupo | Para probar |
| --- | --- | --- | --- | --- |
| DEMO-001 | Familia Ejemplo Robles | 4 | 4 | elegir 2 de 4, "seleccionar a todos" |
| DEMO-002 | Familia Ficticia Prado | 2 | 2 | "ninguno podrá asistir" y cambiar la respuesta |
| DEMO-003 | Marina Luna Prueba | 1 | 1 | textos en singular |
| DEMO-004 | Familia Muestra Sol | 4 | 3 | cupo menor que personas |
| DEMO-005 | Familia Pendiente Demo | 0 | pendiente | todavía no puede confirmar |

- Página general: `http://localhost:3000/`
- Enlace personal: `http://localhost:3000/i/demo_…`
- Panel: `http://localhost:3000/admin`

Desarrollo con recarga: `npm run dev` (interfaz en `http://localhost:5173`, API en el puerto 3000, modo demo). Para volver a crear o borrar las familias ficticias: `npm run demo:seed` / `npm run demo:clear`.

## Enlace general y enlace personal

**Enlace general** (`/`): portada, fecha, padres, padrinos, ceremonia (7:00 pm) y recepción (8:30 pm, en el salón de Quinta de Torres), ubicaciones, código de vestimenta, aviso de solo adultos y mesa de regalos. No consulta ninguna invitación ni la lista, y la sección de confirmación explica que hace falta el enlace personal.

**Enlace personal** (`/i/<token>`): además muestra el nombre de la invitación, sus personas autorizadas activas y su cupo, y el texto de invitación personal e intransferible junto a la lista. La familia:

- marca a quienes asistirán (o "Seleccionar a todos" si caben en el cupo), o elige "Ninguno de nosotros podrá asistir";
- revisa un resumen antes de guardar ("Asistirán 2 personas de 4 lugares reservados");
- puede cambiar su respuesta mientras las confirmaciones estén abiertas.

No puede cambiar el cupo, agregar ni sustituir personas, ni editar nombres, teléfonos, lado o notas. El servidor calcula cuántos asisten a partir de la selección (no acepta un número del navegador), rechaza IDs ajenos, inactivos o repetidos, selecciones mayores al cupo y cualquier campo de administración. Cada envío lleva un `requestId`: si se repite, no se duplica. Si otra persona guardó antes con el mismo enlace, se muestra la respuesta vigente y se puede revisar antes de guardar de nuevo. Ante un error la selección se conserva y nunca se muestra éxito.

**Compartir invitación general:** el botón de la página comparte siempre la URL general (`PUBLIC_BASE_URL/`), también desde un enlace personal; los metadatos para vista previa tampoco llevan el token.

**Sobre el enlace personal:** quien tenga el enlace puede consultar y cambiar la respuesta de esa invitación; reenviarlo transmite esa capacidad. El enlace no identifica a la persona que lo abre. Si llegó a quien no debía, se revoca o se genera uno nuevo (el anterior deja de funcionar). No hay códigos por SMS, cuentas de invitado ni verificación por WhatsApp.

Los lugares que una familia no use quedan a decisión de los novios: no se reasignan solos ni los puede tomar otra familia.

## Configuración (`.env`)

| Variable | Para qué sirve |
| --- | --- |
| `PUBLIC_BASE_URL` | URL pública sin `/` final. Es la que comparte el botón de la invitación general y la base de los enlaces personales. |
| `RSVP_BACKEND` | vacío (sin registro), `demo` o `sheets`. Un valor desconocido detiene el arranque. |
| `DB_PATH` | Solo `demo`: archivo SQLite de la demostración. Se rechaza si cae dentro de `public/`, `dist/` o la carpeta servida. |
| `DEMO_SEED` | Solo `demo`: `0` evita crear las familias ficticias al arrancar. |
| `SHEETS_WEBAPP_URL` | Solo `sheets`: URL `/exec` de la implementación de Apps Script. |
| `SHEETS_SHARED_SECRET` | Solo `sheets`: secreto compartido con el script (≥ 32 caracteres). Vive en el servidor, nunca en el navegador. |
| `SHEETS_TIMEOUT_MS` | Solo `sheets`: tiempo máximo por llamada (15000 por defecto). |
| `ADMIN_PASSWORD_HASH` | Hash scrypt de la contraseña del panel (`npm run admin:hash`). Las sesiones viven en memoria: reiniciar o cambiar la contraseña las cierra. Tras 30 intentos fallidos en una hora (de cualquier IP) el acceso se bloquea una hora, también con la contraseña correcta: así no se puede adivinar la contraseña desde muchas IP, a cambio de que alguien pueda mantener el panel bloqueado a propósito. El contador vive en memoria: reiniciar el servicio lo limpia. En modo Sheets la lista se administra en la hoja (con la cuenta de Google), así que el bloqueo solo afecta al panel de estado. |
| `DEMO_IN_PRODUCTION` | Con `NODE_ENV=production`, la demostración solo arranca si vale `1` (para publicar una demostración a propósito). En producción también es obligatorio `PUBLIC_BASE_URL`. |
| `TRUST_PROXY` | Número de proxies delante del servidor (0 si se expone directo). Necesario para limitar intentos por IP real. |
| `PORT`, `COOKIE_SECURE`, `MESSAGING_PROVIDER` | Puerto (3000), cookies solo HTTPS (automático con `https://`), mensajes (`simulation`, no envía nada). |
| `HOST` | Interfaz donde escucha el servidor. Vacío = todas (lo de Node); en Render, `0.0.0.0`. |

## Panel

- **Demostración:** administra invitaciones (ID estable, lado, grupo, contacto, teléfono, cupo, personas autorizadas, notas), copia, regenera o revoca enlaces, registra respuestas recibidas por otro medio con las mismas reglas, abre o cierra confirmaciones, importa y exporta CSV con el formato de las pestañas de Sheets y prepara mensajes de WhatsApp simulados.
- **Sheets:** muestra el estado de la conexión, los totales y los problemas de la lista (la lista se administra en la hoja, con el menú **Boda**).
- **Sin registro:** indica que no hay registro configurado.

Importar CSV (`Invitaciones.csv` y `Personas.csv`, plantillas en el botón **Plantillas** o en `google-sheets/plantillas/`): primero se muestra una revisión con errores y avisos; si hay errores no se aplica nada. Reimportar un ID lo actualiza sin duplicarlo (`INV-001` y `inv-001` son el mismo). Nunca se combinan invitaciones o personas por apellido o teléfono; solo aparece un aviso. Las columnas que falten conservan lo existente. Una persona no cambia de invitación, y no se puede desactivar a alguien que ya confirmó.

### Cambios sensibles con confirmaciones abiertas

El panel (demo) valida cada cambio contra la respuesta vigente: no deja bajar el cupo por debajo de las personas confirmadas ni desactivar a una persona confirmada. En la hoja, donde se puede editar a mano, el procedimiento es: **Cerrar confirmaciones → hacer el cambio → Revisar la lista → Abrir confirmaciones** (detalle en `google-sheets/README.md`). El bloqueo del script no impide ediciones manuales simultáneas.

## WhatsApp (preparado, sin envíos)

El panel de la demostración prepara para cada invitación: destinatario, teléfono, enlace personal, texto (plantilla en `shared/message.ts`), vista previa, copiar texto, abrir `wa.me` y exportación **Mensajes CSV**. La asistencia y la comunicación son estados separados; copiar el texto, abrir WhatsApp o que el invitado visite su enlace no cuenta como enviado ni como confirmado. El envío automatizado requeriría WhatsApp Business Platform (Cloud API) de Meta y queda para una fase posterior.

## Pruebas

```bash
npm run typecheck     # interfaz, servidor, pruebas y scripts
npm test              # 84 pruebas de reglas, API, modos y Apps Script con dobles (Vitest + Supertest)
npm run build
npm run test:e2e      # 36 recorridos en navegador: 18 en móvil y 18 en escritorio (Playwright)
```

En otro equipo, la primera vez: `npx playwright install chromium`. Las pruebas usan bases temporales y datos ficticios; no envían mensajes, no visitan Google Maps ni Liverpool, y no se conectan a Google: el script se ejecuta con dobles de `SpreadsheetApp`, `LockService` y la redirección de Google (`tests/api/fake-gas.ts`). Esos dobles no acreditan una conexión real.

`npm run sheets:build` regenera `apps-script/Code.gs` y las plantillas; una prueba falla si quedaron desactualizados.

## Publicación

Pendiente: no se creó ninguna cuenta de alojamiento ni se compró dominio.

- **Revisión gratuita en Render (preparado):** guía en [`docs/alojamiento-render.md`](docs/alojamiento-render.md), con build `npm ci && npm run build`, start `npm start`, health check `/api/health`, sin disco ni base de datos y con el subdominio `onrender.com`. Mientras Google esté desconectado, `RSVP_BACKEND` va vacío y la confirmación aparece como no habilitada. En el plan Free el servicio se suspende tras 15 minutos sin tráfico, y volver a levantarlo tarda aproximadamente un minuto. Es una ruta para revisar; la experiencia final para invitados queda por comprobar.
- **Versión de Node:** `.node-version` fija la 22.22.0, con la que se probó todo.
- **Contenedor:** el `Dockerfile` sigue funcionando como contenedor sin estado; el volumen solo hace falta para la demostración.
- **Hosting estático:** solo sirve para la vista de diseño (`npm run build:static`, sale en `dist/static-demo/`), que nunca registra respuestas.

## Logo

- Original intacto: `assets/logo/original/WhatsApp Image 2026-10-21 at 8.42.27 PM.jpeg` (captura de 738×1600).
- Vectorización: `assets/logo/vector/*.svg`, generada con `npm run logo:vectorize` (potrace sobre la captura ampliada; los textos usan un umbral adaptativo para que las líneas finas de la fecha no se corten). Es un trazado automático fiel a la captura, no el archivo vectorial de la diseñadora; si aparece el SVG original, reemplaza `public/assets/logo/*.svg` con los mismos nombres.
- Favicon, ícono e imagen para compartir: `npm run logo:assets`.

## Estructura

```
shared/event.ts            datos públicos del evento (editar aquí)
shared/rsvp-rules.ts       reglas de confirmación (servidor y Apps Script)
shared/sheets-schema.ts    pestañas y columnas de la hoja
server/store.ts            almacenamiento: demo, sheets o sin registro
server/sheets/client.ts    conector firmado a Apps Script
server/invitations.ts      demostración local (SQLite) y panel
apps-script/               script de la hoja (src/ → Code.gs) y manifiesto
google-sheets/             guía de instalación y plantillas ficticias
src/                       invitación (pages/, components/) y panel (admin/)
tests/api, tests/e2e       pruebas
assets/logo                original y vectorizado
docs/capturas              capturas de móvil y escritorio
```
