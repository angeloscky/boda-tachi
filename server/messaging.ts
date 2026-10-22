/**
 * Interfaz de proveedor de mensajes. Hoy solo existe el proveedor de simulación,
 * que prepara el mensaje y lo registra como "preparado" sin enviar nada.
 *
 * Para conectar un canal real (por ejemplo WhatsApp Business Platform / Cloud API)
 * se implementa otro proveedor con la misma interfaz. Ese proveedor es el único
 * que puede registrar "enviado" y, por webhook, "entregado". Ver README, "WhatsApp".
 */

export interface OutboundMessage {
  invitationId: number;
  to: string | null; // dígitos E.164 sin "+"
  recipientName: string;
  text: string;
  link: string;
}

export interface ProviderResult {
  status: 'prepared' | 'sent' | 'failed';
  providerRef?: string;
  note?: string;
}

export interface MessagingProvider {
  id: string;
  label: string;
  /** false: nunca contacta a nadie. */
  sendsRealMessages: boolean;
  deliver(message: OutboundMessage): Promise<ProviderResult>;
}

export const simulationProvider: MessagingProvider = {
  id: 'simulation',
  label: 'Preparación (simulación, sin envíos)',
  sendsRealMessages: false,
  async deliver() {
    return { status: 'prepared', note: 'Simulación: el mensaje quedó preparado; no se envió nada.' };
  },
};

export function getProvider(id: string): MessagingProvider {
  if (id === 'simulation') return simulationProvider;
  throw new Error(`Proveedor de mensajes desconocido: "${id}". Por ahora solo existe "simulation".`);
}

/** Enlace wa.me para abrir WhatsApp con el texto. Abrirlo NO equivale a enviarlo. */
export function waMeUrl(phone: string | null, text: string): string {
  const base = phone ? `https://wa.me/${phone}` : 'https://wa.me/';
  return `${base}?text=${encodeURIComponent(text)}`;
}
