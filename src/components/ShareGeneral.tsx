import { useState } from 'react';
import { EVENT } from '../../shared/event';
import { copyText } from '../lib/clipboard';
import { generalUrl } from '../lib/mode';
import { ShareIcon } from './Icons';

/**
 * Comparte SOLO la invitación general, también desde un enlace personal:
 * la URL sale de la configuración del servidor, nunca de la dirección actual.
 */
export function ShareGeneral({ personal }: { personal: boolean }) {
  const [status, setStatus] = useState('');
  async function share() {
    const url = generalUrl();
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: EVENT.share.title, text: EVENT.share.description, url });
        setStatus('');
        return;
      } catch (e) {
        if ((e as DOMException)?.name === 'AbortError') return; // la persona cerró el menú de compartir
      }
    }
    setStatus((await copyText(url)) ? `Copiamos el enlace general: ${url}` : `Copia este enlace: ${url}`);
  }
  return (
    <div className="share-general">
      <button type="button" className="btn" onClick={share} data-testid="share-general">
        <ShareIcon /> Compartir invitación general
      </button>
      {personal ? (
        <p className="muted small">
          Comparte solo la invitación general. Tu enlace personal es para tu invitación: quien lo tenga puede consultar y cambiar su respuesta.
        </p>
      ) : null}
      <p className="muted small" role="status" aria-live="polite">
        {status}
      </p>
    </div>
  );
}
