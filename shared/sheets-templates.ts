/**
 * Ejemplos FICTICIOS para las plantillas de las pestañas (google-sheets/plantillas/*.csv)
 * y para las plantillas que descarga el panel local. Ningún dato corresponde a invitados reales.
 */
import { INVITATIONS_TAB, PEOPLE_TAB, RESPONSES_TAB, headersOf } from './sheets-schema.js';

type Row = Record<string, string>;

export const TEMPLATE_INVITATIONS: Row[] = [
  { id: 'INV-001', side: 'novia', group: 'Familia Ejemplo Robles', contact: 'Ana Robles Ejemplo', phone: '3300000001', seats: '4', active: 'sí', token: '', link: '', notes: 'Ejemplo ficticio: borra esta fila' },
  { id: 'INV-002', side: 'novio', group: 'Familia Ficticia Prado', contact: 'Julián Prado Ficticio', phone: '', seats: '2', active: 'sí', token: '', link: '', notes: 'Ejemplo ficticio' },
  { id: 'INV-003', side: 'ambos', group: 'Marina Luna Prueba', contact: 'Marina Luna Prueba', phone: '', seats: '1', active: 'sí', token: '', link: '', notes: 'Ejemplo ficticio' },
  { id: 'INV-004', side: 'novia', group: 'Familia Muestra Sol', contact: 'Inés Sol Muestra', phone: '', seats: '3', active: 'sí', token: '', link: '', notes: 'Ejemplo ficticio: 4 personas, cupo 3' },
];

export const TEMPLATE_PEOPLE: Row[] = [
  { id: 'INV-001-P1', invitationId: 'INV-001', name: 'Ana Robles Ejemplo', active: 'sí' },
  { id: 'INV-001-P2', invitationId: 'INV-001', name: 'Luis Robles Ejemplo', active: 'sí' },
  { id: 'INV-001-P3', invitationId: 'INV-001', name: 'Sara Robles Ejemplo', active: 'sí' },
  { id: 'INV-001-P4', invitationId: 'INV-001', name: 'Tomás Robles Ejemplo', active: 'sí' },
  { id: 'INV-002-P1', invitationId: 'INV-002', name: 'Julián Prado Ficticio', active: 'sí' },
  { id: 'INV-002-P2', invitationId: 'INV-002', name: 'Carmen Prado Ficticia', active: 'sí' },
  { id: 'INV-003-P1', invitationId: 'INV-003', name: 'Marina Luna Prueba', active: 'sí' },
  { id: 'INV-004-P1', invitationId: 'INV-004', name: 'Inés Sol Muestra', active: 'sí' },
  { id: 'INV-004-P2', invitationId: 'INV-004', name: 'Raúl Sol Muestra', active: 'sí' },
  { id: 'INV-004-P3', invitationId: 'INV-004', name: 'Paula Sol Muestra', active: 'sí' },
  { id: 'INV-004-P4', invitationId: 'INV-004', name: 'Diego Sol Muestra', active: 'sí' },
];

/** La pestaña Respuestas la llena el script; esta fila solo muestra el formato. */
export const TEMPLATE_RESPONSES: Row[] = [
  { invitationId: 'INV-002', personIds: 'INV-002-P1, INV-002-P2', status: 'asistirá', revision: '1', updatedAt: '2027-01-15T19:20:00-06:00', requestId: 'ejemplo-ficticio-borrar' },
];

const toRows = (tab: { columns: { key: string }[] }, rows: Row[]) => rows.map((r) => tab.columns.map((c) => r[c.key] ?? ''));

export const TEMPLATES = {
  invitaciones: { file: 'Invitaciones.csv', header: headersOf(INVITATIONS_TAB), rows: toRows(INVITATIONS_TAB, TEMPLATE_INVITATIONS) },
  personas: { file: 'Personas.csv', header: headersOf(PEOPLE_TAB), rows: toRows(PEOPLE_TAB, TEMPLATE_PEOPLE) },
  respuestas: { file: 'Respuestas.csv', header: headersOf(RESPONSES_TAB), rows: toRows(RESPONSES_TAB, TEMPLATE_RESPONSES) },
};
export type TemplateName = keyof typeof TEMPLATES;
