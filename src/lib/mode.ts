/** Estado de la confirmación que el servidor declara en el HTML (meta bt-rsvp-mode). */
export type UiMode = 'demo' | 'live' | 'disabled' | 'static';

export const STATIC_DEMO = import.meta.env.VITE_STATIC_DEMO === '1';

const meta = (name: string) => document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content ?? '';

export function uiMode(): UiMode {
  if (STATIC_DEMO) return 'static';
  const m = meta('bt-rsvp-mode');
  return m === 'demo' || m === 'live' ? m : 'disabled';
}

/**
 * URL de la invitación general. Se toma de la configuración del servidor o del origen,
 * nunca de la dirección actual: así, compartir desde un enlace personal no reenvía el token.
 */
export function generalUrl(): string {
  if (STATIC_DEMO) return location.origin + location.pathname;
  const configured = meta('bt-general-url');
  if (/^https?:\/\/\S+$/.test(configured) && !configured.includes('/i/')) return configured.endsWith('/') ? configured : `${configured}/`;
  return `${location.origin}/`;
}
