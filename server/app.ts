import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import type { AppConfig } from './config.js';
import { backupTo, setSetting, type DB } from './db.js';
import {
  SESSION_COOKIE,
  createLimiter,
  createSession,
  destroySession,
  hashPassword,
  isValidSession,
  requireAdmin,
  verifyPassword,
} from './auth.js';
import {
  COMM_LABEL,
  HttpError,
  adminClearResponse,
  adminSetResponse,
  applyImport,
  createInvitation,
  deleteInvitation,
  exportCsv,
  getInvitation,
  getPublicInvitation,
  getSummary,
  importTemplate,
  listInvitations,
  previewImport,
  recordCommunication,
  regenerateToken,
  saveGuestResponse,
  updateInvitation,
} from './invitations.js';
import { getProvider, waMeUrl, type MessagingProvider } from './messaging.js';
import { buildInviteMessage } from '../shared/message.js';
import { toCsv } from './csv.js';
import type { AdminInvitation } from '../shared/types.js';

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

export function createApp(db: DB, config: AppConfig, opts: { provider?: MessagingProvider } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  const provider = opts.provider ?? getProvider(config.messagingProvider);
  const passwordHash = config.adminPasswordHash ?? (config.adminPasswordPlain ? hashPassword(config.adminPasswordPlain) : null);

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    next();
  });
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  // Las peticiones que modifican datos deben venir de este mismo sitio.
  app.use('/api', (req, res, next) => {
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
      const origin = req.get('origin');
      if (origin && new URL(origin).host !== req.get('host')) {
        res.status(403).json({ error: 'bad_origin', message: 'Origen no permitido.' });
        return;
      }
    }
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  const publicLimiter = createLimiter(120, 60_000);
  const loginLimiter = createLimiter(10, 15 * 60_000);
  const ip = (req: Request) => req.ip ?? 'desconocida';

  // ------------------------------------------------------------ invitado
  app.use('/api/invitations', (req, res, next) => {
    if (!publicLimiter.hit(ip(req))) {
      res.status(429).json({ error: 'rate_limited', message: 'Demasiados intentos. Espera un minuto e inténtalo de nuevo.' });
      return;
    }
    next();
  });
  app.get('/api/invitations/:token', wrap((req, res) => res.json(getPublicInvitation(db, String(req.params.token)))));
  app.put('/api/invitations/:token/rsvp', wrap((req, res) => res.json(saveGuestResponse(db, String(req.params.token), req.body))));

  app.get('/api/health', (_req, res) => {
    db.prepare('SELECT 1').get();
    res.json({ ok: true });
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
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      if (!password || !verifyPassword(password, passwordHash)) {
        throw new HttpError(401, 'bad_credentials', 'Contraseña incorrecta.');
      }
      loginLimiter.reset(ip(req));
      const { token, expires } = createSession(db);
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
      destroySession(db, req.cookies?.[SESSION_COOKIE]);
      res.clearCookie(SESSION_COOKIE, { path: '/api/admin' });
      res.json({ authenticated: false });
    }),
  );
  app.get('/api/admin/session', (req, res) => {
    res.json({ authenticated: isValidSession(db, req.cookies?.[SESSION_COOKIE]), configured: Boolean(passwordHash) });
  });

  // ------------------------------------------------------------ administración protegida
  const admin = express.Router();
  admin.use(requireAdmin(db));
  const linkFor = (inv: Pick<AdminInvitation, 'token'>) => `${config.publicBaseUrl}/i/${inv.token}`;
  const withLink = (inv: AdminInvitation) => ({ ...inv, link: linkFor(inv) });

  admin.get('/summary', wrap((req, res) => res.json(getSummary(db, req.query.demo === 'include'))));
  admin.get(
    '/invitations',
    wrap((req, res) =>
      res.json(
        listInvitations(db, {
          q: typeof req.query.q === 'string' ? req.query.q : undefined,
          status: typeof req.query.status === 'string' ? req.query.status : undefined,
          demo: typeof req.query.demo === 'string' ? req.query.demo : undefined,
        }).map(withLink),
      ),
    ),
  );
  admin.post('/invitations', wrap((req, res) => res.status(201).json(withLink(createInvitation(db, req.body ?? {})))));
  admin.get('/invitations/:id', wrap((req, res) => res.json(withLink(getInvitation(db, idParam(req))))));
  admin.put('/invitations/:id', wrap((req, res) => res.json(withLink(updateInvitation(db, idParam(req), req.body ?? {})))));
  admin.delete(
    '/invitations/:id',
    wrap((req, res) => {
      deleteInvitation(db, idParam(req));
      res.json({ deleted: true });
    }),
  );
  admin.post('/invitations/:id/regenerate-link', wrap((req, res) => res.json(withLink(regenerateToken(db, idParam(req))))));
  admin.put('/invitations/:id/response', wrap((req, res) => res.json(withLink(adminSetResponse(db, idParam(req), req.body)))));
  admin.delete('/invitations/:id/response', wrap((req, res) => res.json(withLink(adminClearResponse(db, idParam(req))))));

  admin.put(
    '/settings',
    wrap((req, res) => {
      if (typeof req.body?.rsvpOpen !== 'boolean') throw new HttpError(400, 'invalid', 'Valor inválido.');
      setSetting(db, 'rsvp_open', String(req.body.rsvpOpen));
      res.json(getSummary(db));
    }),
  );

  // CSV
  const sendCsv = (res: Response, name: string, body: string) => {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.send(body);
  };
  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  admin.get('/template.csv', (_req, res) => sendCsv(res, 'plantilla-invitados.csv', importTemplate()));
  admin.get('/export.csv', (req, res) =>
    sendCsv(res, `invitados-${stamp()}.csv`, exportCsv(db, config.publicBaseUrl, req.query.demo === 'include')),
  );
  admin.post(
    '/import/preview',
    wrap((req, res) => {
      if (typeof req.body?.csv !== 'string') throw new HttpError(400, 'invalid', 'No recibimos el contenido del archivo.');
      res.json(previewImport(db, req.body.csv));
    }),
  );
  admin.post(
    '/import/apply',
    wrap((req, res) => {
      if (typeof req.body?.csv !== 'string') throw new HttpError(400, 'invalid', 'No recibimos el contenido del archivo.');
      res.json(applyImport(db, req.body.csv));
    }),
  );

  // Mensajes (preparación para WhatsApp)
  const messageFor = (inv: AdminInvitation) => {
    const link = linkFor(inv);
    const text = buildInviteMessage({ name: inv.name, seats: inv.seats, link });
    return { id: inv.id, code: inv.code, name: inv.name, phone: inv.phone, seats: inv.seats, link, text, waUrl: waMeUrl(inv.phone, text), comm: inv.comm };
  };
  admin.get('/messaging', (_req, res) => res.json({ provider: { id: provider.id, label: provider.label, sendsRealMessages: provider.sendsRealMessages } }));
  admin.get('/invitations/:id/message', wrap((req, res) => res.json(messageFor(getInvitation(db, idParam(req))))));
  admin.post(
    '/invitations/:id/message/prepare',
    wrap(async (req, res) => {
      const inv = getInvitation(db, idParam(req));
      const msg = messageFor(inv);
      const result = await provider.deliver({ invitationId: inv.id, to: inv.phone, recipientName: inv.name, text: msg.text, link: msg.link });
      const updated = recordCommunication(db, inv.id, { status: result.status, source: provider.id, providerRef: result.providerRef, note: result.note });
      res.json({ ...messageFor(updated), note: result.note });
    }),
  );
  admin.post(
    '/invitations/:id/message/manual',
    wrap((req, res) => {
      const status = req.body?.status;
      if (status !== 'sent' && status !== 'delivered') throw new HttpError(400, 'invalid', 'Estado de comunicación inválido.');
      const updated = recordCommunication(db, idParam(req), { status, source: 'manual', note: 'Registro manual del administrador' });
      res.json(messageFor(updated));
    }),
  );
  admin.get('/messages.csv', (req, res) => {
    const list = listInvitations(db, { demo: req.query.demo === 'include' ? 'include' : undefined }).filter((i) => i.enabled);
    sendCsv(
      res,
      `mensajes-${stamp()}.csv`,
      toCsv(
        ['identificador', 'destinatario', 'telefono', 'enlace', 'mensaje', 'enlace_whatsapp', 'estado_comunicacion'],
        list.map((i) => {
          const m = messageFor(i);
          return [m.code, m.name, m.phone ?? '', m.link, m.text, m.phone ? m.waUrl : '', COMM_LABEL[i.comm.status]];
        }),
      ),
    );
  });

  admin.get(
    '/backup',
    wrap((_req, res) => {
      const tmp = path.join(os.tmpdir(), `boda-respaldo-${Date.now()}.sqlite`);
      backupTo(db, tmp);
      res.download(tmp, `boda-respaldo-${stamp()}.sqlite`, () => fs.rm(tmp, { force: true }, () => {}));
    }),
  );

  app.use('/api/admin', admin);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found', message: 'Ruta no encontrada.' }));

  // ------------------------------------------------------------ interfaz
  const indexFile = path.join(config.clientDir, 'index.html');
  if (fs.existsSync(indexFile)) {
    const html = fs
      .readFileSync(indexFile, 'utf8')
      .replaceAll('%PUBLIC_BASE_URL%', config.publicBaseUrl)
      .replace('<title>', `<meta property="og:url" content="${config.publicBaseUrl}/" />\n    <title>`);
    app.use(express.static(config.clientDir, { index: false, maxAge: '1h', setHeaders: (res, file) => {
      if (/[\\/]assets[\\/].+-[A-Za-z0-9_-]{8}\.(js|css|woff2?)$/.test(file)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } }));
    app.get(['/', '/i/:token', '/admin', '/admin/*'], (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.type('html').send(html);
    });
  }
  app.use((_req, res) => res.status(404).type('text').send('No encontrado'));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.code, message: err.message });
      return;
    }
    if (err && typeof err === 'object' && 'type' in err && (err as { type: string }).type === 'entity.parse.failed') {
      res.status(400).json({ error: 'invalid_json', message: 'La solicitud no es válida.' });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'server_error', message: 'Ocurrió un error en el servidor. Inténtalo de nuevo.' });
  });

  return app;
}
