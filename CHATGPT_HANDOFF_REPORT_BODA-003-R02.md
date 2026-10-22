# CHATGPT_HANDOFF_REPORT · BODA-003-R02

**Título:** Invitaciones personales y preparación para Google Sheets
**Responsable:** Claude (implementación e integración), con dos revisores independientes (seguridad/datos y UX/QA) que revisaron y después verificaron las correcciones.
**Para:** ChatGPT, como orquestador de la estructura del proyecto.
**Sustituye a:** BODA-003-R01.

## Resumen para orquestar

- **Criterio de cierre cumplido.** En la demostración local se consulta una invitación personal, se seleccionan personas autorizadas y se guarda una respuesta de prueba. El enlace general no permite confirmar. Las validaciones del servidor impiden modificar el padrón o el cupo. La integración con Google queda preparada y declarada como **no conectada**.
- Hay un **enlace general** (detalles de la boda, sin confirmación) y un **enlace personal por familia** (sus personas, su cupo y su respuesta).
- La confirmación es **por persona**: la familia marca quiénes asistirán y el servidor calcula el número.
- **Google Sheets** será el registro principal: el código del conector y del Apps Script está listo y probado con dobles. No se creó ninguna hoja, no se desplegó nada y no se pidió ninguna credencial.
- Nada de esto necesita servicios de pago: en modo Sheets el servidor no guarda datos y cabe en un alojamiento Node gratuito.
- **Siguiente paso que depende de Angel:** autorizar la conexión con una cuenta de Google de los novios (crear la hoja y desplegar el script siguiendo `google-sheets/README.md`) y elegir alojamiento y dominio.

## Tiempos (America/Mexico_City)

| Inicio | Fin | Duración |
| --- | --- | --- |
| 2026-10-21 22:37 CST | 2026-10-22 00:25 CST | 1 h 48 min |

## Ubicación y versión

- Repositorio: https://github.com/angeloscky/boda-tachi, rama `main`.
- Commits de esta ronda:
  - `fc79cb7`: implementación.
  - `83aca21`: correcciones de las dos revisiones.
  - `8da9be4`: **commit de código final**, con lo que quedó tras la verificación de los revisores.
  - Encima va el commit que agrega este informe (sin cambios de código).
- Se partió del estado de BODA-002-R01 y se conservaron sus cambios posteriores (nombre de la novia, salón).
- Copias: `C:\Users\Pc\boda tachi\` (este informe y un `.zip` del proyecto).

## Datos confirmados aplicados

- Novia: **Sofía Lizeth García Aguilar** (se corrigió "Lisette" en el código, el README y la memoria del proyecto). Portada: "Sofía e Isaac".
- Fecha y hora: 22 de mayo de 2027. Ceremonia a las 7:00 pm y recepción a las 8:30 pm en el salón de Quinta de Torres (America/Mexico_City).
- Se conservan los lugares, los enlaces de mapas, los padres y los padrinos.
- Código de vestimenta all black. Solo adultos.

## Qué se implementó

### Enlace general (`/`)

- Muestra los detalles del evento y una sección de confirmación que explica que hace falta el enlace personal.
- No consulta la lista ni ninguna invitación, y no tiene formulario.
- Los metadatos de vista previa no llevan ningún token.
- El botón **"Compartir invitación general"** comparte siempre la URL general (`PUBLIC_BASE_URL/`), también desde un enlace personal. Si el teléfono no tiene menú para compartir, copia o muestra esa misma URL.

### Enlace personal (`/i/<token>`)

- El token es aleatorio, de 24 caracteres (144 bits).
- La familia ve su nombre, **solo sus personas activas** y su cupo.
- Cerca de la lista aparece, literal, el texto "Invitación personal e intransferible. Los lugares están reservados exclusivamente para las personas indicadas en esta invitación. Si alguno de ustedes no puede acompañarnos, su lugar no podrá transferirse a otra persona. Gracias por ayudarnos a organizar este día tan especial."
- La familia puede:
  - marcar personas, usar **"Seleccionar a todos"** (si caben en el cupo) o elegir **"Ninguno de nosotros podrá asistir"**;
  - revisar un resumen antes de guardar, por ejemplo "Asistirán 2 personas de 4 lugares reservados.";
  - cambiar su respuesta mientras las confirmaciones estén abiertas.
- No puede cambiar el cupo, agregar ni sustituir personas, editar campos de administración ni ver otras invitaciones.
- Si el cupo es menor que las personas, la página lo indica ("Pueden confirmar a un máximo de 3 de las 4 personas.") y desactiva las casillas al llegar al límite.
- El panel puede **regenerar** el enlace (el anterior deja de funcionar) o **revocarlo**.
- **Documentado** en el README, la guía de Sheets y el panel: quien tenga el enlace puede consultar y cambiar la respuesta de esa invitación; reenviarlo transmite esa capacidad; el enlace no identifica a quien lo abre. No hay OTP, cuentas de invitado ni verificación por WhatsApp.
- Los lugares que no se usen no se reasignan solos: quedan a decisión de los novios.

### Reglas de confirmación (`shared/rsvp-rules.ts`)

Son las mismas en el servidor y en Apps Script, porque se empaquetan dentro de `Code.gs`. Validan:

- **Acceso:** token válido, confirmaciones abiertas, invitación activa con cupo asignado.
- **Personas:** cada una pertenece a la invitación y está activa; no hay IDs repetidos ni inventados; la selección no supera el cupo.
- **Coherencia:** "no asistirán" va sin personas.
- **Campos:** se rechaza cualquier campo de administración y cualquier cantidad enviada por el navegador. El número lo calcula el servidor.
- **Repeticiones y versiones:**
  - Una sola respuesta vigente por invitación.
  - Un `requestId` repetido no duplica nada; si llega con otra selección, se rechaza.
  - Una revisión desactualizada da conflicto con la respuesta vigente.
  - La revisión nunca retrocede, aunque se borre la respuesta.
- **En la interfaz:** la selección se conserva ante cualquier error, y el éxito solo aparece cuando el servidor confirma.
  - Si no hubo respuesta del servidor (red o 5xx), el aviso dice "No sabemos si se guardó tu respuesta" y reintentar no duplica.
  - Si el cupo o las personas cambiaron mientras la familia revisaba, se recarga la invitación y se le pide revisar.

### Arquitectura y almacenamiento

```
navegador → servidor de la invitación (/api) → GuestStore
                                             ├─ demo:   SQLite local con familias ficticias (no es producción)
                                             ├─ sheets: conector firmado → Apps Script → hoja privada (preparado, no conectado)
                                             └─ (vacío) sin registro: confirmación "todavía no habilitada"
```

- Las reglas están separadas del almacenamiento. Cada almacenamiento es intercambiable y todos usan las mismas reglas.
- **Conector de Sheets** (`server/sheets/client.ts`):
  - Solo cuatro operaciones explícitas: `ping`, `getInvitation`, `saveResponse` y `summary`. No hay lectura ni escritura de rangos arbitrarios.
  - Firma HMAC-SHA256 en las solicitudes y en las respuestas, con hora, nonce y operación.
  - Sigue la redirección de Google a mano y solo hacia `script.googleusercontent.com`.
  - Exige JSON firmado. Un HTML, una página de inicio de sesión, una firma incorrecta o un tiempo agotado se tratan como error reintentable, nunca como éxito. No se usa `no-cors`.
- **Apps Script** (`apps-script/src/Code.js` → `apps-script/Code.gs`):
  - Lee las columnas por encabezado y escribe bajo `LockService`.
  - Antes de escribir comprueba que la fila sigue siendo de esa invitación; después hace `flush()` y vuelve a leer para verificar.
  - Si la invitación tiene datos inconsistentes en la hoja (ID repetido, persona compartida con otra invitación, `activa` no reconocida, respuesta mal capturada), no la atiende, pide revisar y la marca en **Revisar la lista**.
  - Las filas `EJEMPLO-`/`DEMO-` nunca se atienden ni reciben enlace.
  - Menú **Boda**:
    - Preparar estructura, que crea las protecciones de advertencia.
    - Generar enlaces faltantes, Regenerar y Revocar.
    - Revisar la lista y Actualizar resumen.
    - Abrir y cerrar confirmaciones.
- **Lo que el bloqueo no hace:** coordina las escrituras del script, pero **no impide ediciones manuales** en la hoja. Para cambios sensibles hay un procedimiento: cerrar confirmaciones → hacer el cambio → Revisar la lista → abrir confirmaciones. Las protecciones de columnas no sustituyen los permisos del archivo.
- **Producción sin configuración:** con `NODE_ENV=production`, el servidor exige `PUBLIC_BASE_URL` y no arranca la demostración salvo `DEMO_IN_PRODUCTION=1`. Sin registro configurado, nunca cae a la demostración.

### Estructura de la hoja

- **Pestañas:** Invitaciones, Personas y Respuestas, más Config y Resumen.
- **IDs:** estables (`INV-001`, `INV-001-P1`) y nunca el número de fila.
- **Respuestas:** una fila vigente por invitación, sin versiones duplicadas.
- **Totales:** se derivan con las mismas reglas del servidor.
- **Plantillas ficticias:** `google-sheets/plantillas/*.csv`, generadas desde `shared/sheets-templates.ts`. Respuestas trae solo encabezados.
- **Importación en el panel de la demostración:**
  - Primero muestra una vista previa y no aplica nada si hay un solo error.
  - Reimportar actualiza sin duplicar.
  - Nunca combina por apellido o teléfono; solo avisa.
- Guía completa en `google-sheets/README.md`, con la lista de verificación pendiente para la primera conexión real.

### Estados honestos

| Estado | Qué ve el invitado |
| --- | --- |
| Demostración (`RSVP_BACKEND=demo`) | Aviso fijo "Demostración local con familias ficticias"; las respuestas son de prueba. |
| Vista estática (`npm run build:static`) | Aviso "Vista de diseño sin servidor"; al guardar dice que la respuesta no se registró. |
| Producción sin Google (`RSVP_BACKEND` vacío) | "La confirmación en línea todavía no está habilitada"; sin formulario ni éxitos simulados. |
| Conexión futura (`RSVP_BACKEND=sheets`) | Confirmación normal; éxito solo cuando Apps Script verifica la escritura. Sin URL o secreto válidos: "no conectado". |

### Correcciones pedidas

- Lisette → **Lizeth**.
- El calendario (`/calendario.ics`) ya no inventa una duración: no lleva hora de término.
- El logo se volvió a vectorizar con un umbral adaptativo para que las líneas finas de la fecha no se corten. El monograma no cambió.
- Se conservan la accesibilidad, el movimiento reducido y la opción de omitir el sobre.
- No se trabajó en el despliegue de pago con Docker y SQLite.

## Pruebas realizadas (datos ficticios)

Comandos ejecutados en esta sesión sobre el commit final:

- `npm test`: **75/75** (Vitest + Supertest; Apps Script se ejecuta con dobles de `SpreadsheetApp`, `LockService`, `PropertiesService` y la redirección de Google).
- `npm run typecheck`: sin errores.
- `npm run build` y `npm run build:static`: correctos.
- `npx playwright test`: **36/36** (18 recorridos en iPhone 13 y 18 en escritorio de 1440×900, sobre el servidor compilado), dos corridas completas seguidas en verde con el código final.
- Durante la ronda falló una vez una prueba de teclado: el foco tras abrir el sobre llegaba un cuadro tarde. Se corrigió en el código (el foco se mueve en el mismo render) y no en la prueba.

| # | Prueba pedida | Resultado | Dónde |
| --- | --- | --- | --- |
| 1 | El enlace general no confirma | ✅ | e2e "(1)(11) el enlace general…": sin formulario ni llamadas a `/api/invitations`; un PUT sin token da 404 |
| 2 | Aislamiento A/B | ✅ | API "la familia A no ve ni modifica…", Sheets "la familia A solo recibe sus personas…", e2e "(2)" |
| 3 | 2 de 4 confirmadas, cupo intacto | ✅ | API, reglas y Sheets "2 de 4…"; e2e "(3)(12)" (el panel muestra cupo 4, asisten 2) |
| 4 | Nombres ajenos, duplicados y cupo manipulado rechazados | ✅ | API "rechaza nombres ajenos, IDs duplicados o inventados y cupos manipulados"; reglas "rechaza campos administrativos…"; Sheets "valida en el script…" |
| 5 | Reenvío sin duplicar | ✅ | API "reenviar la misma solicitud no duplica, y doce envíos en paralelo…"; reglas "reutilizar un requestId con otra selección…"; e2e "(5)" (doble toque = una solicitud) |
| 6 | Conflicto concurrente | ✅ | API "dos personas con el mismo enlace…" y "si el administrador borra la respuesta…"; e2e "(6)" (guardar de nuevo y conservar la vigente) |
| 7 | Token revocado | ✅ | API "un enlace revocado deja de funcionar…"; Sheets "revocar desde el menú se respeta…"; e2e "(7)" |
| 8 | Error de almacenamiento sin éxito falso | ✅ | API "un error de almacenamiento…" y "una falla de SQLite a media transacción…"; Sheets "bloqueo ocupado o escritura fallida…" y "una respuesta alterada…"; e2e "(8)" (4xx, 5xx y sin conexión) |
| 9 | Producción sin configuración no cae a la demo | ✅ | modos "producción sin Google configurado…" y "en producción exige PUBLIC_BASE_URL…"; e2e "(9)" en un segundo servidor sin registro |
| 10 | Ordenar filas conserva identidades | ✅ | Sheets "ordenar filas y mover columnas…"; importación "ordenar las filas del archivo…" |
| 11 | Compartir usa el enlace general | ✅ | e2e "(1)(11)" y "(11) compartir desde un enlace personal…" (sin token en lo compartido, en los metadatos ni en los enlaces) |
| 12 | Recorrido en móvil y escritorio | ✅ | Toda la suite e2e corre en los dos perfiles. Capturas en `docs/capturas/` |

**Otras pruebas de navegador:**
- teclado: orden de tabulación y foco en encabezados tras cada cambio de vista;
- movimiento reducido y Escape para omitir el sobre;
- seleccionar a todos, cancelar un cambio y textos en singular;
- recarga cuando cambia el cupo mientras se revisa;
- confirmaciones cerradas;
- la barra inferior no tapa el botón de guardar;
- panel sin sesión;
- vista estática sin llamadas a la API.

**Lo que las pruebas no acreditan:** los dobles de Apps Script no prueban una conexión real con Google. Ver "Verificación pendiente".

## Revisión independiente

**Seguridad y datos.** Hallazgos corregidos:
- Integridad de cada invitación en la hoja antes de leer o escribir (IDs repetidos, personas compartidas, `activa` ambigua, respuestas capturadas a mano): ahora se pide revisar.
- Revocar no era duradero. Ahora el script escribe `revocado` y "Generar enlaces faltantes" lo respeta.
- Las filas de ejemplo podían volverse reales. Ahora usan IDs `EJEMPLO-` que nunca se atienden.
- La revisión retrocedía al borrar una respuesta (migración v4 `revision_floor`).
- Un `requestId` reutilizado con otra selección se tomaba como repetición.
- La escritura podía caer en una fila que cambió de lugar.
- El tope global de intentos del panel dejaba entrar con la contraseña correcta.
- La producción podía arrancar en demo o sin URL pública.

*Verificación del revisor sobre `83aca21`:*
- 11 de 14 hallazgos quedaron corregidos.
- Lo que quedaba se corrigió en `8da9be4`, con pruebas:
  - En Sheets, borrar a mano una fila de Respuestas reiniciaba la revisión. Ahora el script guarda la última revisión escrita por invitación.
  - Un teléfono, lado o notas mal capturados bloqueaban a la familia. Ahora solo se reportan.
  - Una invitación desactivada con otro problema respondía "revisar" en vez de "no encontrada".
- **Riesgos aceptados y documentados:**
  - **Tope global del panel.** Alguien puede mantenerlo bloqueado a propósito con 30 intentos por hora. Se prefirió eso a permitir adivinar la contraseña desde muchas IP. El contador se limpia al reiniciar, y en modo Sheets la lista se administra en la hoja con la cuenta de Google.
  - **Nonce no atómico.** Ver "Limitaciones".
  - **`http://` en producción.** Ahora arroja un aviso al arrancar.

**UX/QA.** Hallazgos corregidos:
- Foco perdido tras cambiar de vista.
- Concordancias de singular y plural según las personas.
- Error ambiguo cuando no se sabe si se guardó.
- La barra inferior tapaba el botón de guardar en celular.
- "Ninguno" estaba fuera del grupo de casillas.
- Regenerar enlace sin confirmación, y acciones del panel que borraban ediciones sin guardar.
- Áreas táctiles del panel de menos de 44 px.
- Menú de exportar cortado en celular.
- El mensaje de WhatsApp contaba lugares en vez de personas.
- El `.ics` ahora se sirve desde el servidor.

*Verificación del revisor sobre `83aca21`:*
- La mayoría de los hallazgos quedaron corregidos.
- Lo que quedaba se corrigió en `8da9be4`, con pruebas:
  - Foco en el aviso cuando se cierran las confirmaciones durante la revisión, y foco en la sección al usar "Reintentar".
  - El aviso de lugares sin usar se calcula con el mínimo entre cupo y personas.
  - La revisión se desplaza arriba para dejar el botón a la vista. No se volvió a medir a 320 px de ancho.
  - "Exportar" y "Plantillas" ya no se abren a la vez, tienen título en el teléfono y se cierran con Escape o tocando fuera.
  - La lista del panel avisa "cupo mayor que personas".
  - "Registrar respuesta recibida por otro medio" ya mide 44 px.

## Cómo llega la invitación al teléfono de cada invitado

1. Cada familia tiene su enlace personal `https://<dominio>/i/<token>`.
   - En modo Sheets, el token se genera con **Boda → Generar enlaces faltantes** y la columna `enlace` arma la URL.
   - En la demostración, el panel lo genera al dar de alta la invitación.
2. El enlace va en un mensaje de WhatsApp. El texto ya está escrito en `shared/message.ts`: saluda a la familia, dice cuántos lugares hay reservados (sin pasar del número de personas) e incluye el enlace.
3. El invitado toca el enlace. WhatsApp muestra una tarjeta general ("Sofía e Isaac · 22 de mayo de 2027", sin datos de la familia). Al abrirla, ve el sobre, la invitación y su lista de personas. Marca quiénes asistirán, revisa y guarda. Puede volver al mismo enlace para cambiar su respuesta mientras las confirmaciones estén abiertas.
4. Si alguien quiere reenviar la boda a otra persona, el botón "Compartir invitación general" reenvía solo la página general. Si reenvía su enlace personal, transmite la capacidad de responder por su invitación.
5. Requisito previo: la aplicación publicada en un dominio. Mientras corra en una computadora, los enlaces no abren desde los teléfonos.

**Envío:**
- Por ahora solo hay preparación y simulación, que no envía nada. En la demostración, el panel prepara el texto, abre `wa.me` y exporta Mensajes CSV.
- En modo Sheets, los enlaces se toman de la columna `enlace`.
- El envío automatizado requeriría WhatsApp Business Platform y queda para otra fase.

## Demo revisable

- Local con familias ficticias (`DEMO-001…005`): `npm run demo`. Instrucciones y tabla de casos en el README.
- Vista de diseño sin servidor (se recorre el formulario, pero nada se registra): https://claude.ai/artifact/VghA5XiJGMncKVamxNHufE (privada hasta que Angel la comparta).
- Capturas de móvil y escritorio en `docs/capturas/` (sobre, portada, invitación completa, selección, revisión, guardado, enlace general, conflicto, panel, sin registro).

## Limitaciones conocidas

- **Google no está conectado.** No se comprobó en Google el manifiesto, la autorización, las fórmulas, las validaciones, las protecciones, el despliegue ni los tiempos de respuesta. La lista está en `google-sheets/README.md`, sección "Verificación pendiente".
- **Bloqueo y ediciones manuales:** el bloqueo del script no impide editar la hoja a mano. Para eso está el procedimiento de cambios sensibles.
- **Nonces:** el registro de nonces usa la caché del script fuera del bloqueo. Dos copias idénticas de una misma solicitud firmada, enviadas a la vez, podrían pasar ambas. Para eso habría que capturar una solicitud firmada que viaja por HTTPS, y aun así `requestId` evita duplicar la respuesta.
- **WhatsApp:** en modo Sheets, el panel muestra estado, totales y problemas, pero no prepara mensajes; esa preparación existe solo en la demostración local.
- Los textos "escríbenos" (confirmación cerrada, detalle por revisar) no tienen todavía un canal de contacto: falta el dato.
- El tope global de intentos del panel puede usarse para bloquearlo a propósito (riesgo aceptado; ver "Revisión independiente").
- Un enlace personal inexistente también muestra el sobre antes del aviso "No encontramos esta invitación".
- El logo sigue siendo un trazado automático de una captura, no el vector original de la diseñadora.

## Pendientes externos (dependen de Angel)

1. **Google:** autorizar la conexión. Con la cuenta de los novios hay que crear la hoja privada, pegar el script, definir `BT_SHARED_SECRET` y desplegar la aplicación web. Luego, configurar `RSVP_BACKEND=sheets`, `SHEETS_WEBAPP_URL` y `SHEETS_SHARED_SECRET` en el servidor y recorrer la lista de verificación.
2. **Alojamiento gratuito y dominio** para el servidor Node sin estado. Hay que definir `PUBLIC_BASE_URL`, `ADMIN_PASSWORD_HASH` y `TRUST_PROXY`.
3. **Lista real de invitados** (unas 100 invitaciones y 250 personas), capturada en la hoja con IDs estables. No se cargó nada real.
4. **WhatsApp:** decidir entre envío manual con `wa.me` y una fase posterior con la API de Meta.
5. **Contenido opcional sin datos:** mesa de Amazon, transferencia, música y fecha límite. No se inventó nada.
6. **Canal de contacto** para los avisos "escríbenos".
7. **Acentos del nombre del novio** ("Vazquez Gonzalez" sin acentos, tal como se registró) por confirmar.
8. **Comprobar en vivo** que cargan los enlaces de mapas y de Liverpool (la red de este entorno los bloquea).
9. **SVG original del logo**, si existe.
