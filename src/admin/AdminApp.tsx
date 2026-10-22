import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { AdminSummary, AttendanceStatus, BackendStatus, CommStatus, ImportPreview, Side } from '../../shared/types';
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
const SIDE: Record<Side, string> = { novia: 'Novia', novio: 'Novio', ambos: 'Ambos' };
const errMsg = (e: unknown) => (e instanceof ApiFailure ? e.message : 'Ocurrió un error inesperado.');
const fmt = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Mexico_City' })
        .format(new Date(iso))
        .replace(/\s*([ap])\.\s*m\./g, ' $1. m.')
    : '';
const personas = (n: number) => `${n} ${n === 1 ? 'persona' : 'personas'}`;
const fmtPhone = (p: string | null) => (p ? (p.startsWith('52') && p.length === 12 ? `+52 ${p.slice(2, 4)} ${p.slice(4, 8)} ${p.slice(8)}` : `+${p}`) : '');
const namesOf = (row: AdminRow, ids: string[]) => ids.map((id) => row.people.find((p) => p.id === id)?.name ?? id);

/**
 * Menú desplegable de descargas. Solo uno abierto a la vez; se cierra al tocar fuera o con Escape.
 * En el teléfono se muestra como hoja inferior con su título.
 */
function AdminMenu({ label, ghost, open, onOpenChange, children }: { label: string; ghost?: boolean; open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOpenChange(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onOpenChange(false);
        ref.current?.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', esc);
    };
  }, [open, onOpenChange]);
  return (
    <details className="adm-menu" ref={ref} open={open} onToggle={(e) => (e.currentTarget.open !== open ? onOpenChange(e.currentTarget.open) : undefined)}>
      <summary className={`adm-btn${ghost ? ' adm-btn-ghost' : ''}`}>{label}</summary>
      <div className="adm-menu-list" role="group" aria-label={label}>
        <p className="adm-menu-title" aria-hidden="true">
          {label}
        </p>
        {children}
      </div>
    </details>
  );
}

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
  return <Backend onLogout={() => setState('login')} />;
}

/** Con la demostración local se administra la lista aquí; con Google Sheets, en la hoja. */
function Backend({ onLogout }: { onLogout: () => void }) {
  const [status, setStatus] = useState<BackendStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    adminApi
      .backend()
      .then(setStatus)
      .catch((e) => (e instanceof ApiFailure && e.status === 401 ? onLogout() : setError(errMsg(e))));
  }, [onLogout]);
  useEffect(load, [load]);
  if (error) return <div className="adm adm-center">{error}</div>;
  if (!status) return <div className="adm adm-center">Cargando…</div>;
  if (status.canManageList) return <Dashboard onLogout={onLogout} />;
  return (
    <div className="adm">
      <Header onLogout={onLogout} />
      <main className="adm-main">
        <section className="adm-card adm-backend" aria-labelledby="backend-title">
          <h2 id="backend-title">{status.mode === 'sheets' ? 'Registro: Google Sheets' : 'Sin registro de confirmaciones'}</h2>
          <p className={`adm-alert ${status.ready ? 'adm-alert-info' : 'adm-alert-error'}`} role="status" data-testid="backend-status">
            {status.ready ? 'Conectado. ' : 'No conectado. '}
            {status.detail}
          </p>
          {status.mode === 'sheets' ? (
            <p>La lista, los enlaces personales y el cierre de confirmaciones se administran desde la hoja, con el menú “Boda”. Este panel solo muestra el estado.</p>
          ) : (
            <p>Los invitados ven la confirmación como “todavía no habilitada”. Para probar, arranca la demostración local (<code>npm run demo</code>).</p>
          )}
          {status.summary ? <Stats summary={status.summary} /> : null}
          {status.issues?.length ? (
            <>
              <h3>Revisión de la lista</h3>
              <ul className="adm-issues">
                {status.issues.map((i, k) => (
                  <li key={k} className={i.severity === 'error' ? 'adm-err' : 'adm-warn'}>
                    {i.tab} · {i.id}: {i.message}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <button className="adm-btn" onClick={load}>
            Volver a comprobar
          </button>
        </section>
      </main>
    </div>
  );
}

function Header({ onLogout }: { onLogout: () => void }) {
  return (
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
  );
}

function Stats({ summary, children }: { summary: AdminSummary; children?: ReactNode }) {
  return (
    <section className="adm-stats" aria-label="Totales">
      <Stat label="Personas confirmadas" value={summary.attendingPeople} sub={`de ${summary.seatsAssigned} lugares asignados`} strong />
      <Stat label="Invitaciones" value={summary.invitations} sub={summary.incomplete ? `${summary.incomplete} sin cupo asignado` : 'todas con cupo'} />
      <Stat label="Personas autorizadas" value={summary.people} sub="en invitaciones activas" />
      <Stat label="Asistirán" value={summary.attending} sub="invitaciones" />
      <Stat label="No asistirán" value={summary.declined} sub="invitaciones" />
      <Stat label="Pendientes" value={summary.pending} sub="sin respuesta" />
      <Stat label="Lugares sin usar" value={summary.unusedSeats} sub="en respuestas; deciden los novios" />
      {children}
    </section>
  );
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
  const [dialog, setDialog] = useState<Dialog>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmToggle, setConfirmToggle] = useState(false);
  const [menu, setMenu] = useState<'export' | 'templates' | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3200);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [list, sum] = await Promise.all([adminApi.list({ q, status }), adminApi.summary()]);
      setRows(list);
      setSummary(sum);
      setError(null);
    } catch (e) {
      if (e instanceof ApiFailure && e.status === 401) onLogout();
      else setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [q, status, onLogout]);

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
    if (!row.link) return;
    notify((await copyText(row.link)) ? `Enlace de ${row.name} copiado` : 'No se pudo copiar; selecciona el enlace manualmente');
  }

  return (
    <div className="adm">
      <Header onLogout={onLogout} />
      <main className="adm-main">
        <p className="adm-alert adm-alert-info" data-testid="demo-notice">
          <strong>Demostración local.</strong> Datos ficticios para revisar y probar; los enlaces llevan el prefijo <code>demo_</code> y nunca sirven en el registro real. El registro
          principal será Google Sheets.
        </p>
        {summary ? (
          <Stats summary={summary}>
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
          </Stats>
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
              <input type="search" placeholder="Buscar por grupo, persona, ID o teléfono" value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
            <label className="adm-field">
              <span className="sr-only">Estado de asistencia</span>
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="all">Todos los estados</option>
                <option value="pending">Pendientes</option>
                <option value="attending">Asistirán</option>
                <option value="declined">No asistirán</option>
                <option value="incomplete">Sin cupo o sin personas</option>
                <option value="revoked">Enlace revocado o inactiva</option>
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
            <AdminMenu label="Exportar" open={menu === 'export'} onOpenChange={(o) => setMenu(o ? 'export' : null)}>
              <a href="/api/admin/export/invitaciones.csv" download>
                Invitaciones.csv
              </a>
              <a href="/api/admin/export/personas.csv" download>
                Personas.csv
              </a>
              <a href="/api/admin/export/respuestas.csv" download>
                Respuestas.csv
              </a>
              <a href="/api/admin/messages.csv" download>
                Mensajes (enlaces de demostración)
              </a>
            </AdminMenu>
            <AdminMenu label="Plantillas" ghost open={menu === 'templates'} onOpenChange={(o) => setMenu(o ? 'templates' : null)}>
              <a href="/api/admin/templates/invitaciones.csv" download>
                Invitaciones.csv
              </a>
              <a href="/api/admin/templates/personas.csv" download>
                Personas.csv
              </a>
              <a href="/api/admin/templates/respuestas.csv" download>
                Respuestas.csv
              </a>
            </AdminMenu>
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
              {!q && status === 'all' ? <p className="adm-muted">Crea la primera con “Nueva invitación” o importa Invitaciones.csv y Personas.csv.</p> : null}
            </div>
          ) : null}
          {rows.length ? (
            <div className="adm-table-wrap">
              <table className="adm-table">
                <thead>
                  <tr>
                    <th scope="col">Invitación</th>
                    <th scope="col">Personas / cupo</th>
                    <th scope="col">Asistencia</th>
                    <th scope="col">Mensaje</th>
                    <th scope="col">
                      <span className="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const active = r.people.filter((p) => p.active).length;
                    return (
                      <tr key={r.id} className={r.enabled && !r.linkRevoked ? '' : 'is-disabled'}>
                        <td data-label="Invitación">
                          <strong>{r.name}</strong>
                          <span className="adm-sub">
                            {r.code}
                            {r.side ? ` · ${SIDE[r.side]}` : ''}
                            {r.phone ? ` · ${fmtPhone(r.phone)}` : ''}
                            {!r.enabled ? ' · inactiva' : ''}
                            {r.linkRevoked ? ' · enlace revocado' : ''}
                          </span>
                        </td>
                        <td data-label="Personas / cupo">
                          {active} / {r.seats ?? <span className="adm-pill adm-pill-warn">Pendiente</span>}
                          {r.seats !== null && active > r.seats ? <span className="adm-sub">más personas que cupo</span> : null}
                          {r.seats !== null && active > 0 && active < r.seats ? <span className="adm-sub">cupo mayor que personas</span> : null}
                          {!active ? <span className="adm-sub">sin personas</span> : null}
                        </td>
                        <td data-label="Asistencia">
                          <span className={`adm-pill adm-pill-${r.attendance}`}>
                            {ATTENDANCE[r.attendance]}
                            {r.attendance === 'attending' ? ` · ${r.attendingCount}` : ''}
                            {r.attendance === 'attending' ? <span className="sr-only"> {r.attendingCount === 1 ? 'persona' : 'personas'}</span> : null}
                          </span>
                          {r.attendance === 'attending' ? <span className="adm-sub">{namesOf(r, r.selectedPersonIds).join(', ')}</span> : null}
                          {r.respondedAt ? <span className="adm-sub">{fmt(r.respondedAt)}</span> : null}
                        </td>
                        <td data-label="Mensaje">
                          <span className={`adm-pill adm-comm-${r.comm.status}`}>{COMM[r.comm.status]}</span>
                          {r.comm.source === 'manual' ? <span className="adm-sub">registro manual</span> : null}
                        </td>
                        <td className="adm-actions-cell">
                          <div className="adm-row-actions">
                            {r.link ? (
                              <button className="adm-btn adm-btn-small" onClick={() => copyLink(r)} aria-label={`Copiar enlace de ${r.name}`}>
                                Copiar enlace
                              </button>
                            ) : null}
                            {r.link ? (
                              <button className="adm-btn adm-btn-small" onClick={() => setDialog({ kind: 'message', row: r })} aria-label={`Mensaje para ${r.name}`}>
                                Mensaje
                              </button>
                            ) : null}
                            <button className="adm-btn adm-btn-small" onClick={() => setDialog({ kind: 'edit', row: r })} aria-label={`Editar ${r.name}`}>
                              Editar
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
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

type PersonDraft = { key: string; id?: string; name: string; active: boolean };
let draftKey = 0;
const blankPerson = (): PersonDraft => ({ key: `nuevo-${++draftKey}`, name: '', active: true });
const draftsOf = (row: AdminRow | null): PersonDraft[] =>
  row?.people.length ? row.people.map((p) => ({ key: p.id, id: p.id, name: p.name, active: p.active })) : [blankPerson()];

function EditDialog({ row, onClose, onSaved }: { row: AdminRow | null; onClose: () => void; onSaved: (msg: string) => void }) {
  const [current, setCurrent] = useState<AdminRow | null>(row);
  const [form, setForm] = useState({
    code: row?.code ?? '',
    side: row?.side ?? '',
    name: row?.name ?? '',
    contact: row?.contact ?? '',
    phone: row?.phone ? `+${row.phone}` : '',
    seats: row?.seats ? String(row.seats) : '',
    notes: row?.notes ?? '',
    enabled: row?.enabled ?? true,
  });
  const [people, setPeople] = useState<PersonDraft[]>(() => draftsOf(row));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<'delete' | 'revoke' | 'regenerate' | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string; checked?: boolean; type?: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? Boolean(e.target.checked) : e.target.value }));

  // Solo al guardar el formulario se reemplazan las personas en edición; las acciones de enlace
  // o de respuesta conservan lo que se esté capturando.
  async function run(fn: () => Promise<AdminRow | void>, msg: string, closeAfter = false, syncDrafts = false) {
    setBusy(true);
    setError(null);
    try {
      const out = await fn();
      if (out) {
        setCurrent(out);
        if (syncDrafts) setPeople(draftsOf(out));
      }
      setConfirm(null);
      onSaved(msg);
      if (closeAfter) onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const body = {
      ...form,
      side: form.side || null,
      seats: form.seats.trim() === '' ? null : Number(form.seats),
      phone: form.phone.trim() || null,
      contact: form.contact.trim() || null,
      notes: form.notes.trim() || null,
      people: people.filter((p) => p.id || p.name.trim()).map((p) => ({ id: p.id, name: p.name, active: p.active })),
    };
    // Al crear, el diálogo sigue abierto para mostrar y copiar el enlace nuevo.
    void run(
      () => (current ? adminApi.update(current.id, body) : adminApi.create(body)),
      current ? 'Cambios guardados' : 'Invitación creada; ya puedes copiar su enlace',
      Boolean(current),
      true,
    );
  }

  const updatePerson = (key: string, patch: Partial<PersonDraft>) => setPeople((list) => list.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  return (
    <Modal title={current ? `Editar · ${current.name}` : 'Nueva invitación'} onClose={onClose} wide>
      <form onSubmit={submit} className="adm-form">
        {error ? (
          <p className="adm-alert adm-alert-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="adm-grid-2">
          <label className="adm-field">
            <span>ID de invitación</span>
            <input id="f-code" value={form.code} onChange={set('code')} required placeholder="DEMO-006" maxLength={40} readOnly={Boolean(current)} />
            <small>{current ? 'Estable: no cambia.' : 'Estable; se usa para importar sin duplicar.'}</small>
          </label>
          <label className="adm-field">
            <span>Lado</span>
            <select id="f-side" value={form.side} onChange={set('side')}>
              <option value="">Sin indicar</option>
              <option value="novia">Novia</option>
              <option value="novio">Novio</option>
              <option value="ambos">Ambos</option>
            </select>
          </label>
        </div>
        <label className="adm-field">
          <span>Nombre del grupo</span>
          <input id="f-name" value={form.name} onChange={set('name')} required maxLength={120} placeholder="Familia Ejemplo" />
        </label>
        <div className="adm-grid-2">
          <label className="adm-field">
            <span>Contacto principal (opcional)</span>
            <input id="f-contact" value={form.contact} onChange={set('contact')} maxLength={120} />
          </label>
          <label className="adm-field">
            <span>Teléfono (opcional)</span>
            <input id="f-phone" type="tel" value={form.phone} onChange={set('phone')} placeholder="33 0000 0000" />
          </label>
        </div>
        <label className="adm-field">
          <span>Cupo asignado</span>
          <input id="f-seats" type="number" inputMode="numeric" min={1} max={30} value={form.seats} onChange={set('seats')} placeholder="Pendiente" />
          <small>Vacío = pendiente: no podrá confirmar. El invitado nunca puede cambiarlo.</small>
        </label>

        <fieldset className="adm-people">
          <legend>Personas autorizadas</legend>
          {people.map((p, i) => (
            <div className={`adm-person${p.active ? '' : ' is-off'}`} key={p.key}>
              <input aria-label={`Nombre de la persona ${i + 1}`} value={p.name} maxLength={120} onChange={(e) => updatePerson(p.key, { name: e.target.value })} placeholder="Nombre y apellidos" />
              {p.id ? (
                <label className="adm-person-active">
                  <input type="checkbox" checked={p.active} onChange={(e) => updatePerson(p.key, { active: e.target.checked })} /> Activa
                </label>
              ) : (
                <button type="button" className="adm-btn adm-btn-small adm-btn-ghost" onClick={() => setPeople((l) => l.filter((x) => x.key !== p.key))}>
                  Quitar
                </button>
              )}
              <small className="adm-person-id">{p.id ?? 'ID al guardar'}</small>
            </div>
          ))}
          <button type="button" className="adm-btn adm-btn-small" onClick={() => setPeople((l) => [...l, blankPerson()])}>
            Agregar persona
          </button>
          <small className="adm-help">Las personas guardadas no se borran: se desactivan, para conservar su ID y su historial.</small>
        </fieldset>

        <label className="adm-field">
          <span>Notas internas (opcional)</span>
          <textarea id="f-notes" value={form.notes} onChange={set('notes')} rows={2} maxLength={500} />
        </label>
        <div className="adm-checks">
          <label>
            <input type="checkbox" checked={form.enabled} onChange={set('enabled')} /> Invitación activa
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
            <h3>Enlace personal</h3>
            {current.link ? (
              <p className="adm-link" data-testid="admin-link">
                {current.link}
              </p>
            ) : (
              <p className="adm-alert adm-alert-error">Enlace revocado: no funciona hasta generar uno nuevo.</p>
            )}
            <p className="adm-muted adm-help">
              Quien tenga este enlace puede consultar y cambiar la respuesta de esta invitación; reenviarlo transmite esa capacidad. No identifica a la persona que lo abre.
            </p>
            <div className="adm-inline">
              {current.link ? (
                <>
                  <button className="adm-btn adm-btn-small" onClick={async () => onSaved((await copyText(current.link!)) ? 'Enlace copiado' : 'No se pudo copiar')}>
                    Copiar enlace
                  </button>
                  <a className="adm-btn adm-btn-small" href={current.link} target="_blank" rel="noopener noreferrer">
                    Abrir
                  </a>
                </>
              ) : null}
              {confirm === 'regenerate' ? (
                <>
                  <span>{current.link ? '¿Generar uno nuevo? El enlace actual dejará de funcionar.' : '¿Generar un enlace nuevo?'}</span>
                  <button className="adm-btn adm-btn-small adm-btn-primary" disabled={busy} onClick={() => run(() => adminApi.regenerate(current.id), current.link ? 'Enlace nuevo generado; el anterior ya no funciona' : 'Enlace nuevo generado')}>
                    Sí, generar
                  </button>
                  <button className="adm-btn adm-btn-small adm-btn-ghost" onClick={() => setConfirm(null)}>
                    Cancelar
                  </button>
                </>
              ) : (
                <button className="adm-btn adm-btn-small adm-btn-ghost" disabled={busy} onClick={() => setConfirm('regenerate')}>
                  Generar enlace nuevo
                </button>
              )}
              {current.link && confirm !== 'regenerate' ? (
                confirm === 'revoke' ? (
                  <>
                    <span>¿Revocar? Dejará de funcionar.</span>
                    <button className="adm-btn adm-btn-small adm-btn-danger" disabled={busy} onClick={() => run(() => adminApi.revoke(current.id), 'Enlace revocado')}>
                      Sí, revocar
                    </button>
                    <button className="adm-btn adm-btn-small adm-btn-ghost" onClick={() => setConfirm(null)}>
                      Cancelar
                    </button>
                  </>
                ) : (
                  <button className="adm-btn adm-btn-small adm-btn-ghost" onClick={() => setConfirm('revoke')}>
                    Revocar enlace
                  </button>
                )
              ) : null}
            </div>
          </section>

          <ResponseEditor row={current} busy={busy} run={run} />

          <section className="adm-subsection adm-danger">
            {confirm === 'delete' ? (
              <div className="adm-inline">
                <span>¿Eliminar {current.name}, sus personas y su respuesta? No se puede deshacer.</span>
                <button className="adm-btn adm-btn-small adm-btn-danger" disabled={busy} onClick={() => run(() => adminApi.remove(current.id).then(() => undefined), 'Invitación eliminada', true)}>
                  Sí, eliminar
                </button>
                <button className="adm-btn adm-btn-small adm-btn-ghost" onClick={() => setConfirm(null)}>
                  Cancelar
                </button>
              </div>
            ) : (
              <button className="adm-btn adm-btn-small adm-btn-ghost" onClick={() => setConfirm('delete')}>
                Eliminar invitación
              </button>
            )}
          </section>
        </>
      ) : null}
    </Modal>
  );
}

function ResponseEditor({ row, busy, run }: { row: AdminRow; busy: boolean; run: (fn: () => Promise<AdminRow | void>, msg: string) => Promise<void> }) {
  const active = row.people.filter((p) => p.active);
  const [none, setNone] = useState(row.attendance === 'declined');
  const [ids, setIds] = useState<string[]>(row.attendance === 'attending' ? row.selectedPersonIds : []);
  const seats = row.seats ?? 0;
  return (
    <section className="adm-subsection">
      <h3>Respuesta</h3>
      <p>
        <span className={`adm-pill adm-pill-${row.attendance}`}>
          {ATTENDANCE[row.attendance]}
          {row.attendance === 'attending' ? ` · ${personas(row.attendingCount)} de ${seats}` : ''}
        </span>{' '}
        {row.respondedAt ? <span className="adm-muted">{fmt(row.respondedAt)} · {row.responseSource === 'admin' ? 'registrada en el panel' : 'por el enlace'}</span> : null}
      </p>
      {row.attendance === 'attending' ? <p className="adm-muted">{namesOf(row, row.selectedPersonIds).join(', ')}</p> : null}
      <details>
        <summary>Registrar respuesta recibida por otro medio</summary>
        {!active.length || row.seats === null ? (
          <p className="adm-muted">Asigna cupo y al menos una persona activa para registrar asistencia.</p>
        ) : null}
        <div className="adm-checks adm-checks-col" style={{ marginTop: 10 }}>
          {active.map((p) => {
            const on = !none && ids.includes(p.id);
            return (
              <label key={p.id}>
                <input
                  type="checkbox"
                  checked={on}
                  disabled={!on && ids.length >= seats}
                  onChange={(e) => {
                    setNone(false);
                    setIds((l) => (e.target.checked ? [...l, p.id] : l.filter((x) => x !== p.id)));
                  }}
                />{' '}
                {p.name}
              </label>
            );
          })}
          <label>
            <input
              type="checkbox"
              checked={none}
              onChange={(e) => {
                setNone(e.target.checked);
                if (e.target.checked) setIds([]);
              }}
            />{' '}
            Nadie asistirá
          </label>
        </div>
        <div className="adm-inline" style={{ marginTop: 10 }}>
          <button
            className="adm-btn adm-btn-small"
            disabled={busy || (!none && !ids.length)}
            onClick={() => run(() => adminApi.setResponse(row.id, { status: none ? 'declined' : 'attending', personIds: none ? [] : ids }), 'Respuesta registrada')}
          >
            Guardar respuesta
          </button>
          {row.attendance !== 'pending' ? (
            <button className="adm-btn adm-btn-small adm-btn-ghost" disabled={busy} onClick={() => run(() => adminApi.clearResponse(row.id), 'Respuesta borrada; queda pendiente')}>
              Volver a pendiente
            </button>
          ) : null}
        </div>
      </details>
    </section>
  );
}

const ACTION_LABEL = { create: 'Nueva', update: 'Actualiza', unchanged: 'Sin cambios', error: 'Error' } as const;

function ImportDialog({ onClose, onApplied }: { onClose: () => void; onApplied: (msg: string) => void }) {
  const [files, setFiles] = useState<{ invitations?: string; people?: string }>({});
  const [names, setNames] = useState<{ invitations?: string; people?: string }>({});
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load(kind: 'invitations' | 'people', file: File) {
    setError(null);
    setPreview(null);
    const next = { ...files, [kind]: await file.text() };
    setFiles(next);
    setNames((n) => ({ ...n, [kind]: file.name }));
    setBusy(true);
    try {
      setPreview(await adminApi.previewImport(next));
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
      const r = await adminApi.applyImport(files);
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
    <Modal title="Importar (estructura de Google Sheets)" onClose={onClose} wide>
      <p className="adm-muted">
        Usa las plantillas <code>Invitaciones.csv</code> y <code>Personas.csv</code> (puedes subir una o ambas). Un ID existente se actualiza; nunca se duplica ni se combinan registros por
        apellido o teléfono. Nada se aplica hasta que confirmes.
      </p>
      <div className="adm-grid-2">
        <label className="adm-file">
          <input type="file" accept=".csv,text/csv" aria-label="Archivo Invitaciones.csv" onChange={(e) => e.target.files?.[0] && load('invitations', e.target.files[0])} />
          <span>{names.invitations || 'Invitaciones.csv…'}</span>
        </label>
        <label className="adm-file">
          <input type="file" accept=".csv,text/csv" aria-label="Archivo Personas.csv" onChange={(e) => e.target.files?.[0] && load('people', e.target.files[0])} />
          <span>{names.people || 'Personas.csv…'}</span>
        </label>
      </div>
      {error ? (
        <p className="adm-alert adm-alert-error" role="alert">
          {error}
        </p>
      ) : null}
      {busy && !preview ? <p className="adm-muted">Revisando archivos…</p> : null}
      {preview ? (
        <>
          <p className={`adm-alert ${preview.canApply ? 'adm-alert-info' : 'adm-alert-error'}`} role="status">
            {preview.counts.create} nuevas · {preview.counts.update} actualizadas · {preview.counts.unchanged} sin cambios · {preview.counts.error} con error.{' '}
            {preview.canApply ? 'Revisa y confirma para aplicar.' : 'Corrige los errores y vuelve a cargar el archivo; no se aplicó nada.'}
          </p>
          {preview.general.length ? (
            <ul className="adm-issues">
              {preview.general.map((g, i) => (
                <li key={i} className="adm-warn">
                  {g}
                </li>
              ))}
            </ul>
          ) : null}
          {issues.length ? (
            <div className="adm-table-wrap">
              <table className="adm-table adm-table-compact">
                <thead>
                  <tr>
                    <th>Pestaña</th>
                    <th>Línea</th>
                    <th>Registro</th>
                    <th>Resultado</th>
                    <th>Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {issues.map((r) => (
                    <tr key={`${r.tab}-${r.line}`} className={r.action === 'error' ? 'is-error' : ''}>
                      <td>{r.tab}</td>
                      <td>{r.line}</td>
                      <td>
                        {r.id}
                        <span className="adm-sub">{r.label}</span>
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

