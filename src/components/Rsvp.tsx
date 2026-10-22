import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { PublicInvitation } from '../../shared/types';
import { ApiFailure, fetchInvitation, newRequestId, saveRsvp } from '../lib/api';
import type { UiMode } from '../lib/mode';
import { EVENT } from '../../shared/event';
import { CheckCircleIcon } from './Icons';

interface Props {
  token: string | null;
  invitation: PublicInvitation | null;
  loadError: ApiFailure | null;
  loading: boolean;
  /** La invitación cambió (respuesta guardada o respuesta vigente tras un conflicto). */
  onChanged: (inv: PublicInvitation) => void;
  onRetryLoad: () => void;
  mode: UiMode;
}

const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat('es-MX', { dateStyle: 'long', timeStyle: 'short', timeZone: EVENT.timeZone })
    .format(new Date(iso))
    .replace(/\s*([ap])\.\s*m\./g, ' $1. m.');

const deadlineText = () =>
  EVENT.rsvpDeadline
    ? `Por favor confírmanos antes del ${new Intl.DateTimeFormat('es-MX', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(EVENT.rsvpDeadline))}.`
    : null;

const lugares = (n: number) => `${n} ${n === 1 ? 'lugar' : 'lugares'}`;

/** Lugares que la familia puede usar: el cupo, sin pasar del número de personas autorizadas. */
const reservedOf = (inv: PublicInvitation) => Math.min(inv.seats ?? 0, inv.people.length);

function seatsText(inv: PublicInvitation) {
  const n = reservedOf(inv);
  if (!n) return null;
  return inv.people.length === 1 ? 'Hemos reservado 1 lugar para ti.' : `Hemos reservado ${lugares(n)} para ustedes.`;
}

/** Enfoca un encabezado y lo deja a media pantalla (lejos del aviso superior y de la barra inferior). */
function focusInView(el: HTMLElement | null, block: ScrollLogicalPosition = 'center') {
  if (!el) return;
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block });
}

/** Rechazos que indican que la invitación cambió (cupo, personas o cierre): se vuelve a cargar. */
const REFRESH_CODES = ['over_capacity', 'unknown_person', 'inactive_person', 'rsvp_closed', 'seats_unassigned', 'request_id_reused'];

/** Texto del paquete BODA-003-R02, cerca de la lista de personas y del formulario. */
export function NonTransferableNote() {
  return (
    <div className="non-transferable" role="note" data-testid="intransferible">
      <p className="nt-title">Invitación personal e intransferible.</p>
      <p>
        Los lugares están reservados exclusivamente para las personas indicadas en esta invitación. Si alguno de ustedes no puede acompañarnos, su lugar no
        podrá transferirse a otra persona. Gracias por ayudarnos a organizar este día tan especial.
      </p>
    </div>
  );
}

export function Rsvp({ token, invitation, loadError, loading, onChanged, onRetryLoad, mode }: Props) {
  if (!token) {
    return (
      <div className="rsvp-card" data-testid="rsvp-general">
        <h3>Confirma con tu enlace personal</h3>
        <p className="muted" style={{ margin: 0 }}>
          Para confirmar necesitas el enlace personal que recibiste. Este enlace general solo muestra los detalles de la boda y no registra confirmaciones.
        </p>
      </div>
    );
  }
  if (loading) {
    return (
      <div className="rsvp-card" aria-busy="true">
        <p className="muted" style={{ margin: 0 }}>
          Cargando tu invitación…
        </p>
      </div>
    );
  }
  if (loadError) {
    if (loadError.code === 'rsvp_not_enabled') {
      return (
        <div className="rsvp-card" data-testid="rsvp-not-enabled">
          <div className="alert alert-info" role="status">
            <strong>La confirmación en línea todavía no está habilitada</strong>
            Guarda este enlace: muy pronto podrás confirmar desde aquí.
          </div>
        </div>
      );
    }
    const notFound = loadError.status === 404;
    return (
      <div className="rsvp-card">
        <div className="alert alert-error" role="alert">
          <strong>{notFound ? 'No encontramos esta invitación' : 'No pudimos cargar tu invitación'}</strong>
          {notFound ? 'Revisa que el enlace esté completo o pídenos que te lo compartamos de nuevo.' : loadError.message}
        </div>
        {!notFound ? (
          <button type="button" className="btn" onClick={onRetryLoad}>
            Reintentar
          </button>
        ) : null}
      </div>
    );
  }
  if (!invitation) return null;
  return <PeopleRsvp token={token} invitation={invitation} onChanged={onChanged} mode={mode} />;
}

type Draft = { none: boolean; ids: string[] };

const draftFrom = (inv: PublicInvitation): Draft => {
  const r = inv.response;
  if (!r) return { none: false, ids: [] };
  return r.status === 'declined' ? { none: true, ids: [] } : { none: false, ids: r.personIds };
};

function namesOf(inv: PublicInvitation, ids: string[]) {
  const byId = new Map(inv.people.map((p) => [p.id, p.name]));
  return ids.map((id) => byId.get(id)).filter((n): n is string => Boolean(n));
}

function summaryLine(inv: PublicInvitation, d: Draft) {
  const single = inv.people.length === 1;
  if (d.none) return single ? 'No podrás asistir.' : 'Nadie de esta invitación podrá asistir.';
  if (single) return 'Asistirás.';
  const n = d.ids.length;
  const r = reservedOf(inv);
  const who = n === 1 ? 'Asistirá 1 persona' : `Asistirán ${n} personas`;
  return r ? `${who} de ${lugares(r)} ${r === 1 ? 'reservado' : 'reservados'}.` : `${who}.`;
}

function PeopleRsvp({ token, invitation, onChanged, mode }: { token: string; invitation: PublicInvitation; onChanged: (inv: PublicInvitation) => void; mode: UiMode }) {
  const seats = invitation.seats ?? 0;
  const people = invitation.people;
  const single = people.length === 1;
  const [editing, setEditing] = useState(!invitation.response);
  const [step, setStep] = useState<'select' | 'review'>('select');
  const [draft, setDraft] = useState<Draft>(() => draftFrom(invitation));
  const [hint, setHint] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ message: string; uncertain: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [conflict, setConflict] = useState<PublicInvitation | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const requestId = useRef<string | null>(null);
  const inFlight = useRef(false);
  const reviewRef = useRef<HTMLHeadingElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const savedHeadingRef = useRef<HTMLHeadingElement>(null);
  /** A dónde llevar el foco después de un cambio de vista, para no dejarlo en <body>. */
  const focusNext = useRef<'heading' | 'saved' | null>(null);

  useEffect(() => {
    // Arriba de la pantalla: así el botón de guardar queda a la vista también en teléfonos pequeños.
    if (step === 'review' && !error && !conflict) focusInView(reviewRef.current, 'start');
  }, [step, error, conflict]);
  useEffect(() => {
    if (error || conflict) alertRef.current?.focus();
  }, [error, conflict]);
  useEffect(() => {
    if (justSaved) focusInView(savedHeadingRef.current);
  }, [justSaved]);
  useEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    focusInView(target === 'saved' ? savedHeadingRef.current : headingRef.current);
  });

  const header = (
    <>
      <h3 ref={headingRef} tabIndex={-1}>
        {invitation.name}
      </h3>
      <p className="seats">{seatsText(invitation)}</p>
    </>
  );

  if (!invitation.canRespond && !invitation.response) {
    const msg =
      invitation.closedReason === 'seats_unassigned' || invitation.closedReason === 'no_people'
        ? 'Aún estamos preparando los detalles de tu invitación. Muy pronto podrás confirmar desde este mismo enlace.'
        : 'La confirmación de asistencia ya está cerrada. Si necesitas hacer un cambio, escríbenos directamente.';
    return (
      <div className="rsvp-card">
        {header}
        <div className="alert alert-info" role="status">
          {msg}
        </div>
      </div>
    );
  }

  const resetDraft = (inv = invitation) => {
    setDraft(draftFrom(inv));
    setHint(null);
    setError(null);
    setNotice(null);
    setConflict(null);
    requestId.current = null;
    setStep('select');
  };

  if (!editing && invitation.response) {
    const r = invitation.response;
    const names = r.status === 'attending' ? namesOf(invitation, r.personIds) : [];
    const updating = invitation.closedReason === 'seats_unassigned' || invitation.closedReason === 'no_people';
    return (
      <div className="rsvp-card saved" data-testid="rsvp-saved">
        <CheckCircleIcon className="check" />
        <h3 ref={savedHeadingRef} tabIndex={-1}>
          {justSaved ? '¡Gracias! Recibimos tu respuesta' : 'Tu respuesta está registrada'}
        </h3>
        {mode === 'demo' ? <p className="demo-note">Demostración: es una respuesta de prueba.</p> : null}
        <p className="summary">{summaryLine(invitation, { none: r.status === 'declined', ids: r.personIds })}</p>
        {names.length ? (
          <ul className="name-list" aria-label="Personas que asistirán">
            {names.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        ) : null}
        <p>Última actualización: {fmtDate(r.updatedAt)}</p>
        {invitation.canRespond ? (
          <div className="btn-row">
            <button
              type="button"
              className="btn"
              onClick={() => {
                setJustSaved(false);
                resetDraft();
                setEditing(true);
                focusNext.current = 'heading';
              }}
            >
              Cambiar mi respuesta
            </button>
          </div>
        ) : (
          <p style={{ marginTop: 16 }}>
            {updating
              ? 'Estamos actualizando los detalles de tu invitación; muy pronto podrás cambiar tu respuesta desde este enlace.'
              : 'La confirmación ya está cerrada. Si necesitas un cambio, escríbenos.'}
          </p>
        )}
      </div>
    );
  }

  const atLimit = !draft.none && draft.ids.length >= seats;
  const canSelectAll = people.length <= seats;
  const allSelected = !draft.none && draft.ids.length === people.length;

  const touch = (next: Draft) => {
    setDraft(next);
    setHint(null);
    requestId.current = null; // otra selección = otra solicitud
  };
  const toggle = (id: string, on: boolean) => {
    const ids = on ? [...draft.ids, id] : draft.ids.filter((x) => x !== id);
    // Orden de la lista, no el de los clics.
    touch({ none: false, ids: people.map((p) => p.id).filter((pid) => ids.includes(pid)) });
  };

  function toReview(e?: FormEvent) {
    e?.preventDefault();
    if (!draft.none && draft.ids.length === 0) {
      setHint(single ? 'Marca tu nombre si asistirás, o elige "No podré asistir".' : 'Selecciona a quienes asistirán, o elige "Ninguno de nosotros podrá asistir".');
      return;
    }
    if (draft.ids.length > seats) {
      setHint(`Pueden confirmar hasta ${lugares(seats)}.`);
      return;
    }
    setError(null);
    setNotice(null);
    setStep('review');
  }

  async function save() {
    if (inFlight.current) return;
    if (mode === 'static') {
      setNotice('Vista de diseño sin servidor: esta respuesta no se registró. En la invitación publicada se guarda al confirmar.');
      return;
    }
    // El mismo identificador en los reintentos: si el primer intento sí llegó, no se duplica.
    requestId.current ??= newRequestId();
    inFlight.current = true;
    setSaving(true);
    setError(null);
    setConflict(null);
    try {
      const out = await saveRsvp(token, {
        status: draft.none ? 'declined' : 'attending',
        personIds: draft.none ? [] : draft.ids,
        expectedRevision: invitation.revision,
        requestId: requestId.current,
      });
      requestId.current = null;
      setJustSaved(true);
      setEditing(false);
      setStep('select');
      onChanged(out.invitation);
    } catch (err) {
      if (err instanceof ApiFailure && err.code === 'conflict' && err.body.current) {
        const current = err.body.current as PublicInvitation;
        requestId.current = null;
        setConflict(current);
        onChanged(current);
      } else if (err instanceof ApiFailure && REFRESH_CODES.includes(err.code)) {
        // La invitación cambió mientras la revisabas: se recarga y se vuelve a la selección.
        requestId.current = null;
        try {
          const fresh = await fetchInvitation(token);
          onChanged(fresh);
          const active = new Set(fresh.people.map((p) => p.id));
          setDraft((d) => ({ none: d.none, ids: d.ids.filter((id) => active.has(id)) }));
          setNotice(`${err.message} Revisa tu selección.`);
          setStep('select');
          if (!fresh.canRespond) setEditing(false);
          // Sin poder responder: la vista guardada si ya había respuesta; si no, el aviso de cierre (con su encabezado).
          focusNext.current = !fresh.canRespond && fresh.response ? 'saved' : 'heading';
        } catch {
          setError({ message: err.message, uncertain: false });
        }
      } else {
        // Sin respuesta del servidor (red o 5xx) no sabemos si se guardó; un 4xx sí se rechazó.
        const uncertain = !(err instanceof ApiFailure) || err.status === 0 || err.status >= 500 || err.code === 'server';
        setError({ message: err instanceof ApiFailure ? err.message : 'Ocurrió un error inesperado.', uncertain });
      }
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  const deadline = deadlineText();

  if (step === 'review') {
    const names = draft.none ? [] : namesOf(invitation, draft.ids);
    const unused = draft.none ? 0 : reservedOf(invitation) - draft.ids.length;
    return (
      <div className="rsvp-card" data-testid="rsvp-review">
        {header}
        <h4 className="review-title" ref={reviewRef} tabIndex={-1}>
          Revisa tu respuesta
        </h4>
        <p className="summary-line">{summaryLine(invitation, draft)}</p>
        {names.length ? (
          <ul className="name-list" aria-label="Personas que asistirán">
            {names.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        ) : null}
        {unused > 0 ? <p className="muted small">Los lugares que no se usen no pueden transferirse a otras personas.</p> : null}

        {conflict ? (
          <div className="alert alert-error" role="alert" ref={alertRef} tabIndex={-1} data-testid="rsvp-conflict">
            <strong>Hay una respuesta más reciente</strong>
            Mientras revisabas, se guardó otra respuesta con este mismo enlace (desde otro dispositivo o en un intento anterior). Tu selección no se ha
            guardado.
            <span className="conflict-line">
              Respuesta vigente:{' '}
              {conflict.response
                ? `${summaryLine(conflict, { none: conflict.response.status === 'declined', ids: conflict.response.personIds })} ${namesOf(conflict, conflict.response.personIds).join(', ')}`
                : 'sin respuesta.'}
            </span>
            <span className="conflict-line">Tu selección: {`${summaryLine(invitation, draft)} ${names.join(', ')}`}</span>
          </div>
        ) : null}
        {error ? (
          <div className="alert alert-error" role="alert" id="rsvp-error" ref={alertRef} tabIndex={-1}>
            <strong>{error.uncertain ? 'No sabemos si se guardó tu respuesta' : 'Tu respuesta no se ha guardado'}</strong>
            {error.message} Tu selección sigue aquí.
          </div>
        ) : null}
        {notice ? (
          <div className="alert alert-info" role="status">
            {notice}
          </div>
        ) : null}

        {/* Sin "disabled": el foco no se pierde mientras se guarda; el doble envío lo evita inFlight. */}
        <button type="button" className="btn btn-primary btn-block" aria-disabled={saving} onClick={save}>
          {saving ? 'Guardando…' : conflict ? 'Guardar mi selección' : 'Confirmar y guardar'}
        </button>
        <div className="review-actions">
          {conflict ? (
            <button
              type="button"
              className="btn-link"
              onClick={() => {
                resetDraft(conflict);
                setEditing(!conflict.response);
                focusNext.current = conflict.response ? 'saved' : 'heading';
              }}
            >
              Conservar la respuesta vigente
            </button>
          ) : null}
          {!saving ? (
            <button
              type="button"
              className="btn-link"
              onClick={() => {
                setStep('select');
                focusNext.current = 'heading';
              }}
            >
              Cambiar selección
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <form className="rsvp-card" onSubmit={toReview} noValidate data-testid="rsvp-form">
      {header}
      {deadline ? <p className="muted">{deadline}</p> : null}
      {notice ? (
        <div className="alert alert-info" role="status">
          {notice}
        </div>
      ) : null}
      <fieldset aria-describedby={!canSelectAll ? 'rsvp-limit' : undefined}>
        <legend>{single ? 'Marca tu nombre si asistirás' : '¿Quiénes asistirán?'}</legend>
        <div className="choice-grid">
          {people.map((p) => {
            const checked = !draft.none && draft.ids.includes(p.id);
            return (
              <label className={`choice choice-check${!checked && atLimit ? ' is-off' : ''}`} key={p.id}>
                <input type="checkbox" checked={checked} disabled={!checked && atLimit} onChange={(e) => toggle(p.id, e.target.checked)} />
                {p.name}
              </label>
            );
          })}
        </div>
        {!single && canSelectAll ? (
          <button type="button" className="btn-link" onClick={() => touch(allSelected ? { none: false, ids: [] } : { none: false, ids: people.map((p) => p.id) })}>
            {allSelected ? 'Quitar la selección' : 'Seleccionar a todos'}
          </button>
        ) : null}
        {!canSelectAll ? (
          <p className="muted small" id="rsvp-limit" style={{ marginTop: 10 }}>
            Pueden confirmar a un máximo de {seats} de las {people.length} personas.
            {atLimit ? ' Ya marcaron todos los lugares reservados.' : ''}
          </p>
        ) : null}
        <div className="choice-grid choice-none-row">
          <label className="choice choice-check choice-none">
            <input type="checkbox" checked={draft.none} onChange={(e) => touch({ none: e.target.checked, ids: [] })} />
            {single ? 'No podré asistir' : 'Ninguno de nosotros podrá asistir'}
          </label>
        </div>
      </fieldset>
      {/* Región siempre presente: así los lectores de pantalla anuncian la pista cuando aparece. */}
      <p className="form-hint" role="status" aria-live="polite">
        {hint}
      </p>
      <button type="submit" className="btn btn-primary btn-block">
        Revisar respuesta
      </button>
      {invitation.response ? (
        <div style={{ textAlign: 'center', marginTop: 8 }}>
          <button
            type="button"
            className="btn-link"
            onClick={() => {
              resetDraft();
              setEditing(false);
              focusNext.current = 'saved';
            }}
          >
            Cancelar cambio
          </button>
        </div>
      ) : null}
    </form>
  );
}
