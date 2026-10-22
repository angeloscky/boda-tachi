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

/**
 * Lugares que la familia puede usar: el cupo, sin pasar del número de personas autorizadas activas.
 * Singular o plural según las personas de la invitación (no según el cupo).
 */
export function seatsLine(seats: number | null, people?: number): string {
  if (!seats) return '';
  const reserved = people === undefined ? seats : Math.min(seats, people);
  if (reserved < 1) return '';
  const forYou = (people ?? seats) === 1 ? 'para ti' : 'para ustedes';
  return reserved === 1 ? `Hemos reservado 1 lugar ${forYou}.` : `Hemos reservado ${reserved} lugares ${forYou}.`;
}

export function buildInviteMessage(input: { name: string; seats: number | null; people?: number; link: string }, template = INVITE_TEMPLATE): string {
  const single = (input.people ?? input.seats) === 1;
  return template
    .replaceAll('{nombre}', input.name)
    .replaceAll('{fecha}', EVENT.dateLabel)
    .replaceAll('{invitarte}', single ? 'invitarte' : 'invitarlos')
    .replaceAll('{tu}', single ? 'tu' : 'su')
    .replaceAll('{enlace}', input.link)
    .replaceAll('{lugares}', seatsLine(input.seats, input.people))
    .replace(/\n{3,}/g, '\n\n');
}

export { normalizePhone } from './rsvp-rules.js';
