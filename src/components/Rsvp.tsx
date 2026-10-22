import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { PublicInvitation } from '../../shared/types';
import { ApiFailure, newRequestId, saveRsvp } from '../lib/api';
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
  if (d.none) return inv.people.length === 1 ? 'No podrá asistir.' : 'Nadie de esta invitación podrá asistir.';
  const n = d.ids.length;
  return `${n === 1 ? 'Asistirá 1 persona' : `Asistirán ${n} personas`} de ${lugares(inv.seats ?? 0)} reservados.`;
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
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [conflict, setConflict] = useState<PublicInvitation | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const requestId = useRef<string | null>(null);
  const inFlight = useRef(false);
  const reviewRef = useRef<HTMLHeadingElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const savedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (step === 'review' && !error && !conflict) reviewRef.current?.focus();
  }, [step, error, conflict]);
  useEffect(() => {
    if (error || conflict) alertRef.current?.focus();
  }, [error, conflict]);
  useEffect(() => {
    if (justSaved) savedRef.current?.focus();
  }, [justSaved]);

  const header = (
    <>
      <h3>{invitation.name}</h3>
      <p className="seats">
        {seats === 1 ? 'Hemos reservado 1 lugar para ti.' : seats ? `Hemos reservado ${seats} lugares para ustedes.` : null}
      </p>
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
    return (
      <div className="rsvp-card saved" ref={savedRef} tabIndex={-1} aria-live="polite" data-testid="rsvp-saved">
        <CheckCircleIcon className="check" />
        <h3>{justSaved ? '¡Gracias! Recibimos tu respuesta' : 'Tu respuesta está registrada'}</h3>
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
              }}
            >
              Cambiar mi respuesta
            </button>
          </div>
        ) : (
          <p style={{ marginTop: 16 }}>La confirmación ya está cerrada. Si necesitas un cambio, escríbenos.</p>
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
      } else {
        setError(err instanceof ApiFailure ? err.message : 'Ocurrió un error inesperado.');
      }
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  const deadline = deadlineText();

  if (step === 'review') {
    const names = draft.none ? [] : namesOf(invitation, draft.ids);
    const unused = draft.none ? seats : seats - draft.ids.length;
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
        {unused > 0 && !draft.none ? <p className="muted small">Los lugares que no se usen no pueden transferirse a otras personas.</p> : null}

        {conflict ? (
          <div className="alert alert-error" role="alert" ref={alertRef} tabIndex={-1} data-testid="rsvp-conflict">
            <strong>Esta invitación cambió desde otro dispositivo</strong>
            Mientras revisabas, alguien guardó otra respuesta con este mismo enlace. Tu selección no se ha guardado.
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
            <strong>Tu respuesta no se ha guardado</strong>
            {error} Tu selección sigue aquí.
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
              }}
            >
              Conservar la respuesta vigente
            </button>
          ) : null}
          {!saving ? (
            <button type="button" className="btn-link" onClick={() => setStep('select')}>
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
      <fieldset>
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
          <p className="muted small" style={{ marginTop: 10 }}>
            Pueden confirmar hasta {lugares(seats)} de las {people.length} personas de la lista.
          </p>
        ) : null}
      </fieldset>
      <div className="choice-grid" style={{ marginBottom: 22 }}>
        <label className="choice choice-check choice-none">
          <input type="checkbox" checked={draft.none} onChange={(e) => touch({ none: e.target.checked, ids: [] })} />
          {single ? 'No podré asistir' : 'Ninguno de nosotros podrá asistir'}
        </label>
      </div>
      {hint ? (
        <p className="form-hint" role="status">
          {hint}
        </p>
      ) : null}
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
            }}
          >
            Cancelar cambio
          </button>
        </div>
      ) : null}
    </form>
  );
}
