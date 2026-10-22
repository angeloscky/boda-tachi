# CHATGPT_HANDOFF_REPORT · BODA-002-R01

**Título:** Boda Tachi · Invitación digital de Sofía e Isaac (primera versión integral)
**Responsable:** Claude (diseño, desarrollo e integración), con dos revisores independientes (UX/QA y datos/seguridad).
**Para:** ChatGPT, como orquestador de la estructura del proyecto.

## Resumen para orquestar

- La invitación, la confirmación con base de datos, el panel, el CSV y la preparación de mensajes están construidos y probados en local.
- **Pendientes de estos días** (dependen de Angel): la lista definitiva de invitados, la conexión de WhatsApp y el alojamiento con dominio. Nada de eso bloquea el código: entran como datos o configuración.
- **Ya resueltos por Angel (21:45 CST):**
  - La recepción es en el salón de Quinta de Torres, no en la terraza. Ya aparece en la invitación.
  - Los apellidos de la novia son García Aguilar. El nombre completo quedó como "Sofía Lizeth García Aguilar"; falta confirmar si el segundo nombre se escribe Lizeth o Lisette (Angel lo dictó por voz).
- Próximo paso recomendado: publicar el backend en un alojamiento con disco persistente, para tener el dominio con el que se arman los enlaces que irán por WhatsApp.

## Tiempos (America/Mexico_City)

| Inicio | Fin | Duración |
| --- | --- | --- |
| 2026-10-21 20:55 CST | 2026-10-21 21:45 CST | 50 min |

La primera maqueta navegable se publicó a las 21:12 (17 min después del inicio).

## Ubicación y versión

- Repositorio: https://github.com/angeloscky/boda-tachi, rama `main`, commit de código `ece9af8`.
- Se trabajó en un contenedor Linux en la nube. `C:\BODA_TACHI` no existía y no había acceso a `C:\`, así que la raíz acordada en el equipo de Angel es `C:\Users\Pc\boda tachi`. Ahí están el logo original y una copia `.zip` del proyecto.
- No existía BODA-001, así que se partió de cero con el stack acordado.

## Qué se implementó

1. **Invitación pública adaptable a celular.** Incluye:
   - Sobre oscuro con el monograma original en el sello. Se abre con un toque y respeta el movimiento reducido. Se puede omitir con un botón o con Escape, y el contenido está debajo aunque falle la animación.
   - Portada con el logo vectorizado y una frase.
   - Padres y padrinos con los nombres corregidos.
   - Ceremonia y recepción, cada una con botón "Cómo llegar". También hay un archivo .ics para agregar al calendario.
   - All black y solo adultos, Liverpool 60031248 y confirmación.
   - Una barra inferior con Ubicaciones, Regalos y Confirmar.
   - Todo es HTML seleccionable y no hay fotos.
   - Metadatos para WhatsApp con una imagen general (`og-image.jpg`), sin datos de familias.
2. **Confirmación con persistencia real** (Express + SQLite con `node:sqlite`):
   - Una respuesta vigente por invitación (clave primaria), con escrituras `BEGIN IMMEDIATE`, historial y revisión.
   - El servidor valida existencia, entero, no negativo, límite de lugares, 0 si no asiste, lugares sin asignar y confirmaciones cerradas.
   - El éxito solo se muestra después de que el servidor confirma. Si falla, se conserva la selección y se puede reintentar.
3. **Enlaces opacos** de 144 bits (24 caracteres) por invitación. Se pueden regenerar, y el anterior deja de funcionar.
4. **Panel privado `/admin`.** Incluye:
   - Contraseña con hash scrypt y sesión en servidor (cookie HttpOnly y SameSite=Strict), con límite de intentos.
   - Búsqueda y filtros (pendiente, asistirá, no asistirá, sin lugares).
   - Alta y edición, teléfono opcional, copiar enlace, totales de invitaciones y adultos, y abrir o cerrar confirmaciones.
   - Registro manual de respuestas y descarga de respaldo.
5. **CSV.** Plantilla, revisión previa con errores y avisos, y aplicación todo o nada. Reimportar no duplica, no cambia enlaces y no distingue mayúsculas. Nunca combina registros por apellido o teléfono. La exportación viene protegida contra fórmulas y se puede reimportar.
6. **Preparación para WhatsApp.** Destinatario, teléfono, enlace, texto, vista previa, copiar, `wa.me` y Mensajes CSV. La interfaz `MessagingProvider` usa el proveedor `simulation`, que nunca envía. El estado de comunicación (preparado, enviado o entregado, manual o del proveedor) está separado del de asistencia.
7. **Datos de demostración sintéticos** (`DEMO-`), marcados y excluidos de totales y exportaciones. Hay migraciones, respaldo y restauración, un Dockerfile y el README.

## Qué funciona y cómo se comprobó

`npm test` da **31/31** en verde (Vitest + Supertest con bases temporales). `npm run test:e2e` da **12/12** en verde (Playwright con Chromium, perfiles iPhone 13 y escritorio de 1440×900, sobre el servidor compilado).

| # | Prueba pedida | Resultado | Dónde |
| --- | --- | --- | --- |
| 1 | Recorrido completo en móvil y escritorio | ✅ | e2e "recorrido completo" (ambos perfiles) |
| 2 | Legibilidad y teclado | ✅ | e2e "teclado y movimiento reducido": foco, salto, sobre `inert` y respuesta solo con teclado. El revisor UX midió contraste AA o mejor (el mínimo es 5.09:1). |
| 3 | Enlaces a ubicaciones y Liverpool | ✅ con una nota | `href` exactos, pestaña nueva y `noopener noreferrer` comprobados, y la pestaña se abre. La red de este entorno bloquea esos dominios, así que no se pudo comprobar en vivo que carguen (ver pendientes). |
| 4 | Respuesta persiste tras reiniciar | ✅ | `restart.test.ts`: el proceso del servidor se detiene y se vuelve a levantar sobre el mismo archivo |
| 5 | Doble envío, una sola respuesta | ✅ | 12 PUT en paralelo dan 1 fila y revisión 1, y lo mismo con dos conexiones. El doble clic en la interfaz manda una sola petición. |
| 6 | Rechazo de exceso de lugares en servidor | ✅ | API 400 `too_many_adults` |
| 7 | Aislamiento entre invitaciones | ✅ | La vista pública no expone teléfono, notas, identificador ni token. No hay cruce entre tokens. |
| 8 | Admin inaccesible sin autenticación | ✅ | Las 20 rutas dan 401, incluida una cookie falsa. El logout invalida la sesión en el servidor. |
| 9 | Fallo de guardado sin éxito | ✅ | e2e con error 500 y sin conexión: no aparece la confirmación, la selección se conserva y el reintento funciona |
| 10 | Reimportación CSV sin duplicados | ✅ | Segunda importación: 0 nuevas, 3 sin cambios, mismos enlaces |

El criterio de cierre está cumplido: una familia de prueba abre su enlace, confirma, la respuesta sobrevive al reinicio y el administrador la ve en el panel ("Asistirá · 4").

También se simuló el despliegue de producción: solo dependencias de producción y `dist/`, con `NODE_ENV=production`. Arrancó bien, con `og:image` absoluto y HSTS activo con https. El Dockerfile no se construyó aquí porque no hay demonio de Docker.

## Estado

| Componente | Estado |
| --- | --- |
| Frontend | Operativo y verificado en móvil y escritorio. Hay una maqueta estática (sin servidor, lo indica en pantalla) en https://claude.ai/artifact/VghA5XiJGMncKVamxNHufE |
| API | Operativa en local y en el entorno de pruebas |
| Persistencia | SQLite en `data/` (fuera de las carpetas públicas), WAL y `synchronous=FULL`, con migraciones v1 y v2, respaldo y restauración |
| Administración | Operativa |
| WhatsApp | Preparado en modo simulación. No envía nada. La conexión real está pendiente. |
| Publicación | No hay alojamiento configurado, así que no existe URL de revisión con backend. El despliegue es reproducible (README y Dockerfile). |

## Hallazgos de revisión y correcciones

**Seguridad y datos (8 hallazgos, todos corregidos y con prueba):**
- `CLIENT_DIR` podía exponer la base. Ahora la base se rechaza dentro de cualquier carpeta servida.
- El límite de intentos se podía burlar con `X-Forwarded-For`. Ahora hay que declarar `TRUST_PROXY` y existe un tope global.
- Importar sin la columna de teléfono borraba los teléfonos. Ahora se conservan y la revisión dice qué cambia.
- Los identificadores distinguían mayúsculas. Ahora hay un índice único `NOCASE` (migración v2).
- Los cuerpos grandes o un `Origin` nulo daban 500. Ahora dan 413 y 403, y los límites quedan en 16 kB general y 2 MB para la importación.
- El origen se comparaba con `Host`. Ahora se compara con `PUBLIC_BASE_URL`.
- Las sesiones sobrevivían a un cambio de contraseña. Ahora se cierran, y se añadió HSTS.
- `/index.html` se servía sin plantilla. Corregido.

**UX/QA (18 hallazgos, corregidos):**
- El foco podía escapar del sobre. Ahora `<main>` queda `inert`.
- Se perdía el foco al guardar y el error no lo recibía. Corregido.
- La barra inferior tapaba elementos. Se añadió `scroll-padding-bottom`.
- El botón "Cerrar" de confirmaciones era ambiguo y no pedía confirmación. Corregido.
- "Cancelar cambio" conservaba la selección no guardada. Ahora la descarta.
- Las cifras de estilo antiguo hacían que "1" se leyera como "I". Corregido.
- El `alt` del logo tenía barras verticales. Corregido.
- Mensaje de error repetido, y un error del servidor se presentaba como problema de conexión. Corregido.
- Concordancias de singular y plural en el formulario, el resumen, el panel y el mensaje. Corregidas.
- Los enlaces truncados mostraban la página general. Ahora avisan "No encontramos esta invitación".
- Faltaba una pista cuando falta el número de adultos. Añadida.
- La cantidad elegida se distinguía poco. Ahora se rellena en olivo.
- La sección se renombró a "Detalles del día".
- El texto duplicado en invitaciones sin lugares se quitó.
- Los botones del panel en celular ahora miden 44 px.
- La redacción de la simulación de WhatsApp quedó más clara.
- Al crear una invitación, el diálogo sigue abierto para copiar el enlace.
- El formato de hora quedó uniforme ("p. m.").

Las habilidades `frontend-design` y `webapp-testing` no estaban disponibles en esta sesión. En su lugar se usaron Playwright directamente y revisión visual con capturas (`docs/capturas/`).

## Cómo llega la invitación al teléfono de cada invitado

1. **Cada familia tiene su enlace personal.** Al darla de alta en el panel (a mano o importando el CSV) se genera un enlace único, por ejemplo `https://<dominio>/i/Xk3…`. Ese enlace solo abre su invitación y su confirmación, sin contraseña.
2. **El enlace va dentro de un mensaje de WhatsApp.** En el panel, botón "Mensaje" de cada familia, ya está el texto listo: saludo con el nombre de la familia, lugares reservados y el enlace.
3. **El invitado toca el enlace en su celular.** WhatsApp muestra una tarjeta con el monograma y "Sofía e Isaac · 22 de mayo de 2027" (sin datos de la familia). Al tocarla se abre el navegador del teléfono: ve el sobre, lo abre, consulta toda la información y confirma cuántos adultos asistirán. Puede volver a abrir el mismo enlace para ver o cambiar su respuesta mientras las confirmaciones estén abiertas.
4. **El panel ve la respuesta al instante** y separa "mensaje enviado" de "asistencia confirmada".

**Requisito previo:** la aplicación tiene que estar publicada en un dominio (por ejemplo `boda-sofia-isaac.com` o un subdominio del alojamiento). Mientras corra solo en una computadora, los enlaces no abren desde el teléfono de los invitados.

**Formas de enviar los mensajes:**

| Opción | Cómo funciona | Qué necesita | Recomendación |
| --- | --- | --- | --- |
| A. Envío manual desde el WhatsApp de los novios (ya funciona) | En el panel, desde el celular: "Mensaje" → "Abrir en WhatsApp" abre el chat de esa familia con el texto escrito; se toca enviar y luego "Registrar envío manual". Para familias sin teléfono, "Copiar texto" y pegarlo donde haga falta. | Solo el dominio publicado y los teléfonos en la lista | **Recomendada** para una boda: unos minutos por cada decena de familias, sale del número que los invitados ya conocen y no requiere aprobación de Meta. |
| B. Envío automático | Un proveedor nuevo con la interfaz `MessagingProvider` manda todos los mensajes y registra "enviado" y "entregado" por webhook. | WhatsApp Business Platform (Cloud API) de Meta: número dedicado que no esté en uso en WhatsApp, cuenta Meta Business verificada y una plantilla de mensaje aprobada. Tiene costo por conversación. WhatsApp personal no permite esto. | Solo si la lista es muy grande o se quieren recordatorios masivos. |

## Logo

- El original está conservado sin cambios.
- La vectorización con potrace sobre la captura ampliada respeta el monograma, los trazos y la escritura. Es un **trazado automático** a partir de una captura de 738×1600, no el vector original de la diseñadora.
- La variante clara se usa sobre negro, en el sello y en la carta del sobre.
- Si llega el SVG original, se reemplazan los archivos con el mismo nombre.

## Pendientes que necesitan un dato o acceso externo

1. **Alojamiento con almacenamiento persistente y dominio**, para publicar el backend, obtener la URL de revisión y poder enviar enlaces que abran en el teléfono (Railway, Render con disco, Fly.io con volumen o un VPS). Hay que definir `PUBLIC_BASE_URL`, `ADMIN_PASSWORD_HASH` y `TRUST_PROXY`.
2. **WhatsApp Business Platform (Cloud API):** un número dedicado, una cuenta de Meta Business y una plantilla aprobada. WhatsApp personal no permite envíos automatizados. Con eso se implementa el proveedor real y el webhook de entregas.
3. **Listado definitivo de invitados** con los lugares por familia (la plantilla CSV está lista).
4. **Contenido opcional, todavía sin datos:** mesa de Amazon, datos de transferencia, música y fecha límite para confirmar. Cada sección aparece sola cuando se llena en `shared/event.ts`.
5. **Acceso exacto dentro de Quinta de Torres**, si conviene indicarlo (`reception.note`). El salón ya está confirmado.
6. **Escritura del segundo nombre de la novia** (Lizeth o Lisette) y acentos del nombre completo del novio (Isaac Yael Vázquez González). No se muestran en la invitación; están en `editorialFullNames`.
7. **Elegir cómo se envían los mensajes** (opción A manual o B automática, ver arriba). Para la opción B: número dedicado y cuenta Meta Business.
8. **Comprobación manual de que los tres enlaces externos cargan** (Maps ×2 y Liverpool), porque la red de este entorno los bloquea.
9. Opcional: el SVG original del logo, para reemplazar el trazado automático.

## Versión

- Código verificado (pruebas 31/31 y 12/12): commit `ece9af8` en `main` (incluye las confirmaciones de Angel de las 21:45).
- Este informe se agrega en el commit siguiente, sin cambios de código.
