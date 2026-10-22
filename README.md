# Boda Sofía e Isaac · Invitación digital

Invitación web para el 22 de mayo de 2027 (Zapopan, Jalisco) con confirmación de asistencia guardada en base de datos, panel privado para administrar invitaciones, importación/exportación CSV y mensajes listos para WhatsApp (sin envíos automáticos todavía).

- **Interfaz:** React + Vite + TypeScript (`src/`)
- **API:** Express (`server/`), un solo proceso Node que sirve la interfaz y la API
- **Base de datos:** SQLite con el módulo integrado `node:sqlite` (sin compilaciones nativas), archivo en `data/`
- **Datos del evento:** `shared/event.ts` (único lugar para editar textos, horarios, enlaces y secciones opcionales)

## Arranque rápido

Requisitos: Node.js 22.13 o superior (probado con 22.22) y Git. En Windows funciona igual desde PowerShell.

```bash
git clone https://github.com/angeloscky/boda-tachi.git
cd boda-tachi
npm install
copy .env.example .env        # en macOS/Linux: cp .env.example .env
npm run admin:hash            # pide una contraseña y muestra ADMIN_PASSWORD_HASH=...
# pega esa línea en .env
npm run build
npm start                     # http://localhost:3000
```

- Página general: `http://localhost:3000/`
- Enlace individual: `http://localhost:3000/i/<token>` (se copia desde el panel)
- Panel: `http://localhost:3000/admin`

Desarrollo con recarga: `npm run dev` (interfaz en `http://localhost:5173`, API en el puerto 3000). En desarrollo puedes usar `ADMIN_PASSWORD=...` en `.env` en lugar del hash.

### Datos de demostración

```bash
# mejor en una base aparte para no mezclar con los reales
DB_PATH=./data/demo.sqlite npm run demo:seed     # crea DEMO-001…005 y muestra sus enlaces
DB_PATH=./data/demo.sqlite npm run demo:clear
```

En PowerShell: `$env:DB_PATH="./data/demo.sqlite"; npm run demo:seed` (y luego `Remove-Item Env:DB_PATH` para volver a la base normal).

Las invitaciones de demostración llevan el prefijo `DEMO-` y la marca *demostración*: no cuentan en los totales ni salen en las exportaciones salvo que se elija “Reales y demostración” en el panel.

## Configuración (`.env`)

| Variable | Para qué sirve |
| --- | --- |
| `PUBLIC_BASE_URL` | Dominio con el que se arman los enlaces individuales y la vista previa al compartir (sin `/` final). |
| `DB_PATH` | Ruta del archivo SQLite. Se rechaza si cae dentro de `public/`, `dist/` o la carpeta servida. |
| `ADMIN_PASSWORD_HASH` | Hash scrypt de la contraseña del panel (`npm run admin:hash`). Cambiarlo cierra las sesiones abiertas. |
| `PORT` | Puerto (3000 por defecto). |
| `TRUST_PROXY` | Número de proxies delante del servidor (0 si se expone directo). Necesario para limitar intentos por IP real. |
| `COOKIE_SECURE` | `true` fuerza cookies solo HTTPS (se activa solo cuando `PUBLIC_BASE_URL` es https). |
| `MESSAGING_PROVIDER` | `simulation` (único disponible; no envía nada). |

Nada de esto llega al navegador: el panel valida la sesión en el servidor con una cookie `HttpOnly`.

## Uso del panel

- **Nueva invitación:** identificador estable (p. ej. `FAM-001`), nombre de la familia, teléfono opcional y lugares para adultos. Si los lugares quedan vacíos, la invitación aparece como *Pendiente* y el invitado no puede confirmar hasta que se asignen.
- **Copiar enlace / Mensaje / Editar** en cada fila. “Generar enlace nuevo” invalida el anterior.
- **Filtros:** pendientes, asistirán, no asistirán, sin lugares asignados; búsqueda por nombre, identificador o teléfono.
- **Confirmaciones abiertas/cerradas:** botón en los totales. Cerradas, los invitados ven su respuesta pero no pueden cambiarla.
- **Registrar respuesta recibida por otro medio:** desde Editar, por si alguien confirma por teléfono.

### Importar y exportar CSV

Plantilla: botón **Plantilla** del panel (o `docs/plantilla-invitados.csv`). Columnas:

```
identificador,nombre,telefono,lugares_adultos,notas
FAM-001,Familia Ejemplo Uno,3312345678,4,
```

- Se muestra una revisión con errores y avisos **antes** de aplicar; si hay un error no se aplica nada.
- Reimportar el mismo identificador actualiza la invitación (sin duplicar y sin cambiar su enlace). `FAM-001` y `fam-001` son el mismo.
- Dos familias con el mismo apellido o teléfono nunca se combinan; solo aparece un aviso.
- Si el archivo no trae la columna `telefono` o `notas`, se conservan los valores existentes.
- **Exportar CSV** incluye estado de asistencia, adultos confirmados, enlace y estado del mensaje; se puede volver a importar.

## WhatsApp (preparado, sin envíos)

El panel prepara para cada invitación: destinatario, teléfono, enlace individual, texto (plantilla en `shared/message.ts`), vista previa, copiar texto, abrir `wa.me` y exportación **Mensajes CSV**.

Hay dos estados separados:

- **Asistencia:** pendiente, asistirá, no asistirá. Solo cambia cuando el invitado guarda su respuesta (o el administrador la registra).
- **Comunicación:** sin preparar, preparado, enviado, entregado. El proveedor actual (`simulation`, en `server/messaging.ts`) solo marca *preparado*. *Enviado* y *entregado* se pueden registrar a mano y quedan marcados como “registro manual”.

Copiar el texto, abrir WhatsApp o que el invitado visite su enlace **no** cuenta como enviado ni como confirmado.

**Conexión pendiente.** WhatsApp Messenger personal no tiene API para enviar mensajes automáticamente; el envío automatizado requiere **WhatsApp Business Platform (Cloud API)** de Meta, con un número dedicado verificado, una cuenta de Meta Business y una plantilla de mensaje aprobada (los mensajes iniciados por el negocio deben usar plantilla). Con eso se implementa un proveedor nuevo con la interfaz `MessagingProvider` (`deliver()` → `sent` con el id de Meta) y un webhook que registre `delivered`. Abrir `wa.me` desde un teléfono personal sigue funcionando sin integración, pero es un envío manual.

## Respaldo y restauración

Copia consistente aun con el servidor encendido:

```bash
npm run db:backup                         # crea backups/boda-AAAA-MM-DD-HH-MM-SS.sqlite
npm run db:backup -- D:\respaldos\boda.sqlite
```

Desde el panel también se puede descargar con el botón **Respaldo**.

Restaurar (con el servidor **detenido**):

```bash
npm run db:restore -- backups/boda-2027-05-01-10-00-00.sqlite
```

El script verifica la integridad del respaldo y guarda una copia de la base actual (`*.antes-de-restaurar-*`) antes de reemplazarla. Las migraciones (`server/db.ts`) se aplican solas al arrancar; también con `npm run db:migrate`.

## Pruebas

```bash
npm test              # 31 pruebas de API y datos (Vitest + Supertest)
npm run build
npm run test:e2e      # 12 recorridos en navegador, móvil y escritorio (Playwright)
```

En otro equipo, la primera vez: `npx playwright install chromium`. Las pruebas usan bases temporales y datos sintéticos; no envían mensajes ni visitan Google Maps o Liverpool (se intercepta la pestaña nueva).

## Publicación

Necesita un alojamiento que ejecute Node 22 y conserve el archivo SQLite entre reinicios (disco o volumen persistente). Un hosting de archivos estáticos no sirve: la confirmación no funcionaría.

```bash
docker build -t boda-tachi .
docker run -p 3000:3000 -v boda-datos:/app/data \
  -e PUBLIC_BASE_URL=https://tu-dominio -e ADMIN_PASSWORD_HASH='scrypt$...' -e TRUST_PROXY=1 boda-tachi
```

Cualquier plataforma con contenedores y volumen persistente funciona (Railway, Render con disco, Fly.io con volumen, un VPS). Montar el volumen en `/app/data`, definir las variables y programar `npm run db:backup` o descargar el respaldo desde el panel con regularidad.

## Logo

- Original intacto: `assets/logo/original/WhatsApp Image 2026-10-21 at 8.42.27 PM.jpeg` (captura de 738×1600).
- Vectorización: `assets/logo/vector/*.svg`, generada con `npm run logo:vectorize` (potrace sobre la captura ampliada). Es un trazado automático fiel a la captura, no el archivo vectorial de la diseñadora; si aparece el SVG original, reemplaza `public/assets/logo/*.svg` con los mismos nombres.
- Favicon, ícono e imagen para compartir: `npm run logo:assets`.

## Estructura

```
shared/event.ts        datos públicos del evento (editar aquí)
shared/message.ts      plantilla del mensaje y normalización de teléfonos
server/                API, base de datos, autenticación, CSV, proveedor de mensajes
server/scripts/        migrar, respaldar, restaurar, demo, hash de contraseña
src/                   invitación (pages/, components/) y panel (admin/)
tests/api, tests/e2e   pruebas
assets/logo            original y vectorizado
docs/capturas          capturas de móvil y escritorio
```
