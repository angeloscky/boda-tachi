import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { EVENT, CEREMONY_START, type Place } from '../../shared/event';
import type { PublicInvitation } from '../../shared/types';
import { ApiFailure, fetchInvitation } from '../lib/api';
import { LOGO } from '../lib/brand';
import { buildIcs } from '../../shared/ics';
import { Envelope } from '../components/Envelope';
import { NonTransferableNote, Rsvp } from '../components/Rsvp';
import { ShareGeneral } from '../components/ShareGeneral';
import { uiMode } from '../lib/mode';
import {
  CalendarIcon,
  CheckIcon,
  ChevronDown,
  DressIcon,
  ExternalIcon,
  GiftIcon,
  GlassesIcon,
  OliveBranch,
  PinIcon,
} from '../components/Icons';

interface Props {
  token: string | null;
  staticDemo?: boolean;
}

/** Familia FICTICIA para la vista estática (sin servidor). */
const DEMO_INVITATION: PublicInvitation = {
  name: 'Familia Ejemplo Robles',
  seats: 4,
  people: [
    { id: 'DEMO-001-P1', name: 'Ana Robles Ejemplo' },
    { id: 'DEMO-001-P2', name: 'Luis Robles Ejemplo' },
    { id: 'DEMO-001-P3', name: 'Sara Robles Ejemplo' },
    { id: 'DEMO-001-P4', name: 'Tomás Robles Ejemplo' },
  ],
  revision: 0,
  canRespond: true,
  closedReason: null,
  response: null,
  mode: 'demo',
};

const BANNER: Partial<Record<ReturnType<typeof uiMode>, string>> = {
  static: 'Vista de diseño sin servidor con una familia ficticia: puedes recorrer el formulario, pero ninguna respuesta se registra.',
  demo: 'Demostración local con familias ficticias: las respuestas que guardes aquí son de prueba.',
};

const OPENED_KEY = 'boda-sobre-abierto';

function useCountdown(target: string) {
  const end = useMemo(() => new Date(target).getTime(), [target]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  const diff = Math.max(0, end - now);
  return {
    done: diff === 0,
    days: Math.floor(diff / 86_400_000),
    hours: Math.floor((diff / 3_600_000) % 24),
    minutes: Math.floor((diff / 60_000) % 60),
  };
}

function useReveal() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll('.reveal'));
    if (!('IntersectionObserver' in window)) {
      els.forEach((el) => el.classList.add('in'));
      return;
    }
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
        }),
      { rootMargin: '0px 0px -8% 0px' },
    );
    els.forEach((el) => io.observe(el));
    // Si algo falla, el contenido nunca queda oculto.
    const t = window.setTimeout(() => els.forEach((el) => el.classList.add('in')), 2500);
    return () => {
      io.disconnect();
      window.clearTimeout(t);
    };
  }, []);
}

const ext = { target: '_blank', rel: 'noopener noreferrer' } as const;

function PlaceCard({ id, kind, place }: { id: string; kind: string; place: Place }) {
  return (
    <article className="place" id={id} aria-labelledby={`${id}-name`}>
      <div className="place-head">
        <p className="kind">{kind}</p>
        <time dateTime={`${EVENT.dateISO}T${place.time}-06:00`}>{place.timeLabel}</time>
      </div>
      <h3 id={`${id}-name`}>{place.name}</h3>
      {place.address ? <p>{place.address}</p> : <p>{place.area}</p>}
      {place.note ? <p>{place.note}</p> : null}
      <div className="actions">
        <a className="btn btn-block" href={place.mapsUrl} {...ext} data-testid={`maps-${id}`}>
          <PinIcon /> Cómo llegar
          <span className="sr-only"> a {place.name} (abre Google Maps)</span>
        </a>
      </div>
    </article>
  );
}

export default function InvitationPage({ token, staticDemo }: Props) {
  const mode = uiMode();
  const [envelopeDone, setEnvelopeDone] = useState(() => {
    try {
      return sessionStorage.getItem(OPENED_KEY) === '1' || location.hash.length > 1;
    } catch {
      return false;
    }
  });
  const [invitation, setInvitation] = useState<PublicInvitation | null>(staticDemo && token ? DEMO_INVITATION : null);
  const [loadError, setLoadError] = useState<ApiFailure | null>(null);
  const [loading, setLoading] = useState(Boolean(token) && !staticDemo);
  const mainRef = useRef<HTMLElement>(null);
  const focusMainAfterOpen = useRef(false);
  const confirmTitleRef = useRef<HTMLHeadingElement>(null);
  const countdown = useCountdown(CEREMONY_START);
  useReveal();

  const load = useCallback(async () => {
    if (!token || staticDemo) return;
    setLoading(true);
    setLoadError(null);
    try {
      setInvitation(await fetchInvitation(token));
    } catch (e) {
      setLoadError(e instanceof ApiFailure ? e : new ApiFailure('unknown', 'Error inesperado', 0));
    } finally {
      setLoading(false);
    }
  }, [token, staticDemo]);
  // El botón "Reintentar" desaparece al recargar: el foco pasa al título de la sección, que sigue ahí.
  const retryLoad = useCallback(() => {
    confirmTitleRef.current?.focus({ preventScroll: true });
    void load();
  }, [load]);

  useEffect(() => {
    void load();
  }, [load]);

  const onEnvelopeOpen = useCallback(() => {
    setEnvelopeDone(true);
    try {
      sessionStorage.setItem(OPENED_KEY, '1');
    } catch {
      /* almacenamiento no disponible */
    }
    window.scrollTo({ top: 0 });
    focusMainAfterOpen.current = true;
  }, []);

  // Al quitar el sobre, el foco pasa al contenido en el mismo render (sin esperar un cuadro),
  // para que la siguiente tecla Tab llegue al enlace "Ir a confirmar asistencia".
  useLayoutEffect(() => {
    if (!envelopeDone || !focusMainAfterOpen.current) return;
    focusMainAfterOpen.current = false;
    const active = document.activeElement;
    if (!active || active === document.body) mainRef.current?.focus({ preventScroll: true });
  }, [envelopeDone]);

  // Con servidor, un archivo .ics real; en la vista estática, el mismo contenido en línea.
  const icsHref = useMemo(() => (staticDemo ? `data:text/calendar;charset=utf-8,${encodeURIComponent(buildIcs())}` : '/calendario.ics'), [staticDemo]);

  // La barra inferior se oculta mientras la confirmación está en pantalla, para no tapar sus botones.
  const [navHidden, setNavHidden] = useState(false);
  useEffect(() => {
    if (!envelopeDone || typeof IntersectionObserver === 'undefined') return;
    const target = document.getElementById('confirmar');
    if (!target) return;
    const io = new IntersectionObserver(([entry]) => setNavHidden(entry.isIntersecting), { rootMargin: '0px 0px -15% 0px' });
    io.observe(target);
    return () => io.disconnect();
  }, [envelopeDone]);
  const gifts = EVENT.gifts;

  return (
    <div className="page">
      {BANNER[mode] ? (
        <div className="demo-banner" role="note" data-testid="mode-banner">
          {BANNER[mode]}
        </div>
      ) : null}
      {!envelopeDone ? <Envelope guestName={invitation?.name} onOpen={onEnvelopeOpen} /> : null}

      {/* inert: mientras el sobre está abierto, el contenido de atrás no recibe foco ni lectura. */}
      <main ref={mainRef} tabIndex={-1} inert={!envelopeDone} style={{ outline: 'none' }}>
        <a className="skip-link" href="#confirmar">
          Ir a confirmar asistencia
        </a>
        {/* 1 · Portada */}
        <header className="hero">
          <h1 className="logo-frame" style={{ margin: 0 }}>
            <img src={LOGO.onDark} alt={LOGO.alt} width={383} height={617} />
          </h1>
          {invitation ? (
            <p className="guest">
              Invitación para
              <strong>{invitation.name}</strong>
            </p>
          ) : null}
          {loadError?.status === 404 ? (
            <p className="not-found-note" role="note">
              No encontramos esta invitación personal. Revisa que el enlace esté completo o pídenos que te lo compartamos de nuevo.
            </p>
          ) : loadError && loadError.code !== 'rsvp_not_enabled' ? (
            <p className="not-found-note" role="note">
              No pudimos cargar tu invitación personal. Puedes ver los detalles de la boda; en la sección de confirmación puedes intentarlo de nuevo.
            </p>
          ) : null}
          <a className="scroll-cue" href="#invitacion">
            Descubre los detalles
            <ChevronDown />
          </a>
        </header>

        {/* 2 · Invitación */}
        <section className="section reveal" id="invitacion" aria-labelledby="t-invitacion">
          <OliveBranch />
          <h2 id="t-invitacion" className="sr-only">
            Invitación
          </h2>
          <p className="lead">{EVENT.invitationPhrase}</p>
          <p className="muted" style={{ marginTop: 22 }}>
            Te esperamos el <strong style={{ fontWeight: 500, color: 'var(--ivory)' }}>sábado {EVENT.dateLabel}</strong> en Zapopan, Jalisco.
          </p>
          {!countdown.done ? (
            <div className="countdown" role="timer" aria-label={`Faltan ${countdown.days} días`}>
              <div>
                <b>{countdown.days}</b>
                <small>días</small>
              </div>
              <div>
                <b>{countdown.hours}</b>
                <small>horas</small>
              </div>
              <div>
                <b>{countdown.minutes}</b>
                <small>min</small>
              </div>
            </div>
          ) : null}
        </section>

        {/* 3 · Padres y padrinos */}
        <section className="section reveal" id="familias" aria-labelledby="t-familias">
          <p className="eyebrow">Con la bendición de Dios y de nuestros padres</p>
          <h2 id="t-familias" className="title">
            Nuestras familias
          </h2>
          <div className="families">
            <div className="family">
              <h3>Padres de la novia</h3>
              {EVENT.brideParents.map((p) => (
                <p key={p.name}>{p.name}</p>
              ))}
            </div>
            <div className="family">
              <h3>Padres del novio</h3>
              {EVENT.groomParents.map((p) => (
                <p key={p.name}>
                  {p.name}
                  {p.deceased ? (
                    <>
                      {' '}
                      <span aria-hidden>†</span>
                      <span className="sr-only"> (en memoria)</span>
                    </>
                  ) : null}
                </p>
              ))}
            </div>
            <div className="family wide">
              <h3>{EVENT.sponsors.title}</h3>
              {EVENT.sponsors.names.map((n) => (
                <p key={n}>{n}</p>
              ))}
            </div>
          </div>
        </section>

        {/* 4 y 5 · Ceremonia y recepción */}
        <section className="section reveal" id="ubicaciones" aria-labelledby="t-ubicaciones">
          <p className="eyebrow">{EVENT.dateLabel}</p>
          <h2 id="t-ubicaciones" className="title">
            Dónde y cuándo
          </h2>
          <div className="agenda">
            <PlaceCard id="ceremonia" kind="Ceremonia" place={EVENT.ceremony} />
            <PlaceCard id="recepcion" kind="Recepción" place={EVENT.reception} />
          </div>
          <div className="btn-row">
            <a className="btn" href={icsHref} download="boda-sofia-isaac.ics">
              <CalendarIcon /> Agregar al calendario
            </a>
          </div>
        </section>

        {/* 6 · Vestimenta y adultos */}
        <section className="section reveal" id="vestimenta" aria-labelledby="t-vestimenta">
          <p className="eyebrow">Para tomar en cuenta</p>
          <h2 id="t-vestimenta" className="title">
            Detalles del día
          </h2>
          <div className="notes">
            <div className="note-card">
              <DressIcon className="icon" />
              <p className="eyebrow" style={{ margin: '12px 0 0' }}>
                Código de vestimenta
              </p>
              <h3 style={{ marginTop: 4 }}>{EVENT.dressCode.title}</h3>
              <p>{EVENT.dressCode.text}</p>
              <div className="swatches" aria-hidden>
                <span />
                <span />
                <span />
              </div>
            </div>
            <div className="note-card">
              <GlassesIcon className="icon" />
              <h3>{EVENT.adultsOnly.title}</h3>
              <p>{EVENT.adultsOnly.text}</p>
            </div>
          </div>
        </section>

        {/* 7 · Regalos */}
        <section className="section reveal" id="regalos" aria-labelledby="t-regalos">
          <p className="eyebrow">Mesa de regalos</p>
          <h2 id="t-regalos" className="title">
            Tu presencia es nuestro mejor regalo
          </h2>
          <p className="muted">Si deseas tener un detalle con nosotros, te compartimos nuestra mesa de regalos.</p>
          {gifts.liverpool ? (
            <div className="gift">
              <h3>Liverpool</h3>
              <p className="event-number">
                Número de evento <b>{gifts.liverpool.eventNumber}</b>
              </p>
              <a className="btn btn-primary" href={gifts.liverpool.url} {...ext} data-testid="gift-liverpool">
                <GiftIcon /> Ver mesa de regalos <ExternalIcon />
                <span className="sr-only"> (abre Liverpool)</span>
              </a>
            </div>
          ) : null}
          {gifts.amazon ? (
            <div className="gift">
              <h3>Amazon</h3>
              <a className="btn" href={gifts.amazon.url} {...ext}>
                <GiftIcon /> Ver lista en Amazon <ExternalIcon />
              </a>
            </div>
          ) : null}
          {gifts.transfer ? (
            <div className="gift">
              <h3>Transferencia</h3>
              <p className="event-number">
                {gifts.transfer.bank} · {gifts.transfer.holder}
                <br />
                CLABE <b>{gifts.transfer.clabe}</b>
              </p>
            </div>
          ) : null}
        </section>

        {EVENT.music ? (
          <section className="section reveal" id="musica" aria-labelledby="t-musica">
            <p className="eyebrow">Música</p>
            <h2 id="t-musica" className="title">
              {EVENT.music.title}
            </h2>
            {EVENT.music.url ? (
              <a className="btn" href={EVENT.music.url} {...ext}>
                Escuchar
              </a>
            ) : null}
          </section>
        ) : null}

        {/* 8 · Confirmación */}
        <section className="section" id="confirmar" aria-labelledby="t-confirmar">
          <p className="eyebrow">Confirmación de asistencia</p>
          <h2 id="t-confirmar" className="title" ref={confirmTitleRef} tabIndex={-1}>
            ¿Nos acompañas?
          </h2>
          {invitation ? <NonTransferableNote /> : null}
          <Rsvp token={token} invitation={invitation} loadError={loadError} loading={loading} onChanged={setInvitation} onRetryLoad={retryLoad} mode={mode} />
        </section>

        <section className="section" id="compartir" aria-labelledby="t-compartir">
          <h2 id="t-compartir" className="sr-only">
            Compartir
          </h2>
          <ShareGeneral personal={Boolean(invitation)} />
        </section>

        <footer className="footer">
          Sofía e Isaac
          <small>22 · 05 · 2027</small>
        </footer>
      </main>

      {envelopeDone ? (
        <nav className={`bottom-nav${navHidden ? ' is-hidden' : ''}`} aria-label="Accesos rápidos">
          <a href="#ubicaciones">
            <PinIcon />
            Ubicaciones
          </a>
          <a href="#regalos">
            <GiftIcon />
            Regalos
          </a>
          <a href="#confirmar" className="primary">
            <CheckIcon />
            Confirmar
          </a>
        </nav>
      ) : null}
    </div>
  );
}
