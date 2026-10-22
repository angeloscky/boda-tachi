/**
 * Información pública del evento. Única fuente de verdad para la invitación,
 * los metadatos para compartir y el texto de los mensajes.
 *
 * Aquí NO van teléfonos, familias invitadas, respuestas ni secretos.
 * Los campos opcionales en `null` ocultan su sección hasta tener contenido real.
 */

export interface Place {
  name: string;
  area: string;
  address?: string;
  time: string; // HH:MM, 24 h, America/Mexico_City
  timeLabel: string;
  mapsUrl: string;
  note?: string;
}

export interface EventConfig {
  coverNames: string;
  couple: { bride: string; groom: string };
  /** Nombres completos tal como fueron registrados. No se muestran; quedan para el cotejo editorial final. */
  editorialFullNames: { bride: string; groom: string; reviewNote: string };
  dateISO: string; // fecha de la ceremonia
  dateLabel: string;
  timeZone: string;
  invitationPhrase: string;
  groomParents: { name: string; deceased?: boolean }[];
  brideParents: { name: string; deceased?: boolean }[];
  sponsors: { title: string; names: string[] };
  ceremony: Place;
  reception: Place;
  dressCode: { title: string; text: string };
  adultsOnly: { title: string; text: string };
  gifts: {
    liverpool: { eventNumber: string; url: string } | null;
    amazon: { url: string } | null;
    transfer: { bank: string; holder: string; clabe: string; account?: string } | null;
  };
  music: { title: string; url?: string } | null;
  rsvpDeadline: string | null; // YYYY-MM-DD cuando exista
  share: { title: string; description: string };
}

export const EVENT: EventConfig = {
  coverNames: 'Sofía e Isaac',
  couple: { bride: 'Sofía', groom: 'Isaac' },
  editorialFullNames: {
    groom: 'Isaac Yael Vazquez Gonzalez',
    bride: 'Sofía Lisette García Aguilar',
    reviewNote:
      'Nombre de la novia confirmado por Angel el 2026-10-21 (Sofía Lisette García Aguilar; antes registrado como "Sofia Lizeth Garcia Aguilar"). Pendiente confirmar la acentuación del nombre del novio.',
  },
  dateISO: '2027-05-22',
  dateLabel: '22 de mayo de 2027',
  timeZone: 'America/Mexico_City',
  invitationPhrase: 'Queremos compartir este día contigo.',
  groomParents: [
    { name: 'Bibiano Vázquez Mora', deceased: true },
    { name: 'María Jesús González Hernández' },
  ],
  brideParents: [{ name: 'Elena Aguilar Cervantes' }, { name: 'Carlos Patzka Aguirre' }],
  sponsors: {
    title: 'Padrinos de velación',
    names: ['Gerardo Vázquez Mora', 'Alma Idalia Villalobos González'],
  },
  ceremony: {
    name: 'Templo de Nuestra Señora del Perpetuo Socorro',
    area: 'La Cima, Zapopan, Jalisco',
    time: '19:00',
    timeLabel: '7:00 p. m.',
    mapsUrl: 'https://maps.app.goo.gl/v6wqtCa2jvmqhKu56',
  },
  reception: {
    name: 'Quinta de Torres',
    area: 'Zapopan, Jalisco',
    address: 'Av. Aviación 270, Zapopan, Jalisco',
    time: '20:30',
    timeLabel: '8:30 p. m.',
    mapsUrl: 'https://www.google.com/maps/?cid=10313593131170748878',
    // Confirmado por Angel (2026-10-21): en el salón, no en la terraza. Acceso exacto pendiente.
    note: 'La recepción será en el salón (no en la terraza).',
  },
  dressCode: {
    title: 'All black',
    text: 'Te invitamos a vestir completamente de negro.',
  },
  adultsOnly: {
    title: 'Celebración solo para adultos',
    text: 'Con mucho cariño, esta celebración será solo para adultos. Gracias por ayudarnos a que así sea.',
  },
  gifts: {
    liverpool: {
      eventNumber: '60031248',
      url: 'https://mesaderegalos.liverpool.com.mx/milistaderegalos/60031248',
    },
    amazon: null, // pendiente
    transfer: null, // pendiente
  },
  music: null, // pendiente
  rsvpDeadline: null, // pendiente
  share: {
    title: 'Sofía e Isaac · 22 de mayo de 2027',
    description: 'Queremos compartir este día contigo. Zapopan, Jalisco.',
  },
};

/** Inicio de la ceremonia con desfase fijo de CDMX (UTC−6, sin horario de verano desde 2022). */
export const CEREMONY_START = `${EVENT.dateISO}T${EVENT.ceremony.time}:00-06:00`;
