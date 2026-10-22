import { EVENT } from '../../shared/event';

/** Archivo .ics con la ceremonia y la recepción (horas en UTC: CDMX es UTC−6). */
export function buildIcs(): string {
  const d = EVENT.dateISO.replaceAll('-', '');
  const toUtc = (hhmm: string, addMin = 0) => {
    const [h, m] = hhmm.split(':').map(Number);
    const total = h * 60 + m + addMin + 6 * 60;
    const day = Number(d.slice(6)) + Math.floor(total / 1440);
    const mins = total % 1440;
    return `${d.slice(0, 6)}${String(day).padStart(2, '0')}T${String(Math.floor(mins / 60)).padStart(2, '0')}${String(mins % 60).padStart(2, '0')}00Z`;
  };
  const esc = (s: string) => s.replace(/[,;\\]/g, (c) => '\\' + c);
  const ev = (uid: string, title: string, start: string, end: string, loc: string, url: string) =>
    [
      'BEGIN:VEVENT',
      `UID:${uid}@boda-sofia-isaac`,
      `DTSTAMP:${toUtc('00:00')}`,
      `DTSTART:${start}`,
      `DTEND:${end}`,
      `SUMMARY:${esc(title)}`,
      `LOCATION:${esc(loc)}`,
      `URL:${url}`,
      'END:VEVENT',
    ].join('\r\n');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Boda Sofia e Isaac//ES',
    ev('ceremonia', `Boda ${EVENT.coverNames} · Ceremonia`, toUtc(EVENT.ceremony.time), toUtc(EVENT.ceremony.time, 75), `${EVENT.ceremony.name}, ${EVENT.ceremony.area}`, EVENT.ceremony.mapsUrl),
    ev('recepcion', `Boda ${EVENT.coverNames} · Recepción`, toUtc(EVENT.reception.time), toUtc(EVENT.reception.time, 330), `${EVENT.reception.name}, ${EVENT.reception.address}`, EVENT.reception.mapsUrl),
    'END:VCALENDAR',
  ].join('\r\n');
}
