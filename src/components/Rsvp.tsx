import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { PublicInvitation } from '../../shared/types';
import { ApiFailure, saveRsvp } from '../lib/api';
import { EVENT } from '../../shared/event';
import { CheckCircleIcon } from './Icons';

interface Props {
  token: string | null;
  invitation: PublicInvitation | null;
  loadError: ApiFailure | null;
  loading: boolean;
  onSaved: (inv: PublicInvitation) => void;
  onRetryLoad: () => void;
  /** Maqueta estática: el formulario se ve, pero no guarda y lo dice. */
  staticDemo?: boolean;
}

const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat('es-MX', { dateStyle: 'long', timeStyle: 'short', timeZone: EVENT.timeZone })
    .format(new Date(iso))
    .replace(/\s*([ap])\.\s*m\./g, ' $1. m.');

const deadlineText = () =>
  EVENT.rsvpDeadline
    ? `Por favor confírmanos antes del ${new Intl.DateTimeFormat('es-MX', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(EVENT.rsvpDeadline))}.`
    : null;

export function Rsvp({ token, invitation, loadError, loading, onSaved, onRetryLoad, staticDemo }: Props) {
  if (!token) {
    return (
      <div className="rsvp-card">
        <h3>Confirma con tu enlace personal</h3>
        <p className="muted" style={{ margin: 0 }}>
          Cada invitación tiene un enlace propio para confirmar asistencia. Si no lo tienes a la mano, escríbenos y con gusto te lo compartimos.
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
  return <RsvpForm token={token} invitation={invitation} onSaved={onSaved} staticDemo={staticDemo} />;
}

function RsvpForm({
  token,
  invitation,
  onSaved,
  staticDemo,
}: {
  token: string;
  invitation: PublicInvitation;
  onSaved: (inv: PublicInvitation) => void;
  staticDemo?: boolean;
}) {
  const seats = invitation.seats ?? 0;
  const plural = seats !== 1;
  const [editing, setEditing] = useState(!invitation.response);
  const [status, setStatus] = useState<'attending' | 'declined' | null>(invitation.response?.status ?? null);
  const [adults, setAdults] = useState<number>(
    invitation.response?.status === 'attending' ? invitation.response.adults : seats === 1 ? 1 : 0,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const inFlight = useRef(false);
  const resultRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  /** Vuelve a la respuesta guardada (al entrar o cancelar la edición). */
  const resetToSaved = () => {
    const r = invitation.response;
    setStatus(r?.status ?? null);
    setAdults(r?.status === 'attending' ? r.adults : seats === 1 ? 1 : 0);
    setError(null);
    setHint(null);
  };

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  useEffect(() => {
    if (justSaved) resultRef.current?.focus();
  }, [justSaved]);

  const header = (
    <>
      <h3>{invitation.name}</h3>
      <p className="seats">
        {invitation.seats
          ? invitation.seats === 1
            ? 'Hemos reservado 1 lugar para ti.'
            : `Hemos reservado ${invitation.seats} lugares para ustedes.`
          : null}
      </p>
    </>
  );

  if (!invitation.canRespond && !invitation.response) {
    const msg =
      invitation.closedReason === 'seats_unassigned'
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

  if (!editing && invitation.response) {
    const r = invitation.response;
    return (
      <div className="rsvp-card saved" ref={resultRef} tabIndex={-1} aria-live="polite" data-testid="rsvp-saved">
        <CheckCircleIcon className="check" />
        <h3>{justSaved ? '¡Gracias! Recibimos tu respuesta' : 'Tu respuesta está registrada'}</h3>
        <p className="summary">
          {r.status === 'attending'
            ? `Asistirá${r.adults === 1 ? '' : 'n'} ${r.adults} ${r.adults === 1 ? 'adulto' : 'adultos'}`
            : plural
              ? 'Nos avisaron que no podrán asistir'
              : 'Nos avisaste que no podrás asistir'}
        </p>
        <p>Última actualización: {fmtDate(r.updatedAt)}</p>
        {invitation.canRespond ? (
          <div className="btn-row">
            <button
              type="button"
              className="btn"
              onClick={() => {
                setJustSaved(false);
                resetToSaved();
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

  const valid = status === 'declined' || (status === 'attending' && adults >= 1 && adults <= seats);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    if (!status) {
      setHint('Elige si asistirás.');
      return;
    }
    if (!valid) {
      setHint('Elige cuántos adultos asistirán.');
      return;
    }
    setHint(null);
    if (staticDemo) {
      setError('Esta es una vista de diseño sin servidor: la respuesta no se guardó. En la versión con servidor se registra al instante.');
      return;
    }
    inFlight.current = true;
    setSaving(true);
    setError(null);
    try {
      const saved = await saveRsvp(token, { status, adults: status === 'declined' ? 0 : adults });
      setJustSaved(true);
      setEditing(false);
      onSaved(saved);
    } catch (err) {
      const msg = err instanceof ApiFailure ? err.message : 'Ocurrió un error inesperado.';
      setError(msg);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  const deadline = deadlineText();

  return (
    <form className="rsvp-card" onSubmit={submit} noValidate aria-describedby={error ? 'rsvp-error' : undefined}>
      {header}
      {deadline ? <p className="muted">{deadline}</p> : null}
      {error ? (
        <div className="alert alert-error" role="alert" id="rsvp-error" ref={errorRef} tabIndex={-1}>
          <strong>Tu respuesta no se ha guardado</strong>
          {error} Tu selección sigue aquí.
        </div>
      ) : null}
      <fieldset>
        <legend>¿Nos acompañas?</legend>
        <div className="choice-grid">
          <label className="choice">
            <input
              type="radio"
              name="status"
              value="attending"
              checked={status === 'attending'}
              onChange={() => {
                setStatus('attending');
                setHint(null);
                if (adults < 1) setAdults(seats === 1 ? 1 : 0);
              }}
            />
            {plural ? 'Sí, asistiremos' : 'Sí, asistiré'}
          </label>
          <label className="choice">
            <input
              type="radio"
              name="status"
              value="declined"
              checked={status === 'declined'}
              onChange={() => {
                setStatus('declined');
                setHint(null);
              }}
            />
            {plural ? 'No podremos asistir' : 'No podré asistir'}
          </label>
        </div>
      </fieldset>

      {status === 'attending' ? (
        <fieldset>
          <legend>¿Cuántos adultos asistirán?</legend>
          <div className="count-grid">
            {Array.from({ length: seats }, (_, i) => i + 1).map((n) => (
              <label className="choice" key={n}>
                <input type="radio" name="adults" value={n} checked={adults === n} onChange={() => {
                    setAdults(n);
                    setHint(null);
                  }}
                  aria-label={`${n} ${n === 1 ? 'adulto' : 'adultos'}`} />
                {n}
              </label>
            ))}
          </div>
          <p className="muted" style={{ fontSize: 14, margin: '10px 0 0' }}>
            Máximo {seats} {seats === 1 ? 'lugar' : 'lugares'}. Celebración solo para adultos.
          </p>
        </fieldset>
      ) : null}

      {hint ? (
        <p className="form-hint" role="status">
          {hint}
        </p>
      ) : null}
      {/* Sin "disabled": así el foco no se pierde mientras se guarda; el envío doble lo evita inFlight. */}
      <button type="submit" className="btn btn-primary btn-block" aria-disabled={saving || !valid}>
        {saving ? 'Guardando…' : invitation.response ? 'Actualizar mi respuesta' : 'Enviar confirmación'}
      </button>
      {invitation.response && !saving ? (
        <div style={{ textAlign: 'center', marginTop: 8 }}>
          <button
            type="button"
            className="btn-link"
            onClick={() => {
              resetToSaved();
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
