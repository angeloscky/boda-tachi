import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import type { AppConfig } from './config.js';
import { backupTo, setSetting, type DB } from './db.js';
import { SESSION_COOKIE, createLimiter, createSessionStore, hashPassword, requireAdmin, verifyPassword } from './auth.js';
import {
  COMM_LABEL,
  HttpError,
  adminClearResponse,
  adminSetResponse,
  applyImport,
  createInvitation,
  deleteInvitation,
  exportTab,
  getInvitation,
  getSummary,
  listInvitations,
  previewImport,
  recordCommunication,
  regenerateToken,
  revokeToken,
  templateCsv,
  updateInvitation,
} from './invitations.js';
import { getProvider, waMeUrl, type MessagingProvider } from './messaging.js';
import { buildInviteMessage } from '../shared/message.js';
import { buildIcs } from '../shared/ics.js';
import { parseRsvpRequest } from '../shared/rsvp-rules.js';
import { TEMPLATES, type TemplateName } from '../shared/sheets-templates.js';
import { toCsv } from './csv.js';
import type { AdminInvitation } from '../shared/types.js';
import { createDisabledStore, createLocalStore, createSheetsStore, type GuestStore } from './store.js';
import { createSheetsClient, sheetsConfigProblem, type FetchLike } from './sheets/client.js';

type Handler = (req: Request, res: Response) => unknown;
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = fn(req, res);
    if (out instanceof Promise) out.catch(next);
  } catch (err) {
    next(err);
  }
};

const idParam = (req: Request) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw new HttpError(404, 'not_found', 'La invitación no existe.');
  return id;
};

/** Elige el almacenamiento según la configuración. Nunca cae en silencio a la demostración. */
export function createStore(db: DB | null, config: AppConfig, fetchImpl?: FetchLike): GuestStore {
  if (config.rsvpBackend === 'demo') {
    if (!db) throw new Error('RSVP_BACKEND=demo necesita la base local de demostración.');
    return createLocalStore(db);
  }
  if (config.rsvpBackend === 'sheets') {
    const problem = sheetsConfigProblem(config.sheets.url, config.sheets.secret);
    if (problem) return createDisabledStore('sheets', `Google Sheets no está configurado: ${problem}`);
    return createSheetsStore(createSheetsClient({ url: config.sheets.url!, secret: config.sheets.secret!, timeoutMs: config.sheets.timeoutMs }, fetchImpl));
  }
  return createDisabledStore('disabled', 'Sin registro de confirmaciones configurado (RSVP_BACKEND vacío): la confirmación aparece como no habilitada.');
}

export function createApp(db: DB | null, config: AppConfig, opts: { provider?: MessagingProvider; store?: GuestStore; fetchImpl?: FetchLike } = {}) {
  const app = express();
  app.disable('x-powered-by');
  // Solo se confía en X-Forwarded-For si hay un proxy declarado (TRUST_PROXY).
  app.set('trust proxy', config.trustProxy > 0 ? config.trustProxy : false);
  const provider = opts.provider ?? getProvider(config.messagingProvider);
  const store = opts.store ?? createStore(db, config, opts.fetchImpl);
  const localDb = store.mode === 'demo' ? db : null;
  const passwordHash = config.adminPasswordHash ?? (config.adminPasswordPlain ? hashPassword(config.adminPasswordPlain) : null);
  // Sesiones en memoria: cambiar la contraseña exige reiniciar, lo que cierra todas las sesiones.
  const sessions = createSessionStore();
  const allowedOrigin = new URL(config.publicBaseUrl).origin;

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    if (config.cookieSecure) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    next();
  });
  // Cuerpos pequeños en general; la importación CSV admite archivos de hasta 2 MB.
  app.use('/api/admin/import', express.json({ limit: '2mb' }));
  app.use(express.json({ limit: '16kb' }));
  app.use(cookieParser());

  // Las peticiones que modifican datos deben venir de este mismo sitio.
  app.use('/api', (req, res, next) => {
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
      const origin = req.get('origin');
      let sameSite = true;
      if (origin) {
        try {
          const o = new URL(origin);
          sameSite = o.origin === allowedOrigin || o.host === req.get('host');
        } catch {
          sameSite = false;
        }
      }
      if (!sameSite) {
        res.status(403).json({ error: 'bad_origin', message: 'Origen no permitido.' });
        return;
      }
    }
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  const publicLimiter = createLimiter(120, 60_000);
  const loginLimiter = createLimiter(10, 15 * 60_000);
  const globalLoginLimiter = createLimiter(30, 60 * 60_000); // tope total por hora, sin importar la IP
  const ip = (req: Request) => req.ip ?? 'desconocida';

  // ------------------------------------------------------------ invitado
  app.use('/api/invitations', (req, res, next) => {
    if (!publicLimiter.hit(ip(req))) {
      res.status(429).json({ error: 'rate_limited', message: 'Demasiados intentos. Espera un minuto e inténtalo de nuevo.' });
      return;
    }
    next();
  });
  app.get('/api/invitations/:token', wrap(async (req, res) => res.json(await store.getInvitation(String(req.params.token)))));
  app.put(
    '/api/invitations/:token/rsvp',
    wrap(async (req, res) => {
      // Solo se acepta quiénes asistirán; la cantidad se calcula en el servidor a partir de las personas.
      const parsed = parseRsvpRequest(req.body);
      if (!parsed.ok) throw new HttpError(parsed.status, parsed.code, parsed.message);
      res.json(await store.saveResponse(String(req.params.token), parsed.value));
    }),
  );

  app.get('/api/health', (_req, res) => {
    localDb?.prepare('SELECT 1').get();
    res.json({ ok: true, rsvp: store.uiMode });
  });

  // ------------------------------------------------------------ sesión de administración
  app.post(
    '/api/admin/login',
    wrap((req, res) => {
      if (!passwordHash) {
        throw new HttpError(503, 'admin_disabled', 'El acceso administrativo no está configurado (falta ADMIN_PASSWORD_HASH).');
      }
      if (!loginLimiter.hit(ip(req))) {
        throw new HttpError(429, 'rate_limited', 'Demasiados intentos. Espera 15 minutos.');
      }
      // El tope global se revisa antes de comprobar la contraseña: superado, ni la correcta entra.
      if (globalLoginLimiter.blocked('global')) {
        throw new HttpError(429, 'rate_limited', 'Demasiados intentos fallidos. Espera una hora.');
      }
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      if (!password || !verifyPassword(password, passwordHash)) {
        globalLoginLimiter.hit('global');
        throw new HttpError(401, 'bad_credentials', 'Contraseña incorrecta.');
      }
      loginLimiter.reset(ip(req));
      const { token, expires } = sessions.create();
      res.cookie(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: 'strict',
        secure: config.cookieSecure,
        expires,
        path: '/api/admin',
      });
      res.json({ authenticated: true });
    }),
  );
  app.post(
    '/api/admin/logout',
    wrap((req, res) => {
      sessions.destroy(req.cookies?.[SESSION_COOKIE]);
      res.clearCookie(SESSION_COOKIE, { path: '/api/admin' });
      res.json({ authenticated: false });
    }),
  );
  app.get('/api/admin/session', (req, res) => {
    res.json({ authenticated: sessions.isValid(req.cookies?.[SESSION_COOKIE]), configured: Boolean(passwordHash) });
  });

  // ------------------------------------------------------------ administración protegida
  const admin = express.Router();
  admin.use(requireAdmin(sessions));
  const linkFor = (inv: Pick<AdminInvitation, 'token' | 'linkRevoked'>) => (inv.linkRevoked ? null : `${config.publicBaseUrl}/i/${inv.token}`);
  const withLink = (inv: AdminInvitation) => ({ ...inv, link: linkFor(inv) });

  admin.get('/backend', wrap(async (_req, res) => res.json(await store.status())));

  // Plantillas de las pestañas (datos ficticios): disponibles en cualquier modo.
  const sendCsv = (res: Response, name: string, body: string) => {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.send(body);
  };
  const tabName = (req: Request): TemplateName => {
    const name = String(req.params.name);
    if (!(name in TEMPLATES)) throw new HttpError(404, 'not_found', 'Plantilla no encontrada.');
    return name as TemplateName;
  };
  admin.get('/templates/:name.csv', wrap((req, res) => sendCsv(res, TEMPLATES[tabName(req)].file, templateCsv(tabName(req)))));

  // Lo demás administra la lista local, que solo existe en la demostración. Con Google Sheets,
  // la lista, los enlaces y el cierre de confirmaciones se manejan desde la hoja (menú Boda).
  const local = express.Router();
  local.use((_req, _res, next) => {
    if (!localDb) {
      throw new HttpError(
        409,
        'not_available',
        store.mode === 'sheets'
          ? 'Con Google Sheets, la lista se administra en la hoja (menú Boda).'
          : 'No hay un registro de confirmaciones configurado en este servidor.',
      );
    }
    next();
  });
  const db_ = () => localDb!;

  local.get('/summary', wrap((_req, res) => res.json(getSummary(db_()))));
  local.get(
    '/invitations',
    wrap((req, res) =>
      res.json(
        listInvitations(db_(), {
          q: typeof req.query.q === 'string' ? req.query.q : undefined,
          status: typeof req.query.status === 'string' ? req.query.status : undefined,
        }).map(withLink),
      ),
    ),
  );
  local.post('/invitations', wrap((req, res) => res.status(201).json(withLink(createInvitation(db_(), req.body ?? {})))));
  local.get('/invitations/:id', wrap((req, res) => res.json(withLink(getInvitation(db_(), idParam(req))))));
  local.put('/invitations/:id', wrap((req, res) => res.json(withLink(updateInvitation(db_(), idParam(req), req.body ?? {})))));
  local.delete(
    '/invitations/:id',
    wrap((req, res) => {
      deleteInvitation(db_(), idParam(req));
      res.json({ deleted: true });
    }),
  );
  local.post('/invitations/:id/regenerate-link', wrap((req, res) => res.json(withLink(regenerateToken(db_(), idParam(req))))));
  local.post('/invitations/:id/revoke-link', wrap((req, res) => res.json(withLink(revokeToken(db_(), idParam(req))))));
  local.put('/invitations/:id/response', wrap((req, res) => res.json(withLink(adminSetResponse(db_(), idParam(req), req.body)))));
  local.delete('/invitations/:id/response', wrap((req, res) => res.json(withLink(adminClearResponse(db_(), idParam(req))))));

  local.put(
    '/settings',
    wrap((req, res) => {
      if (typeof req.body?.rsvpOpen !== 'boolean') throw new HttpError(400, 'invalid', 'Valor inválido.');
      setSetting(db_(), 'rsvp_open', String(req.body.rsvpOpen));
      res.json(getSummary(db_()));
    }),
  );

  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  local.get('/export/:name.csv', wrap((req, res) => sendCsv(res, `${tabName(req)}-${stamp()}.csv`, exportTab(db_(), tabName(req)))));
  const importBody = (req: Request) => {
    const b = req.body ?? {};
    const ok = (v: unknown) => v === undefined || typeof v === 'string';
    if (!ok(b.invitations) || !ok(b.people)) throw new HttpError(400, 'invalid', 'No recibimos el contenido de los archivos.');
    return { invitations: b.invitations as string | undefined, people: b.people as string | undefined };
  };
  local.post('/import/preview', wrap((req, res) => res.json(previewImport(db_(), importBody(req)))));
  local.post('/import/apply', wrap((req, res) => res.json(applyImport(db_(), importBody(req)))));

  // Mensajes (preparación para WhatsApp; no se envía nada)
  const messageFor = (inv: AdminInvitation) => {
    const link = linkFor(inv);
    if (!link) throw new HttpError(409, 'link_revoked', 'El enlace de esta invitación está revocado; genera uno nuevo antes de preparar el mensaje.');
    const text = buildInviteMessage({ name: inv.name, seats: inv.seats, people: inv.people.filter((p) => p.active).length, link });
    return { id: inv.id, code: inv.code, name: inv.name, phone: inv.phone, seats: inv.seats, link, text, waUrl: waMeUrl(inv.phone, text), comm: inv.comm };
  };
  local.get('/messaging', (_req, res) => res.json({ provider: { id: provider.id, label: provider.label, sendsRealMessages: provider.sendsRealMessages } }));
  local.get('/invitations/:id/message', wrap((req, res) => res.json(messageFor(getInvitation(db_(), idParam(req))))));
  local.post(
    '/invitations/:id/message/prepare',
    wrap(async (req, res) => {
      const inv = getInvitation(db_(), idParam(req));
      const msg = messageFor(inv);
      const result = await provider.deliver({ invitationId: inv.id, to: inv.phone, recipientName: inv.name, text: msg.text, link: msg.link });
      const updated = recordCommunication(db_(), inv.id, { status: result.status, source: provider.id, providerRef: result.providerRef, note: result.note });
      res.json({ ...messageFor(updated), note: result.note });
    }),
  );
  local.post(
    '/invitations/:id/message/manual',
    wrap((req, res) => {
      const status = req.body?.status;
      if (status !== 'sent' && status !== 'delivered') throw new HttpError(400, 'invalid', 'Estado de comunicación inválido.');
      const updated = recordCommunication(db_(), idParam(req), { status, source: 'manual', note: 'Registro manual del administrador' });
      res.json(messageFor(updated));
    }),
  );
  local.get(
    '/messages.csv',
    wrap((_req, res) => {
      const list = listInvitations(db_()).filter((i) => i.enabled && !i.linkRevoked);
      sendCsv(
        res,
        `mensajes-${stamp()}.csv`,
        toCsv(
          ['id_invitacion', 'destinatario', 'telefono', 'enlace', 'mensaje', 'enlace_whatsapp', 'estado_comunicacion'],
          list.map((i) => {
            const m = messageFor(i);
            return [m.code, m.name, m.phone ?? '', m.link, m.text, m.phone ? m.waUrl : '', COMM_LABEL[i.comm.status]];
          }),
        ),
      );
    }),
  );

  local.get(
    '/backup',
    wrap((_req, res) => {
      const tmp = path.join(os.tmpdir(), `boda-demo-respaldo-${Date.now()}.sqlite`);
      backupTo(db_(), tmp);
      res.download(tmp, `boda-demo-respaldo-${stamp()}.sqlite`, () => fs.rm(tmp, { force: true }, () => {}));
    }),
  );
  admin.use(local);

  app.use('/api/admin', admin);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found', message: 'Ruta no encontrada.' }));

  // Calendario como archivo real: los navegadores dentro de WhatsApp suelen ignorar data: con download.
  app.get('/calendario.ics', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.type('text/calendar; charset=utf-8').attachment('boda-sofia-isaac.ics').send(buildIcs());
  });

  // ------------------------------------------------------------ interfaz
  const indexFile = path.join(config.clientDir, 'index.html');
  if (fs.existsSync(indexFile)) {
    const html = fs
      .readFileSync(indexFile, 'utf8')
      .replaceAll('%PUBLIC_BASE_URL%', config.publicBaseUrl)
      .replace(
        '<title>',
        [
          `<meta property="og:url" content="${config.publicBaseUrl}/" />`,
          // La interfaz sabe si es demostración, registro real o confirmación no habilitada.
          `<meta name="bt-rsvp-mode" content="${store.uiMode}" />`,
          // Lo único que comparte "Compartir invitación general": nunca un enlace personal.
          `<meta name="bt-general-url" content="${config.publicBaseUrl}/" />`,
          '<title>',
        ].join('\n    '),
      );
    app.get(['/', '/index.html', '/i/:token', '/admin', '/admin/*'], (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.type('html').send(html);
    });
    app.use(express.static(config.clientDir, { index: false, maxAge: '1h', setHeaders: (res, file) => {
      if (/[\\/]assets[\\/].+-[A-Za-z0-9_-]{8}\.(js|css|woff2?)$/.test(file)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } }));
  }
  app.use((_req, res) => res.status(404).type('text').send('No encontrado'));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ ...err.extra, error: err.code, message: err.message });
      return;
    }
    const e = err as { type?: string; status?: number; expose?: boolean };
    if (e?.type === 'entity.too.large') {
      res.status(413).json({ error: 'too_large', message: 'La solicitud es demasiado grande.' });
      return;
    }
    if (e?.expose && typeof e.status === 'number' && e.status >= 400 && e.status < 500) {
      res.status(e.status).json({ error: 'invalid_request', message: 'La solicitud no es válida.' });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'server_error', message: 'Ocurrió un error en el servidor. Inténtalo de nuevo.' });
  });

  return app;
}
