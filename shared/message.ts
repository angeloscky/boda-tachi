import { EVENT } from './event.js';

/** Plantilla del mensaje de invitación. Marcadores: {nombre}, {fecha}, {invitarte}, {tu}, {enlace}, {lugares}. */
export const INVITE_TEMPLATE = [
  'Hola, {nombre}:',
  '',
  'Con mucha ilusión queremos {invitarte} a nuestra boda el {fecha} en Zapopan, Jalisco.',
  '{lugares}',
  '',
  'Aquí está {tu} invitación y la confirmación de asistencia:',
  '{enlace}',
  '',
  'Con cariño,',
  'Sofía e Isaac',
].join('\n');

export function seatsLine(seats: number | null): string {
  if (!seats) return '';
  return seats === 1 ? 'Hemos reservado 1 lugar para ti.' : `Hemos reservado ${seats} lugares para ustedes.`;
}

export function buildInviteMessage(input: { name: string; seats: number | null; link: string }, template = INVITE_TEMPLATE): string {
  return template
    .replaceAll('{nombre}', input.name)
    .replaceAll('{fecha}', EVENT.dateLabel)
    .replaceAll('{invitarte}', input.seats === 1 ? 'invitarte' : 'invitarlos')
    .replaceAll('{tu}', input.seats === 1 ? 'tu' : 'su')
    .replaceAll('{enlace}', input.link)
    .replaceAll('{lugares}', seatsLine(input.seats))
    .replace(/\n{3,}/g, '\n\n');
}

export { normalizePhone } from './rsvp-rules.js';
