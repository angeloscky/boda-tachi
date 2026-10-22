# Revisión gratuita en Render (preparado, sin cuenta creada)

> **Estado: solo preparado.** No se creó ninguna cuenta ni servicio. Lo de abajo se comprobó en local imitando la configuración de Render (mismo comando de compilación, `npm start`, `PORT=10000`, `HOST=0.0.0.0`). La experiencia real para los invitados en Render (tiempos, dominio, encabezados del proxy) está pendiente de comprobar.

Sirve para revisar la invitación en una URL pública sin costo. **No es todavía la publicación final para invitados.** Mientras Google Sheets siga desconectado, la confirmación aparece como "todavía no habilitada" y no se guarda nada.

## Qué ofrece y qué limita el plan Free

Según la documentación de Render (https://render.com/docs/free y https://render.com/docs/web-services), consultada el 2026-10-22:

- **Pausa por inactividad:** el servicio se suspende tras **15 minutos sin tráfico**. La siguiente visita lo vuelve a levantar, y eso **tarda aproximadamente un minuto**. Quien abra la invitación en ese momento espera ese minuto.
- **Horas al mes:** 750 horas de instancia gratis por espacio de trabajo y mes. Si se agotan, los servicios Free se suspenden hasta el mes siguiente.
- **Sin disco persistente:** el sistema de archivos se borra en cada reinicio, y Render puede reiniciar un servicio Free en cualquier momento. Este servidor no necesita disco cuando no está en modo `demo`.
- **Subdominio gratuito:** cada servicio recibe una dirección `https://<nombre>.onrender.com`. Un dominio comprado es opcional y se conecta después.
- **Puerto y host:** el servidor debe escuchar en `0.0.0.0` y en el puerto de `PORT` (Render usa 10000 por defecto).

Las sesiones del panel viven en memoria: tras una pausa o un reinicio hay que volver a entrar.

## Configuración del servicio web

| Campo en Render | Valor |
| --- | --- |
| Runtime | Node |
| Versión de Node | `22.22.0`, la versión con que se probó. La fija el archivo `.node-version` del repositorio. Sin ese archivo, Render usaría su versión por defecto (24.x en servicios nuevos), que no se ha probado aquí. |
| Build command | `npm ci && npm run build` |
| Start command | `npm start` |
| Health check path | `/api/health` (responde `{"ok":true,"rsvp":"disabled"}` con estado 200) |
| Plan | Free |
| Disco | Ninguno |
| Base de datos | Ninguna |

**Sobre `NODE_ENV`.** Con `NODE_ENV=production` el servidor exige `PUBLIC_BASE_URL` y no arranca la demostración por descuido, así que conviene definirla. Pero en ese caso `npm ci` omite las dependencias de desarrollo (Vite, TypeScript) y la compilación falla con `vite: not found`. Se comprobó en local. Por eso hay dos opciones:

- Sin `NODE_ENV`: usa el build tal cual, `npm ci && npm run build`.
- Con `NODE_ENV=production` (recomendado): usa como build `npm ci --include=dev && npm run build`.

Ambas variantes se compilaron en local desde una copia limpia.

## Variables de entorno

| Variable | Valor para la revisión |
| --- | --- |
| `PUBLIC_BASE_URL` | La URL real que asigne Render, sin `/` final (por ejemplo `https://boda-tachi.onrender.com`). Se completa después de crear el servicio. Es la que comparte el botón "Compartir invitación general". |
| `HOST` | `0.0.0.0` |
| `NODE_ENV` | `production` (con el build `--include=dev`; ver arriba) |
| `RSVP_BACKEND` | **vacío** mientras Google siga desconectado: la confirmación aparece como "todavía no habilitada" |
| `MESSAGING_PROVIDER` | `simulation` (no envía nada) |
| `ADMIN_PASSWORD_HASH` | Opcional. Se genera en tu equipo con `npm run admin:hash` y se pega como variable secreta. Sin ella, el panel queda deshabilitado. |
| `TRUST_PROXY` | `1`, para que el límite de intentos del panel use la IP real detrás del proxy de Render. Cuántos saltos hay delante está pendiente de comprobar en el primer despliegue. |
| `SHEETS_WEBAPP_URL`, `SHEETS_SHARED_SECRET` | **Sin rellenar.** Se completan solo cuando se conecte Google. |
| `PORT` | No hace falta: Render la define. |

No definas `DB_PATH` ni `DEMO_IN_PRODUCTION`. La demostración con SQLite no es para este alojamiento: sin disco, sus datos se perderían en cada pausa.

## Qué se comprobó en local

Desde una copia limpia del repositorio, con Node 22.22.0:

1. Con `NODE_ENV=production`:
   - `npm ci && npm run build` falla con `vite: not found`.
   - `npm ci --include=dev && npm run build` compila.
2. Sin `NODE_ENV`, `npm ci && npm run build` compila.
3. Se arrancó `npm start` con `NODE_ENV=production`, `PORT=10000`, `HOST=0.0.0.0`, `PUBLIC_BASE_URL=https://boda-tachi-revision.onrender.com` (dirección de ejemplo), `RSVP_BACKEND` vacío y `MESSAGING_PROVIDER=simulation`. El servidor escuchó en `0.0.0.0:10000`, y:
   - `/api/health` respondió 200 `{"ok":true,"rsvp":"disabled"}`;
   - `og:url` y la URL que comparte el botón general usan la dirección pública;
   - un enlace personal responde 503 `rsvp_not_enabled`, tanto al consultar como al guardar;
   - `/calendario.ics` responde 200;
   - la cabecera HSTS está presente con una URL `https://`;
   - no se creó ninguna carpeta `data/`.
4. Sin `PUBLIC_BASE_URL` y con `NODE_ENV=production`, el servidor no arranca y lo explica.

## Pendiente de comprobar en Render

- Crear la cuenta y el servicio (decisión y acción de Angel; no se hizo).
- Que el health check y la pausa/arranque se comporten como dice la documentación, y cuánto tarda la primera visita.
- El número de proxies delante (`TRUST_PROXY`).
- La vista previa al compartir por WhatsApp con la URL real.

## Vista de diseño estática

Aparte de Render, la maqueta estática (`npm run build:static`) sigue disponible para revisar el diseño. **No registra respuestas reales**: al guardar dice que la respuesta no se registró.
