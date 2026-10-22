# Google Sheets como registro principal

> **Estado: preparado, no conectado.** No se creó ninguna hoja ni se desplegó Apps Script. El código del conector y del script está listo y se probó solo con dobles locales (`tests/api/sheets.test.ts`); los dobles no acreditan una conexión real. Todo lo marcado como *pendiente de verificar* debe comprobarse la primera vez que se conecte una hoja real.

## Cómo funciona

```
invitado (navegador) → servidor de la invitación (/api) → POST firmado → Apps Script (aplicación web) → hoja privada
```

- El navegador nunca habla con Google ni conoce el secreto. Solo llama a la API de la invitación con su enlace personal.
- El servidor firma cada solicitud con HMAC-SHA256 (`SHEETS_SHARED_SECRET`) e incluye operación, hora y un nonce de un solo uso. El script rechaza firmas inválidas, solicitudes de más de 5 minutos y nonces repetidos.
- El script solo acepta cuatro operaciones: `ping`, `getInvitation`, `saveResponse` y `summary`. No hay lectura ni escritura de rangos arbitrarios.
- Cada respuesta del script va firmada y repite la operación y el nonce. El servidor sigue a mano la redirección de Google (`script.google.com` → `script.googleusercontent.com`, y ningún otro dominio), exige JSON y verifica la firma. Una página de inicio de sesión, un HTML, una firma que no cuadra o un tiempo agotado se tratan como error: el invitado ve "no se registró; inténtalo de nuevo", nunca un éxito.
- `saveResponse` lee, valida con las mismas reglas del servidor (`shared/rsvp-rules.ts`, empaquetadas en `Code.gs`) y escribe bajo `LockService`. Antes de escribir comprueba que la fila sigue siendo la de esa invitación; después hace `flush()` y vuelve a leer la fila, y solo si coincide responde éxito. Bloqueo ocupado o escritura fallida = error reintentable. Tras un tiempo agotado el invitado ve "no pudimos comprobar que se guardara; inténtalo de nuevo" (reintentar no duplica).
- Como la hoja se edita a mano, antes de mostrar o guardar una invitación el script exige que su fila sea válida, que su `id_invitacion` no esté repetido (sin importar mayúsculas), que sus personas sean válidas y no aparezcan en otra invitación, y que tenga a lo sumo una respuesta válida. Si algo falla, la familia ve "Tu invitación tiene un detalle pendiente de revisar. Escríbenos" y no se lee ni escribe nada; el detalle aparece en **Revisar la lista** y en el panel.

## Estructura del archivo

Un solo archivo con estas pestañas. Las columnas se leen **por su encabezado**, así que se pueden reordenar u ordenar filas sin cambiar identidades.

**Invitaciones**

| Columna | Contenido |
| --- | --- |
| `id_invitacion` | ID estable (p. ej. `INV-001`). Nunca se reutiliza ni se cambia. No uses el número de fila. |
| `lado` | `novia`, `novio` o `ambos`. |
| `grupo` | Nombre que ve la familia ("Familia …"). |
| `contacto_principal` | Opcional. |
| `telefono` | Opcional; 10 dígitos o con 52. Solo para el panel; el invitado nunca lo ve. |
| `cupo` | Lugares asignados (1–30). Vacío = pendiente: la familia aún no puede confirmar. |
| `activa` | `sí` / `no`. Vacío cuenta como `sí`; cualquier otro valor cuenta como inactiva y se reporta. |
| `token` | *Técnica.* La escribe el menú "Generar enlaces faltantes". `revocado` = enlace anulado a propósito (no se vuelve a generar solo). |
| `enlace` | *Técnica.* Fórmula `url_publica + /i/ + token` (vacía si no hay token válido). |
| `notas` | Privadas. El invitado nunca las ve. |

**Personas** — `id_persona` (estable, p. ej. `INV-001-P1`), `id_invitacion`, `nombre` (como lo verá la familia), `activa`.

**Respuestas** (todas técnicas; las escribe el script) — `id_invitacion`, `personas_seleccionadas` (IDs separados por coma), `estado` (`asistirá` / `no asistirá`), `revision`, `fecha_hora`, `id_solicitud`.

- Una sola fila vigente por invitación. Cambiar la respuesta reescribe esa fila y sube `revision`; no se guardan versiones duplicadas en otras pestañas.
- Los totales se derivan de la fila vigente con las reglas del servidor: el panel los pide con la operación `summary` y la pestaña **Resumen** se recalcula con **Boda → Actualizar resumen** (también al revisar la lista). Las filas con errores de formato no se cuentan y aparecen como problemas.

**Config** — `confirmaciones_abiertas` (casilla), `url_publica` (igual a `PUBLIC_BASE_URL`), `version_estructura`.

Plantillas con ejemplos **ficticios**: `google-sheets/plantillas/*.csv` (se generan con `npm run sheets:build` desde `shared/sheets-templates.ts`). Las filas de ejemplo usan IDs `EJEMPLO-…`: el script nunca les genera enlace ni las atiende, así que una fila olvidada no se vuelve real. Aun así, bórralas antes de cargar invitados reales y usa tu propio esquema de IDs (por ejemplo `INV-001`, `INV-001-P1`). La plantilla de Respuestas solo trae encabezados.

## Instalación (pendiente)

Requiere una cuenta de Google de los novios o de quien administre. No tiene costo.

1. Crea una hoja de cálculo nueva en Google Drive. Déjala **privada** y compártela solo con quien administra.
2. Opcional: importa las plantillas (Archivo → Importar → Subir, "Insertar hojas nuevas"), una por pestaña, y renómbralas `Invitaciones`, `Personas` y `Respuestas`.
3. Extensiones → Apps Script. Reemplaza el contenido de `Código.gs` por `apps-script/Code.gs`. En Configuración del proyecto activa "Mostrar el archivo de manifiesto" y reemplaza `appsscript.json` por `apps-script/appsscript.json`.
4. Configuración del proyecto → Propiedades del script → agrega `BT_SHARED_SECRET` con un secreto de al menos 32 caracteres (el mismo que irá en `SHEETS_SHARED_SECRET`).
5. Recarga la hoja. Aparece el menú **Boda**. Elige **Preparar estructura** (Google pedirá autorizar el script la primera vez). Crea lo que falte, agrega validaciones, notas, la fórmula de `enlace`, la pestaña Resumen y las protecciones. No borra datos de Invitaciones, Personas ni Respuestas (la pestaña Resumen sí se reescribe).
6. En **Config**, escribe `url_publica` (por ejemplo `https://tu-dominio`).
7. Captura Invitaciones y Personas. Luego **Boda → Generar enlaces faltantes** y **Boda → Revisar la lista**.
8. Implementar → Nueva implementación → Tipo: Aplicación web. *Ejecutar como:* Yo. *Quién tiene acceso:* Cualquier persona. Copia la URL que termina en `/exec`.
   "Cualquier persona" es necesario porque el servidor llama sin sesión de Google; la protección es la firma: sin una firma válida el script responde `unauthorized` y no entrega datos.
9. En el servidor: `RSVP_BACKEND=sheets`, `SHEETS_WEBAPP_URL=<url /exec>` y `SHEETS_SHARED_SECRET=<secreto>`. El panel `/admin` muestra el estado de la conexión, los totales y los problemas de la lista.

Al cambiar el código del script: Implementar → Gestionar implementaciones → editar → Versión nueva (la URL se conserva).

### Verificación pendiente con una hoja real

- [ ] El manifiesto se acepta tal cual (alcances `spreadsheets.currentonly` y `script.container.ui`) y la autorización no pide más permisos.
- [ ] **Preparar estructura** crea validaciones, protecciones, la fórmula de `enlace` y el Resumen sin errores de sintaxis.
- [ ] Una fila con `id_invitacion` repetido muestra "detalle pendiente de revisar" a ambas familias y aparece en **Revisar la lista**.
- [ ] El panel muestra "Conectado" y totales correctos.
- [ ] Un enlace de prueba (familia ficticia) carga solo sus personas; guardar escribe una fila en Respuestas y `revision` sube al cambiar.
- [ ] Dos teléfonos guardando a la vez: uno recibe el aviso de conflicto con la respuesta vigente.
- [ ] Con `BT_SHARED_SECRET` distinto, el invitado ve "no se registró" y nada se escribe.
- [ ] Revocar y regenerar desde el menú invalida el enlace anterior.
- [ ] Tiempos de respuesta aceptables desde el alojamiento elegido (Apps Script suele tardar 1–3 s).

## Privacidad y permisos

- La hoja contiene teléfonos, notas y tokens: debe seguir compartida solo con quien administra. **Ocultar o proteger columnas no sustituye los permisos del archivo**: cualquiera con acceso de edición puede ver y copiar los tokens.
- Las protecciones de columnas técnicas y de Respuestas son de advertencia (avisan antes de editar a mano); no impiden nada a quien tenga permiso de edición.
- La API pública solo devuelve una invitación a partir de su token, con su nombre, sus personas activas, su cupo y su respuesta. Nunca la lista, teléfonos ni notas.
- **Enlace personal:** quien tenga el enlace puede consultar y cambiar la respuesta de esa invitación. Reenviarlo transmite esa capacidad. El enlace no identifica a la persona que lo abre. Si un enlace llegó a quien no debía, revócalo o regenéralo desde el menú.

## Concurrencia y cambios manuales

- El bloqueo del script coordina las escrituras **del script** (respuestas, enlaces, abrir/cerrar). **No impide** que alguien edite la hoja a mano al mismo tiempo.
- Cambios de enlaces: usa siempre el menú (**Generar**, **Regenerar**, **Revocar**), que trabaja bajo el bloqueo. Revocar escribe `revocado`; **Generar enlaces faltantes** lo respeta y solo **Regenerar** le da un enlace nuevo.
- Cambios sensibles con confirmaciones abiertas (cupo, personas, activar/desactivar, una respuesta recibida por teléfono):
  1. **Boda → Cerrar confirmaciones.** Las familias ven su respuesta pero no pueden cambiarla.
  2. Haz el cambio. No bajes el cupo por debajo de las personas confirmadas ni desactives a alguien confirmado. Para registrar una respuesta a mano, edita la fila de esa invitación en Respuestas: `estado` exactamente `asistirá` o `no asistirá`, los IDs de persona separados por coma, `revision` + 1 y un `id_solicitud` nuevo. **No borres filas de Respuestas**: la revisión volvería a empezar y un teléfono con la vista vieja podría sobrescribir sin aviso.
  3. **Boda → Revisar la lista** y corrige lo que marque.
  4. **Boda → Abrir confirmaciones.**
- Los lugares que una familia no use no se reasignan solos ni los puede tomar otra familia; decidir qué hacer con ellos es cosa de los novios.

## Límites conocidos

- Sin conexión real no se ha comprobado nada en Google (ver lista de verificación).
- Las fórmulas usan la sintaxis en inglés que exige Apps Script al escribirlas; Sheets las muestra con la configuración regional del archivo.
- Apps Script tiene cuotas diarias y tiempos de ejecución propios; para unas 250 personas sobra, pero conviene confirmarlo en la prueba real.
- El registro de nonces usa la caché del script fuera del bloqueo: dos copias idénticas de una misma solicitud firmada, enviadas a la vez, podrían pasar ambas. Requiere haber capturado una solicitud firmada (viaja por HTTPS) y, aun así, `requestId` evita que se duplique la respuesta.
- En modo Sheets, el panel muestra estado, totales y problemas; la lista se administra en la hoja. La preparación de mensajes de WhatsApp del panel funciona solo en la demostración local por ahora.
