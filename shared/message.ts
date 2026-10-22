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

/** Normaliza un teléfono a dígitos E.164 sin "+". Asume México (52) si son 10 dígitos. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = raw.replace(/\D/g, '');
  if (!d) return null;
  if (d.length === 10) d = '52' + d;
  else if (d.length === 13 && d.startsWith('521')) d = '52' + d.slice(3); // formato antiguo de móvil
  if (d.length < 11 || d.length > 15) return null;
  return d;
}
