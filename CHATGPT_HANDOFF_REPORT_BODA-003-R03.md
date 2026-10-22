# CHATGPT_HANDOFF_REPORT · BODA-003-R03

**Título:** Correcciones del conector de Sheets, respuestas manuales repetidas y preparación de Render Free
**Responsable:** Claude (implementación), con un revisor independiente limitado a las dos correcciones y sus pruebas.
**Para:** ChatGPT, como orquestador de la estructura del proyecto.
**Parte de:** BODA-003-R02 (`main` en `f640c92`, código en `8da9be4`).

## Resumen para orquestar

- **Corrección 1 (acceso a la hoja desde la aplicación web).** En R02 el script usaba `getActiveSpreadsheet()`, que en una aplicación web devuelve `null`: toda consulta o guardado habría fallado con 500 `read_failed`. Ahora el script guarda el ID de su hoja en la propiedad privada `BT_SPREADSHEET_ID` (la registra el menú **Boda → Preparar estructura**) y las operaciones de la aplicación web la abren con `openById`. Si falta el registro o la hoja no se puede abrir, responde un error controlado y nunca dice "conectado" ni "guardado".
- **Corrección 2 (respuestas escritas a mano con personas repetidas).** "P1, P1" con cupo 2 pasaba todas las validaciones y contaba como 2 asistentes. Ahora la repetición (sin distinguir mayúsculas) aparece en la revisión de la lista, deja la invitación en "por revisar" y no cuenta en los totales. No se corrige sola. De paso, una respuesta manual con una persona de otra invitación o con más personas que cupo recibe el mismo trato.
- **Render Free:** solo preparado. Guía en `docs/alojamiento-render.md`; compilación y arranque comprobados en local con su configuración. No se creó cuenta ni servicio.
- **Google Sheets y Drive siguen desconectados** por decisión de Angel. Las dos correcciones se probaron con dobles de prueba; la comprobación con Google real sigue pendiente.
- El diseño no cambió. La vista estática para revisarlo sigue en https://claude.ai/artifact/VghA5XiJGMncKVamxNHufE y no registra respuestas reales.

## Tiempos (America/Mexico_City)

| Inicio | Fin | Duración |
| --- | --- | --- |
| 2026-10-22 00:38 CST | 2026-10-22 01:05 CST | 27 min |

## Ubicación y versión

- Repositorio: https://github.com/angeloscky/boda-tachi, rama `main`.
- Estado de partida comprobado: `main` local y remoto en `f640c921fa3337379cf9e52dd891ddb51ccde2a8`, sin cambios posteriores que conservar.
- Commits de esta ronda:
  - `a259142`: **commit de código final** (código, pruebas y documentación, con las correcciones de la revisión).
  - Encima va el commit que agrega este informe (sin cambios de código).
- Copias: `C:\Users\Pc\boda tachi\` (este informe y `boda-tachi-BODA-003-R03.zip`).

## 1. Acceso a la hoja desde la aplicación web

**Problema reproducido.** Con el `Code.gs` de R02 dentro del doble de Apps Script, sin hoja activa (como en una aplicación web real), `getInvitation` respondía:

```
R02 (8da9be4) {"ok":false,"status":500,"code":"read_failed","message":"Cannot read properties of null (reading 'getSheetByName')"}
R03 (actual)  {"ok":true,"group":"Familia Ejemplo A"}
```

**Cambio** (`apps-script/src/Code.js`; `apps-script/Code.gs` regenerado con `npm run sheets:build`):

- `webSs_()` lee `BT_SPREADSHEET_ID` de las propiedades del script (sin espacios alrededor), comprueba que tenga forma de ID de Google y abre la hoja con `SpreadsheetApp.openById`. La usan las cuatro operaciones de la aplicación web: `ping`, `getInvitation`, `saveResponse` y `summary`.
- El ID **no viaja en ninguna solicitud**. Los campos de más (otro archivo, un rango) se ignoran. No hay operaciones genéricas de rangos.
- Errores controlados, con estado 503 y sin reintento:
  - `sheet_not_configured`: no hay ID registrado, o lo guardado no es un ID válido (por ejemplo, una URL pegada), con un mensaje distinto para cada caso;
  - `sheet_unavailable`: la hoja no se pudo abrir (borrada, otro dueño, sin permiso).
  El servidor los convierte en "no conectado" en el panel, con el motivo, y en 503 `storage_unavailable` para el invitado. Nunca se informa un guardado.
- **Preparar estructura** (`btSetup`, desde el menú de la hoja) registra el ID de su propia hoja. Si ya había otro, lo reemplaza y lo avisa. Fuera de la hoja, sin contexto activo, falla y no registra nada.
- Las funciones del menú siguen usando la hoja activa, que sí existe en ese contexto.
- La firma HMAC de solicitudes y respuestas, los nonces y el bloqueo no cambiaron.

**Manifiesto y permisos** (`apps-script/appsscript.json`):

- `https://www.googleapis.com/auth/spreadsheets`: leer y escribir hojas. Sustituye a `spreadsheets.currentonly`, que solo cubre la hoja "actual" y en la aplicación web no la hay. Este permiso alcanza a todas las hojas de la cuenta que implementa, aunque el código solo abre la registrada.
- `https://www.googleapis.com/auth/script.container.ui`: el menú **Boda**.
- **Límite honesto:** no se pudo citar en esta sesión la nota de autorización de `openById` en la referencia de Google (la página llegó cortada). La guía de alcances de Google muestra `openById` junto al alcance `spreadsheets`, pero la confirmación final es la pantalla de autorización real. Queda en la lista de verificación de `google-sheets/README.md`.

**Doble de prueba** (`tests/api/fake-gas.ts`): por defecto ya **no hay hoja activa**. `openById` registra qué ID se abrió y falla con cualquier otro ID o si la hoja se marca inaccesible. El menú se ejecuta con hoja activa simulada (`gas.menu`).

## 2. Respuestas manuales con personas repetidas

**Problema reproducido** con las reglas de R02 y de R03 (invitación con cupo 2, respuesta "P1, P1"):

```
R02: {"errors":[],"blockers":[],"roster":[],"summary":2}
R03: {"errors":["La respuesta repite a la persona P1; corrige la selección en la hoja."],
      "blockers":["Respuesta: La respuesta repite a la persona P1; corrige la selección en la hoja."],
      "roster":[{"severity":"error","tab":"Respuestas","id":"INV-9","message":"La respuesta repite a la persona P1; corrige la selección en la hoja."}],
      "summary":0}
```

**Cambio** (`shared/rsvp-rules.ts`, compartido por el servidor y el Apps Script):

- `repeatedIds()` detecta repeticiones sin distinguir mayúsculas.
- `parseResponseRow` marca la fila con error; `invitationBlockers` deja la invitación en revisión (el invitado ve "por revisar" y no ve una respuesta vigente); `checkRoster` lo lista en la revisión de la lista.
- `summarize` solo cuenta respuestas coherentes: sin repeticiones, con personas de esa invitación y sin superar el cupo. Las demás cuentan como pendientes.
- **Tras la revisión independiente:** los totales usan además la misma regla que la consulta del invitado. `invitationsInReview()` marca toda invitación activa que su enlace no atendería (`invitationBlockers`), y `summarize` la cuenta como pendiente (`inReview`). Así coinciden lo que ve el invitado, la revisión de la lista, el panel y la pestaña Resumen también cuando hay dos filas para la misma invitación (una válida y otra repetida, o dos válidas). La revisión de la lista agrega una entrada "En revisión: …" con el motivo, el Resumen una fila "De ellas, en revisión" y el panel indica cuántas pendientes están en revisión.
- Nada se corrige en silencio: la fila queda como está hasta que alguien la arregle en la hoja.
- Lo mismo aplica a una respuesta manual con una persona de otra invitación o con más personas que cupo.
- La API del invitado sigue rechazando duplicados como antes (`duplicate_person`, comprobado en `tests/api/rsvp.test.ts`).

## Pruebas realizadas (datos ficticios)

Todas se ejecutaron en esta sesión sobre el código final de la ronda.

| Comando | Resultado |
| --- | --- |
| `npm run sheets:build` | `Code.gs` y plantillas regenerados; la prueba de frescura de `Code.gs` pasa |
| `npm test` (Vitest + Supertest) | **81 de 81** antes de la revisión; **84 de 84** tras las correcciones de la revisión (8 archivos) |
| `npm run typecheck` | sin errores |
| `npm run build` | compila interfaz y servidor |
| `npx playwright test` | **36 de 36** pasaron (móvil y escritorio), antes y después de las correcciones de la revisión: demostración, enlace general, enlaces personales, panel y vista estática |

Pruebas nuevas de esta ronda:

- `rules.test.ts`
  - respuesta a mano con personas repetidas ("P1, P1" y "P1, p1"): error visible, invitación en revisión y fuera de los totales; "P1, P2" sí cuenta;
  - respuesta a mano con una persona de otra invitación o con más personas que cupo: se pide revisar y no cuenta;
  - invitación en revisión con dos filas (una válida y otra repetida, o dos válidas): se reporta "En revisión" con "más de una respuesta" y no cuenta; una invitación sin problemas o inactiva no queda en revisión.
- `sheets.test.ts` (Apps Script real dentro del doble, servidor real)
  - como aplicación web, sin hoja activa: consulta, guardado, panel y `ping` funcionan y solo se abre la hoja registrada; campos de más en la solicitud (otro archivo, un rango) se ignoran;
  - sin hoja registrada y con la hoja inaccesible: `ping` responde `sheet_not_configured` / `sheet_unavailable` (503), el invitado recibe 503 al consultar y al guardar, nada se escribe y el panel dice "no conectado" con el motivo;
  - **Preparar estructura** registra el ID y desde entonces la aplicación web atiende; fuera de la hoja no registra nada;
  - ID registrado con espacios alrededor: funciona; URL pegada en lugar del ID: `sheet_not_configured` con su propio mensaje y sin llamar a `openById`; `openById` que devuelve `null`: `sheet_unavailable` en `ping` y `summary`, y el guardado responde 503 sin escribir;
  - una respuesta válida del script y otra repetida a mano para la misma invitación: el invitado ve "por revisar", el panel da 0 asistentes, 2 pendientes y 1 en revisión, la revisión de la lista lo explica y el Resumen coincide;
  - respuesta a mano repetida sin distinguir mayúsculas: el invitado ve "por revisar" (409 `needs_review`) sin respuesta vigente, no se corrige, el resumen da 0 asistentes y 2 pendientes, el problema aparece en la revisión y la pestaña Resumen marca 0; la versión válida "P1, P2" sí cuenta.

## Revisión independiente

Un revisor independiente revisó solo las dos correcciones y sus pruebas, sin editar el repositorio y sin conexiones externas. Después verificó las correcciones de lo que encontró.

**Lo que confirmó:**

- Las pruebas nuevas fallan contra el código anterior: con el `Code.gs` de R02 fallan 18 de 22 pruebas del conector, y con las reglas anteriores fallan las pruebas de repetidos.
- Con ID vacío, con espacios, en forma de URL, corto o ausente, y con `openById` que lanza o devuelve `null`, las cuatro operaciones responden un 503 firmado y controlado, el panel dice "no conectado" y nada se escribe.
- Los campos de más en la solicitud se ignoran y la firma HMAC no cambió.
- Las respuestas manuales de una sola fila con repeticiones (mayúsculas, espacios, punto y coma), personas ajenas o inexistentes, o más personas que cupo quedan en revisión, se reportan y no cuentan. "P1, P2" sí cuenta, y la API del invitado sigue rechazando duplicados.

**Lo que encontró y se corrigió:**

1. **Error real.** Con dos filas en Respuestas para la misma invitación (la del script y otra escrita a mano con una persona repetida, o dos filas válidas), el invitado veía "por revisar", pero el panel y el Resumen contaban la fila válida, y la revisión de la lista no decía "más de una respuesta". Se corrigió haciendo que los totales usen la misma regla que la consulta del invitado (ver "Respuestas manuales con personas repetidas"). Prueba nueva con ese caso exacto.
2. **Riesgo menor.** Un ID guardado con espacios, o una URL pegada, se reportaba como "no tiene registrada la hoja". Ahora el ID se recorta y una forma inválida tiene su propio mensaje.
3. **Documentación.** Se corrigió el texto sobre lo que ve el invitado al guardar con la hoja inaccesible ("No pudimos comprobar que tu respuesta se guardara"; pide reintentar aunque el arreglo depende de quien administra la hoja). También se reescribió la nota del alcance de `openById`, que sigue pendiente de confirmar.
4. **Huecos de pruebas.** Se agregaron pruebas para `openById` que devuelve `null`, para un ID con forma inválida y para dos filas con totales.
5. **Al verificar.** Una fila de demostración con un problema se reportaba "en revisión", aunque su enlace responde como inexistente. Ahora se excluye.

**Verificación del revisor:** confirmó los dos escenarios del punto 1 (invitado, revisión de la lista, panel y Resumen coinciden: 0 asistentes, 2 pendientes, 1 en revisión) y no encontró regresiones: una invitación inactiva no queda en revisión, una fila con solo un teléfono o lado mal escrito sigue atendiéndose y contando, y la demostración local sigue funcionando.

**Comportamiento anterior que no cambia (registrado, fuera de esta corrección):**

- Una respuesta "asistirá" escrita a mano solo con personas que después se desactivaron cuenta como "asiste" con 0 personas; la revisión de la lista lo avisa.
- Una fila de invitación con un error que impide atenderla (por ejemplo, cupo 0) queda fuera de los totales y aparece como problema, no como "en revisión".
- Si dos filas comparten ID de invitación, cada una aparece "en revisión".

## 3. Preparación para Render Free

Guía en `docs/alojamiento-render.md`. Puntos clave:

- **Plan Free** (documentación de Render consultada el 2026-10-22): se suspende tras **15 minutos sin tráfico** y la siguiente visita tarda **aproximadamente un minuto** en levantarlo. 750 horas al mes. Sin disco persistente. Subdominio gratuito `https://<nombre>.onrender.com`; un dominio comprado es opcional.
- **Servicio web:** runtime Node; versión `22.22.0` fijada con el nuevo archivo `.node-version` (la probada); build `npm ci && npm run build`; start `npm start`; health check `/api/health`; sin disco y sin base de datos.
- **Puerto y host:** el servidor respeta `PORT` y ahora acepta `HOST` (en Render, `0.0.0.0`). Sin `HOST`, escucha como antes.
- **Variables:** `PUBLIC_BASE_URL` con la URL real que asigne Render; `RSVP_BACKEND` vacío mientras Google siga desconectado; `MESSAGING_PROVIDER=simulation`; `SHEETS_WEBAPP_URL` y `SHEETS_SHARED_SECRET` sin rellenar; `ADMIN_PASSWORD_HASH` opcional; `TRUST_PROXY=1` (el número de saltos se comprueba en el primer despliegue).
- **Hallazgo:** con `NODE_ENV=production`, `npm ci` omite las dependencias de desarrollo y la compilación falla con `vite: not found`. La guía da dos opciones: sin `NODE_ENV`, o con `NODE_ENV=production` y build `npm ci --include=dev && npm run build`.
- No es la publicación final para invitados ni una migración de plataforma. La experiencia final (tiempos reales, vista previa en WhatsApp) queda por comprobar.

## Estado por tipo de comprobación

### a) Comprobado localmente

- Las 84 pruebas de API y reglas, los 36 recorridos en navegador, los tipos y la compilación.
- La demostración local y el enlace general conservan su comportamiento (recorridos e2e).
- La reproducción de los dos defectos con el código de R02 y su corrección con el de R03 (salidas arriba).
- Render simulado en local desde una copia limpia, con Node 22.22.0:
  - `NODE_ENV=production` con `npm ci`: falla (`vite: not found`); con `--include=dev`: compila; sin `NODE_ENV`: compila;
  - `npm start` con `PORT=10000`, `HOST=0.0.0.0` y una URL pública de ejemplo: escucha en `0.0.0.0:10000`; `/api/health` responde 200 `{"ok":true,"rsvp":"disabled"}`; `og:url` y el botón general usan la URL pública; un enlace personal responde 503 `rsvp_not_enabled` al consultar y al guardar; `/calendario.ics` responde 200; HSTS presente; no se crea carpeta `data/`;
  - sin `PUBLIC_BASE_URL` en producción, el servidor no arranca y lo explica.

### b) Preparado y probado solo con dobles de prueba

- Apertura de la hoja por `BT_SPREADSHEET_ID` sin hoja activa, errores `sheet_not_configured` / `sheet_unavailable`, registro desde **Preparar estructura**.
- Las cuatro operaciones (`ping`, `getInvitation`, `saveResponse`, `summary`) con la hoja registrada, sin registrar e inaccesible.
- Respuestas manuales repetidas, ajenas o sobre el cupo leídas desde la hoja: revisión, vista del invitado y totales.
- Los dobles imitan `SpreadsheetApp`, `PropertiesService`, `LockService`, `CacheService`, `Utilities` y `ContentService`. **No acreditan una conexión real.**

### c) Pendiente de comprobar con Google real

- Que Google acepte el manifiesto con `spreadsheets` y `script.container.ui`, y qué muestra la pantalla de autorización. En particular, que `openById` quede cubierto por `spreadsheets` (no se pudo citar la referencia en esta sesión).
- Que **Preparar estructura** registre `BT_SPREADSHEET_ID` y que se vea en las propiedades del script.
- Que `ping`, `getInvitation`, `saveResponse` y `summary` funcionen como aplicación web implementada, sin hoja activa.
- Que `openById` con una hoja borrada o sin acceso se comporte como el doble (error controlado).
- Todo lo que ya estaba pendiente desde R02: fórmulas, validaciones, protecciones, propiedades `rev:<id>`, tiempos de respuesta (lista en `google-sheets/README.md`, "Verificación pendiente").

### d) Alojamiento solo preparado

- No se creó cuenta ni servicio en Render, no se compró dominio y no se publicó nada.
- Pendiente en Render: el health check, la pausa y el arranque reales, el número de proxies (`TRUST_PROXY`) y la vista previa al compartir con la URL real.

## Alcance respetado

- Google Sheets y Drive desconectados; no se pidió ninguna credencial.
- Solo datos ficticios. No se cargó ni se recuperó ninguna lista real.
- Se conservan el enlace general y los enlaces personales, el cupo por familia, la selección por persona y la no transferibilidad.
- Se conservan Sofía Lizeth García Aguilar y los datos del evento.
- WhatsApp sigue pendiente para una etapa posterior; no se envió ningún mensaje.
- El diseño no cambió. En el panel solo cambió el texto bajo "Pendientes" cuando hay invitaciones en revisión.
- No se crearon cuentas, no se contrataron servicios, no se compraron dominios y no se publicaron datos personales.

## Archivos tocados

- `apps-script/src/Code.js`, `apps-script/Code.gs` (generado), `apps-script/appsscript.json`
- `shared/rsvp-rules.ts`
- `server/config.ts`, `server/index.ts` (variable `HOST`)
- `src/admin/AdminApp.tsx` (solo el texto bajo "Pendientes", que indica cuántas están en revisión)
- `tests/api/fake-gas.ts`, `tests/api/sheets.test.ts`, `tests/api/rules.test.ts`, `tests/api/helpers.ts`
- `google-sheets/README.md`, `README.md`, `.env.example`, `docs/alojamiento-render.md` (nuevo), `.node-version` (nuevo)

## Vista para revisar el diseño

- https://claude.ai/artifact/VghA5XiJGMncKVamxNHufE (privada hasta que Angel la comparta). Es la maqueta estática: se recorre el formulario, pero **no registra respuestas reales** y lo dice al guardar.
- Demostración local con familias ficticias: `npm run demo`.

## Pendientes externos (dependen de Angel)

1. **Google:** autorizar la conexión con la cuenta de los novios y recorrer la lista de verificación de `google-sheets/README.md`, incluida la nueva comprobación de `BT_SPREADSHEET_ID` y de la pantalla de autorización.
2. **Render Free:** decidir si se crea el servicio para la revisión gratuita y, después, completar `PUBLIC_BASE_URL` con la URL real.
3. Lista real de invitados, WhatsApp, contenido opcional (Amazon, transferencia, música, fecha límite), canal de contacto para "escríbenos", acentos del nombre del novio y comprobación en vivo de mapas y Liverpool: sin cambios desde R02.
