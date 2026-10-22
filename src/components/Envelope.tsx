import { useEffect, useRef, useState } from 'react';
import { LOGO } from '../lib/brand';

interface Props {
  guestName?: string | null;
  onOpen: () => void;
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Sobre de apertura. Es una capa sobre el contenido: la invitación ya está
 * renderizada debajo, así que si la animación falla basta con omitirla.
 */
export function Envelope({ guestName, onOpen }: Props) {
  const [open, setOpen] = useState(false);
  const [gone, setGone] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    buttonRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!open) return;
    const ms = prefersReducedMotion() ? 0 : 1700;
    const t = window.setTimeout(() => {
      setGone(true);
      onOpen();
    }, ms);
    return () => window.clearTimeout(t);
  }, [open, onOpen]);

  const skip = () => {
    setGone(true);
    onOpen();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setGone(true);
        onOpen();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onOpen]);

  if (gone) return null;

  return (
    <div className={`envelope-overlay${open ? ' is-open' : ''}`} role="dialog" aria-modal="true" aria-label="Apertura de la invitación">
      <p className="hint">Tienes una invitación</p>
      <button ref={buttonRef} type="button" className="envelope" onClick={() => setOpen(true)} aria-label="Abrir invitación">
        <span className="body" />
        <span className="letter" aria-hidden>
          {LOGO.available ? <img src={LOGO.monogramDark} alt="" /> : 'Sofía e Isaac'}
        </span>
        <span className="pocket" />
        <span className="flap" />
        <span className="seal" aria-hidden>
          {LOGO.available ? (
            <img src={LOGO.monogram} alt="" />
          ) : (
            <span className="initials">
              S<i>&amp;</i>I
            </span>
          )}
        </span>
      </button>
      {guestName ? <p className="for">Para {guestName}</p> : null}
      <p className="hint" aria-hidden>
        Toca el sello para abrir
      </p>
      <button type="button" className="btn-link" onClick={skip}>
        Ver la invitación sin animación
      </button>
    </div>
  );
}
