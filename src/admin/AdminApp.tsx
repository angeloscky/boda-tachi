import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { AdminSummary, AttendanceStatus, CommStatus, ImportPreview } from '../../shared/types';
import { ApiFailure } from '../lib/api';
import { LOGO } from '../lib/brand';
import { adminApi, copyText, type AdminRow, type MessageView } from './adminApi';
import './admin.css';

const ATTENDANCE: Record<AttendanceStatus, string> = { pending: 'Pendiente', attending: 'Asistirá', declined: 'No asistirá' };
const COMM: Record<CommStatus, string> = {
  none: 'Sin preparar',
  prepared: 'Preparado',
  sent: 'Enviado',
  delivered: 'Entregado',
  failed: 'Fallido',
};
const errMsg = (e: unknown) => (e instanceof ApiFailure ? e.message : 'Ocurrió un error inesperado.');
const fmt = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Mexico_City' })
        .format(new Date(iso))
        .replace(/\s*([ap])\.\s*m\./g, ' $1. m.')
    : '';
const adultsLabel = (n: number) => `${n} ${n === 1 ? 'adulto' : 'adultos'}`;
const fmtPhone = (p: string | null) => (p ? (p.startsWith('52') && p.length === 12 ? `+52 ${p.slice(2, 4)} ${p.slice(4, 8)} ${p.slice(8)}` : `+${p}`) : '');

export default function AdminApp() {
  const [state, setState] = useState<'loading' | 'login' | 'ready' | 'unconfigured' | 'error'>('loading');
  useEffect(() => {
    document.title = 'Panel · Sofía e Isaac';
    adminApi
      .session()
      .then((s) => setState(s.authenticated ? 'ready' : s.configured ? 'login' : 'unconfigured'))
      .catch(() => setState('error'));
  }, []);
  if (state === 'loading') return <div className="adm adm-center">Cargando…</div>;
  if (state === 'error') return <div className="adm adm-center">No pudimos contactar al servidor. Recarga la página.</div>;
  if (state === 'unconfigured')
    return (
      <div className="adm adm-center">
        <div className="adm-card" style={{ maxWidth: 460 }}>
          <h1>Panel no configurado</h1>
          <p>Define la contraseña del panel en el servidor: ejecuta <code>npm run admin:hash</code> y copia el resultado en <code>.env</code>.</p>
        </div>
      </div>
    );
  if (state === 'login') return <Login onDone={() => setState('ready')} />;
  return <Dashboard onLogout={() => setState('login')} />;
}

function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await adminApi.login(password);
      onDone();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="adm adm-center">
      <form className="adm-card adm-login" onSubmit={submit}>
        <img src={LOGO.monogram} alt="" className="adm-login-logo" />
        <h1>Panel de invitaciones</h1>
        <p className="adm-muted">Sofía e Isaac · 22 de mayo de 2027</p>
        {error ? (
          <p className="adm-alert adm-alert-error" role="alert">
            {error}
          </p>
        ) : null}
        <label className="adm-field">
          <span>Contraseña</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
        </label>
        <button className="adm-btn adm-btn-primary" disabled={busy || !password}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}

type Dialog = { kind: 'edit'; row: AdminRow | null } | { kind: 'message'; row: AdminRow } | { kind: 'import' } | null;

function Dashboard({ onLogout }: { onLogout: () => void }) {
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [demo, setDemo] = useState('exclude');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmToggle, setConfirmToggle] = useState(false);
  const toastTimer = useRef<number | undefined>(undefined);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3200);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [list, sum] = await Promise.all([adminApi.list({ q, status, demo }), adminApi.summary(demo === 'exclude' ? 'exclude' : 'include')]);
      setRows(list);
      setSummary(sum);
      setError(null);
    } catch (e) {
      if (e instanceof ApiFailure && e.status === 401) onLogout();
      else setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [q, status, demo, onLogout]);

  useEffect(() => {
    const t = window.setTimeout(refresh, 200);
    return () => window.clearTimeout(t);
  }, [refresh]);

  async function toggleRsvp() {
    if (!summary) return;
    setConfirmToggle(false);
    try {
      setSummary(await adminApi.setRsvpOpen(!summary.rsvpOpen));
      notify(summary.rsvpOpen ? 'Confirmaciones cerradas' : 'Confirmaciones abiertas');
      void refresh();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  async function copyLink(row: AdminRow) {
    notify((await copyText(row.link)) ? `Enlace de ${row.name} copiado` : 'No se pudo copiar; selecciona el enlace manualmente');
  }

  const demoParam = demo === 'exclude' ? '' : '?demo=include';

  return (
    <div className="adm">
      <header className="adm-header">
        <div className="adm-brand">
          <img src={LOGO.monogram} alt="" />
          <div>
            <h1>Invitaciones</h1>
            <p>Sofía e Isaac · 22 mayo 2027</p>
          </div>
        </div>
        <button
          className="adm-btn adm-btn-ghost"
          onClick={async () => {
            await adminApi.logout().catch(() => null);
            onLogout();
          }}
        >
          Cerrar sesión
        </button>
      </header>

      <main className="adm-main">
        {summary ? (
          <section className="adm-stats" aria-label="Totales">
            <Stat label="Adultos confirmados" value={summary.adultsConfirmed} sub={`de ${summary.seatsAssigned} lugares asignados`} strong />
            <Stat label="Invitaciones" value={summary.invitations} sub={summary.incomplete ? `${summary.incomplete} sin lugares asignados` : 'todas con lugares'} />
            <Stat label="Asistirán" value={summary.attending} sub="invitaciones" />
            <Stat label="No asistirán" value={summary.declined} sub="invitaciones" />
            <Stat label="Pendientes" value={summary.pending} sub="sin respuesta" />
            <div className="adm-stat adm-stat-toggle">
              <span className="adm-stat-label">Confirmaciones</span>
              <strong className={summary.rsvpOpen ? 'ok' : 'off'}>{summary.rsvpOpen ? 'Abiertas' : 'Cerradas'}</strong>
              {confirmToggle ? (
                <div className="adm-inline">
                  <span className="adm-sub" style={{ marginTop: 0 }}>
                    {summary.rsvpOpen ? 'Nadie podrá confirmar ni cambiar su respuesta.' : 'Los invitados podrán confirmar de nuevo.'}
                  </span>
                  <button className="adm-btn adm-btn-small adm-btn-primary" onClick={toggleRsvp}>
                    Sí, {summary.rsvpOpen ? 'cerrar' : 'abrir'}
                  </button>
                  <button className="adm-btn adm-btn-small adm-btn-ghost" onClick={() => setConfirmToggle(false)}>
                    Cancelar
                  </button>
                </div>
              ) : (
                <button className="adm-btn adm-btn-small" onClick={() => setConfirmToggle(true)}>
                  {summary.rsvpOpen ? 'Cerrar confirmaciones' : 'Abrir confirmaciones'}
                </button>
              )}
            </div>
          </section>
        ) : null}

        {demo !== 'exclude' ? (
          <p className="adm-alert adm-alert-info">Estás viendo datos sintéticos de demostración (prefijo DEMO-). No son invitados reales.</p>
        ) : null}
        {error ? (
          <p className="adm-alert adm-alert-error" role="alert">
            {error}
          </p>
        ) : null}

        <section className="adm-toolbar" aria-label="Búsqueda y acciones">
          <div className="adm-filters">
            <label className="adm-field adm-search">
              <span className="sr-only">Buscar</span>
              <input type="search" placeholder="Buscar por nombre, identificador o teléfono" value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
            <label className="adm-field">
              <span className="sr-only">Estado de asistencia</span>
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="all">Todos los estados</option>
                <option value="pending">Pendientes</option>
                <option value="attending">Asistirán</option>
                <option value="declined">No asistirán</option>
                <option value="incomplete">Sin lugares asignados</option>
              </select>
            </label>
            <label className="adm-field">
              <span className="sr-only">Datos de demostración</span>
              <select value={demo} onChange={(e) => setDemo(e.target.value)}>
                <option value="exclude">Solo reales</option>
                <option value="include">Reales y demostración</option>
                <option value="only">Solo demostración</option>
              </select>
            </label>
          </div>
          <div className="adm-actions">
            <button className="adm-btn adm-btn-primary" onClick={() => setDialog({ kind: 'edit', row: null })}>
              Nueva invitación
            </button>
            <button className="adm-btn" onClick={() => setDialog({ kind: 'import' })}>
              Importar CSV
            </button>
            <a className="adm-btn" href={`/api/admin/export.csv${demoParam}`} download>
              Exportar CSV
            </a>
            <a className="adm-btn" href={`/api/admin/messages.csv${demoParam}`} download>
              Mensajes CSV
            </a>
            <a className="adm-btn adm-btn-ghost" href="/api/admin/template.csv" download>
              Plantilla
            </a>
            <a className="adm-btn adm-btn-ghost" href="/api/admin/backup" download>
              Respaldo
            </a>
          </div>
        </section>

        <section aria-label="Lista de invitaciones">
          {loading ? <p className="adm-muted">Cargando…</p> : null}
          {!loading && rows.length === 0 ? (
            <div className="adm-empty">
              <p>No hay invitaciones {q || status !== 'all' ? 'que coincidan con la búsqueda' : 'todavía'}.</p>
              {!q && status === 'all' ? <p className="adm-muted">Crea la primera con “Nueva invitación” o importa la lista con la plantilla CSV.</p> : null}
            </div>
          ) : null}
          {rows.length ? (
            <div className="adm-table-wrap">
              <table className="adm-table">
                <thead>
                  <tr>
                    <th scope="col">Invitación</th>
                    <th scope="col">Lugares</th>
                    <th scope="col">Asistencia</th>
                    <th scope="col">Mensaje</th>
                    <th scope="col">
                      <span className="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className={r.enabled ? '' : 'is-disabled'}>
                      <td data-label="Invitación">
                        <strong>{r.name}</strong>
                        <span className="adm-sub">
                          {r.code}
                          {r.phone ? ` · ${fmtPhone(r.phone)}` : ''}
                          {r.isDemo ? ' · demostración' : ''}
                          {!r.enabled ? ' · enlace desactivado' : ''}
                        </span>
                      </td>
                      <td data-label="Lugares">{r.seats ?? <span className="adm-pill adm-pill-warn">Pendiente</span>}</td>
                      <td data-label="Asistencia">
                        <span className={`adm-pill adm-pill-${r.attendance}`}>
                          {ATTENDANCE[r.attendance]}
                          {r.attendance === 'attending' ? ` · ${r.adults}` : ''}
                          {r.attendance === 'attending' ? <span className="sr-only"> {r.adults === 1 ? 'adulto' : 'adultos'}</span> : null}
                        </span>
                        {r.respondedAt ? <span className="adm-sub">{fmt(r.respondedAt)}</span> : null}
                      </td>
                      <td data-label="Mensaje">
                        <span className={`adm-pill adm-comm-${r.comm.status}`}>{COMM[r.comm.status]}</span>
                        {r.comm.source === 'manual' ? <span className="adm-sub">registro manual</span> : null}
                      </td>
                      <td className="adm-actions-cell">
                        <div className="adm-row-actions">
                        <button className="adm-btn adm-btn-small" onClick={() => copyLink(r)} aria-label={`Copiar enlace de ${r.name}`}>
                          Copiar enlace
                        </button>
                        <button className="adm-btn adm-btn-small" onClick={() => setDialog({ kind: 'message', row: r })} aria-label={`Mensaje para ${r.name}`}>
                          Mensaje
                        </button>
                        <button className="adm-btn adm-btn-small" onClick={() => setDialog({ kind: 'edit', row: r })} aria-label={`Editar ${r.name}`}>
                          Editar
                        </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      </main>

      {dialog?.kind === 'edit' ? (
        <EditDialog
          row={dialog.row}
          onClose={() => setDialog(null)}
          onSaved={(msg) => {
            notify(msg);
            void refresh();
          }}
        />
      ) : null}
      {dialog?.kind === 'message' ? <MessageDialog row={dialog.row} onClose={() => setDialog(null)} onChanged={refresh} notify={notify} /> : null}
      {dialog?.kind === 'import' ? (
        <ImportDialog
          onClose={() => setDialog(null)}
          onApplied={(msg) => {
            notify(msg);
            void refresh();
          }}
        />
      ) : null}
      <div className="adm-toast" role="status" aria-live="polite">
        {toast}
      </div>
    </div>
  );
}

function Stat({ label, value, sub, strong }: { label: string; value: number; sub: string; strong?: boolean }) {
  return (
    <div className={`adm-stat${strong ? ' adm-stat-strong' : ''}`}>
      <span className="adm-stat-label">{label}</span>
      <strong>{value}</strong>
      <span className="adm-sub">{sub}</span>
    </div>
  );
}

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog ref={ref} className={`adm-dialog${wide ? ' adm-dialog-wide' : ''}`} onClose={onClose} aria-labelledby="adm-dialog-title">
      <div className="adm-dialog-head">
        <h2 id="adm-dialog-title">{title}</h2>
        <button className="adm-btn adm-btn-ghost adm-btn-small" onClick={() => ref.current?.close()} aria-label="Cerrar">
          Cerrar
        </button>
      </div>
      {children}
    </dialog>
  );
}

function EditDialog({ row, onClose, onSaved }: { row: AdminRow | null; onClose: () => void; onSaved: (msg: string) => void }) {
  const [current, setCurrent] = useState<AdminRow | null>(row);
  const [form, setForm] = useState({
    code: row?.code ?? '',
    name: row?.name ?? '',
    phone: row?.phone ? `+${row.phone}` : '',
    seats: row?.seats ? String(row.seats) : '',
    notes: row?.notes ?? '',
    enabled: row?.enabled ?? true,
    isDemo: row?.isDemo ?? false,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [resp, setResp] = useState<{ status: 'attending' | 'declined'; adults: number }>({
    status: row?.attendance === 'declined' ? 'declined' : 'attending',
    adults: row?.attendance === 'attending' ? row.adults : 1,
  });
  const close = () => onClose();
  const set = (k: keyof typeof form) => (e: { target: { value: string; checked?: boolean; type?: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? Boolean(e.target.checked) : e.target.value }));

  async function run(fn: () => Promise<AdminRow | void>, msg: string, closeAfter = false) {
    setBusy(true);
    setError(null);
    try {
      const out = await fn();
      if (out) setCurrent(out);
      onSaved(msg);
      if (closeAfter) close();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const body = { ...form, seats: form.seats.trim() === '' ? null : Number(form.seats), phone: form.phone.trim() || null, notes: form.notes.trim() || null };
    // Al crear, el diálogo sigue abierto para mostrar y copiar el enlace nuevo.
    void run(
      () => (current ? adminApi.update(current.id, body) : adminApi.create(body)),
      current ? 'Cambios guardados' : 'Invitación creada; ya puedes copiar su enlace',
      Boolean(current),
    );
  }

  return (
    <Modal title={current ? `Editar · ${current.name}` : 'Nueva invitación'} onClose={close}>
      <form onSubmit={submit} className="adm-form">
        {error ? (
          <p className="adm-alert adm-alert-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="adm-grid-2">
          <label className="adm-field">
            <span>Identificador</span>
            <input id="f-code" value={form.code} onChange={set('code')} required placeholder="FAM-001" maxLength={40} />
            <small>Estable; se usa para importar sin duplicar.</small>
          </label>
          <label className="adm-field">
            <span>Lugares para adultos</span>
            <input id="f-seats" type="number" inputMode="numeric" min={1} max={30} value={form.seats} onChange={set('seats')} placeholder="Pendiente" />
            <small>Vacío = pendiente de asignar.</small>
          </label>
        </div>
        <label className="adm-field">
          <span>Nombre de la invitación o familia</span>
          <input id="f-name" value={form.name} onChange={set('name')} required maxLength={120} placeholder="Familia Pérez López" />
        </label>
        <label className="adm-field">
          <span>Teléfono (opcional)</span>
          <input id="f-phone" type="tel" value={form.phone} onChange={set('phone')} placeholder="33 1234 5678" />
        </label>
        <label className="adm-field">
          <span>Notas internas (opcional)</span>
          <textarea id="f-notes" value={form.notes} onChange={set('notes')} rows={2} maxLength={500} />
        </label>
        <div className="adm-checks">
          <label>
            <input type="checkbox" checked={form.enabled} onChange={set('enabled')} /> Enlace habilitado
          </label>
          <label>
            <input type="checkbox" checked={form.isDemo} onChange={set('isDemo')} /> Dato de demostración
          </label>
        </div>
        <div className="adm-dialog-actions">
          <button className="adm-btn adm-btn-primary" disabled={busy}>
            {busy ? 'Guardando…' : current ? 'Guardar cambios' : 'Crear invitación'}
          </button>
        </div>
      </form>

      {current ? (
        <>
          <section className="adm-subsection">
            <h3>Enlace individual</h3>
            <p className="adm-link" data-testid="admin-link">
              {current.link}
            </p>
            <div className="adm-inline">
              <button className="adm-btn adm-btn-small" onClick={async () => onSaved((await copyText(current.link)) ? 'Enlace copiado' : 'No se pudo copiar')}>
                Copiar enlace
              </button>
              <a className="adm-btn adm-btn-small" href={current.link} target="_blank" rel="noopener noreferrer">
                Abrir
              </a>
              <button className="adm-btn adm-btn-small adm-btn-ghost" disabled={busy} onClick={() => run(() => adminApi.regenerate(current.id), 'Enlace nuevo generado; el anterior ya no funciona')}>
                Generar enlace nuevo
              </button>
            </div>
          </section>

          <section className="adm-subsection">
            <h3>Respuesta</h3>
            <p>
              <span className={`adm-pill adm-pill-${current.attendance}`}>
                {ATTENDANCE[current.attendance]}
                {current.attendance === 'attending' ? ` · ${adultsLabel(current.adults)}` : ''}
              </span>{' '}
              {current.respondedAt ? <span className="adm-muted">{fmt(current.respondedAt)}</span> : null}
            </p>
            <details>
              <summary>Registrar respuesta recibida por otro medio</summary>
              <div className="adm-inline" style={{ marginTop: 10 }}>
                <select value={resp.status} onChange={(e) => setResp((r) => ({ ...r, status: e.target.value as 'attending' | 'declined', adults: e.target.value === 'declined' ? 0 : Math.max(1, r.adults) }))}>
                  <option value="attending">Asistirá</option>
                  <option value="declined">No asistirá</option>
                </select>
                {resp.status === 'attending' ? (
                  <input
                    type="number"
                    min={1}
                    max={current.seats ?? 1}
                    value={resp.adults}
                    onChange={(e) => setResp((r) => ({ ...r, adults: Number(e.target.value) }))}
                    aria-label="Adultos"
                    style={{ width: 80 }}
                  />
                ) : null}
                <button className="adm-btn adm-btn-small" disabled={busy} onClick={() => run(() => adminApi.setResponse(current.id, resp), 'Respuesta registrada')}>
                  Guardar respuesta
                </button>
                {current.attendance !== 'pending' ? (
                  <button className="adm-btn adm-btn-small adm-btn-ghost" disabled={busy} onClick={() => run(() => adminApi.clearResponse(current.id), 'Respuesta borrada; queda pendiente')}>
                    Volver a pendiente
                  </button>
                ) : null}
              </div>
            </details>
          </section>

          <section className="adm-subsection adm-danger">
            {confirmDelete ? (
              <div className="adm-inline">
                <span>¿Eliminar {current.name} y su respuesta? No se puede deshacer.</span>
                <button className="adm-btn adm-btn-small adm-btn-danger" disabled={busy} onClick={() => run(() => adminApi.remove(current.id).then(() => undefined), 'Invitación eliminada', true)}>
                  Sí, eliminar
                </button>
                <button className="adm-btn adm-btn-small adm-btn-ghost" onClick={() => setConfirmDelete(false)}>
                  Cancelar
                </button>
              </div>
            ) : (
              <button className="adm-btn adm-btn-small adm-btn-ghost" onClick={() => setConfirmDelete(true)}>
                Eliminar invitación
              </button>
            )}
          </section>
        </>
      ) : null}
    </Modal>
  );
}

function MessageDialog({ row, onClose, onChanged, notify }: { row: AdminRow; onClose: () => void; onChanged: () => void; notify: (m: string) => void }) {
  const [msg, setMsg] = useState<MessageView | null>(null);
  const [provider, setProvider] = useState<{ label: string; sendsRealMessages: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    Promise.all([adminApi.message(row.id), adminApi.messaging()])
      .then(([m, p]) => {
        setMsg(m);
        setProvider(p.provider);
      })
      .catch((e) => setError(errMsg(e)));
  }, [row.id]);

  async function act(fn: () => Promise<MessageView>, done: string) {
    setBusy(true);
    setError(null);
    try {
      setMsg(await fn());
      notify(done);
      onChanged();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Mensaje · ${row.name}`} onClose={onClose} wide>
      {provider && !provider.sendsRealMessages ? (
        <p className="adm-alert adm-alert-info">
          Este panel no envía mensajes. Copia el texto o ábrelo en WhatsApp y envíalo tú; después usa “Registrar envío manual”. Copiar o abrir WhatsApp no cuenta como enviado ni como confirmación.
        </p>
      ) : null}
      {error ? (
        <p className="adm-alert adm-alert-error" role="alert">
          {error}
        </p>
      ) : null}
      {msg ? (
        <>
          <dl className="adm-dl">
            <dt>Destinatario</dt>
            <dd>{msg.name}</dd>
            <dt>Teléfono</dt>
            <dd>{msg.phone ? fmtPhone(msg.phone) : <span className="adm-muted">Sin teléfono</span>}</dd>
            <dt>Enlace</dt>
            <dd className="adm-link">{msg.link}</dd>
            <dt>Estado del mensaje</dt>
            <dd>
              <span className={`adm-pill adm-comm-${msg.comm.status}`}>{COMM[msg.comm.status]}</span>{' '}
              {msg.comm.at ? <span className="adm-muted">{fmt(msg.comm.at)}{msg.comm.source === 'manual' ? ' · registro manual' : msg.comm.source ? ` · ${msg.comm.source}` : ''}</span> : null}
            </dd>
          </dl>
          <div className="adm-wa-preview" aria-label="Vista previa del mensaje">
            <div className="adm-wa-bubble">{msg.text}</div>
          </div>
          <div className="adm-inline">
            <button className="adm-btn adm-btn-primary adm-btn-small" onClick={async () => notify((await copyText(msg.text)) ? 'Texto copiado' : 'No se pudo copiar')}>
              Copiar texto
            </button>
            <button className="adm-btn adm-btn-small" onClick={async () => notify((await copyText(msg.link)) ? 'Enlace copiado' : 'No se pudo copiar')}>
              Copiar enlace
            </button>
            <a className="adm-btn adm-btn-small" href={msg.waUrl} target="_blank" rel="noopener noreferrer">
              Abrir en WhatsApp
            </a>
          </div>
          <div className="adm-subsection">
            <h3>Registro de comunicación</h3>
            <p className="adm-muted">“Marcar como preparado” solo indica que el texto está listo. Registra el envío o la entrega únicamente cuando tú hayas enviado el mensaje o lo veas entregado.</p>
            <div className="adm-inline">
              <button className="adm-btn adm-btn-small" disabled={busy} onClick={() => act(() => adminApi.prepare(row.id), 'Mensaje marcado como preparado (sin envío)')}>
                Marcar como preparado
              </button>
              <button className="adm-btn adm-btn-small adm-btn-ghost" disabled={busy} onClick={() => act(() => adminApi.manual(row.id, 'sent'), 'Registrado como enviado (manual)')}>
                Registrar envío manual
              </button>
              <button className="adm-btn adm-btn-small adm-btn-ghost" disabled={busy} onClick={() => act(() => adminApi.manual(row.id, 'delivered'), 'Registrado como entregado (manual)')}>
                Registrar entrega manual
              </button>
            </div>
          </div>
        </>
      ) : !error ? (
        <p className="adm-muted">Cargando…</p>
      ) : null}
    </Modal>
  );
}

const ACTION_LABEL = { create: 'Nueva', update: 'Actualiza', unchanged: 'Sin cambios', error: 'Error' } as const;

function ImportDialog({ onClose, onApplied }: { onClose: () => void; onApplied: (msg: string) => void }) {
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load(file: File) {
    setError(null);
    setPreview(null);
    setFileName(file.name);
    const text = await file.text();
    setCsv(text);
    setBusy(true);
    try {
      setPreview(await adminApi.previewImport(text));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      const r = await adminApi.applyImport(csv);
      onApplied(`Importación aplicada: ${r.counts.create} nuevas, ${r.counts.update} actualizadas, ${r.counts.unchanged} sin cambios`);
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const issues = useMemo(() => preview?.rows.filter((r) => r.errors.length || r.warnings.length || r.action !== 'unchanged') ?? [], [preview]);

  return (
    <Modal title="Importar invitados (CSV)" onClose={onClose} wide>
      <p className="adm-muted">
        Columnas: <code>identificador, nombre, telefono, lugares_adultos, notas</code>. Un identificador existente se actualiza; nunca se duplica ni se combinan registros por apellido o teléfono.{' '}
        <a href="/api/admin/template.csv" download>
          Descargar plantilla
        </a>
      </p>
      <label className="adm-file">
        <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
        <span>{fileName || 'Elegir archivo CSV…'}</span>
      </label>
      {error ? (
        <p className="adm-alert adm-alert-error" role="alert">
          {error}
        </p>
      ) : null}
      {busy && !preview ? <p className="adm-muted">Revisando archivo…</p> : null}
      {preview ? (
        <>
          <p className={`adm-alert ${preview.canApply ? 'adm-alert-info' : 'adm-alert-error'}`} role="status">
            {preview.counts.create} nuevas · {preview.counts.update} actualizadas · {preview.counts.unchanged} sin cambios · {preview.counts.error} con error.{' '}
            {preview.canApply ? 'Revisa y confirma para aplicar.' : 'Corrige los errores en el archivo y vuelve a cargarlo; no se aplicó nada.'}
          </p>
          {issues.length ? (
            <div className="adm-table-wrap">
              <table className="adm-table adm-table-compact">
                <thead>
                  <tr>
                    <th>Línea</th>
                    <th>Invitación</th>
                    <th>Resultado</th>
                    <th>Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {issues.map((r) => (
                    <tr key={r.line} className={r.action === 'error' ? 'is-error' : ''}>
                      <td>{r.line}</td>
                      <td>
                        {r.code}
                        <span className="adm-sub">{r.name}</span>
                      </td>
                      <td>{ACTION_LABEL[r.action]}</td>
                      <td>
                        {[...r.errors, ...r.warnings].map((m, i) => (
                          <div key={i} className={i < r.errors.length ? 'adm-err' : 'adm-warn'}>
                            {m}
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <div className="adm-dialog-actions">
            <button className="adm-btn adm-btn-primary" disabled={!preview.canApply || busy} onClick={apply}>
              {busy ? 'Aplicando…' : 'Aplicar importación'}
            </button>
          </div>
        </>
      ) : null}
    </Modal>
  );
}
