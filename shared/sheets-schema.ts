/**
 * Estructura del futuro archivo de Google Sheets (un solo archivo, privado).
 *
 * Las columnas se leen por su encabezado, nunca por posición ni por número de fila:
 * ordenar o mover filas no cambia identidades, enlaces ni respuestas.
 * La misma estructura sirve para los CSV de importación y exportación locales.
 */

export const SHEETS_SCHEMA_VERSION = 1;

export interface ColumnDef {
  /** Nombre del campo en el código. */
  key: string;
  /** Encabezado exacto en la hoja y en el CSV. */
  header: string;
  /** Columna técnica: la escribe el script; se protege en la hoja. */
  technical?: boolean;
  required?: boolean;
  help: string;
}

export const INVITATIONS_TAB = {
  name: 'Invitaciones',
  columns: [
    { key: 'id', header: 'id_invitacion', required: true, help: 'ID estable de la invitación (p. ej. INV-001). No se reutiliza ni se cambia. Los IDs EJEMPLO- y DEMO- nunca se atienden.' },
    { key: 'side', header: 'lado', help: 'novia, novio o ambos.' },
    { key: 'group', header: 'grupo', required: true, help: 'Nombre de la invitación tal como lo verá la familia.' },
    { key: 'contact', header: 'contacto_principal', help: 'Persona a quien se le envía el enlace (uso interno).' },
    { key: 'phone', header: 'telefono', help: '10 dígitos o formato internacional (uso interno, nunca se muestra).' },
    { key: 'seats', header: 'cupo', help: 'Lugares asignados (1 a 30). Vacío = pendiente; no puede confirmar.' },
    { key: 'active', header: 'activa', help: 'sí o no (vacío = sí). "no" desactiva la invitación y su enlace.' },
    { key: 'token', header: 'token', technical: true, help: 'Lo genera el menú Boda ("revocado" = enlace anulado a propósito). Quien tenga el enlace puede responder por esta invitación.' },
    { key: 'link', header: 'enlace', technical: true, help: 'Fórmula: url_publica + /i/ + token. Para copiar y enviar.' },
    { key: 'notes', header: 'notas', help: 'Notas internas (nunca se muestran al invitado).' },
  ] as ColumnDef[],
};

export const PEOPLE_TAB = {
  name: 'Personas',
  columns: [
    { key: 'id', header: 'id_persona', required: true, help: 'ID estable de la persona (p. ej. INV-001-P1).' },
    { key: 'invitationId', header: 'id_invitacion', required: true, help: 'ID de la invitación a la que pertenece.' },
    { key: 'name', header: 'nombre', required: true, help: 'Nombre autorizado, como aparecerá en la confirmación.' },
    { key: 'active', header: 'activa', help: 'sí o no (vacío = sí). "no" la quita de la confirmación sin borrar su ID.' },
  ] as ColumnDef[],
};

export const RESPONSES_TAB = {
  name: 'Respuestas',
  columns: [
    { key: 'invitationId', header: 'id_invitacion', required: true, technical: true, help: 'Una sola fila (respuesta vigente) por invitación.' },
    { key: 'personIds', header: 'personas_seleccionadas', technical: true, help: 'IDs de persona separados por coma.' },
    { key: 'status', header: 'estado', technical: true, help: 'asistirá o no asistirá.' },
    { key: 'revision', header: 'revision', technical: true, help: 'Sube en 1 con cada cambio; evita sobrescrituras silenciosas.' },
    { key: 'updatedAt', header: 'fecha_hora', technical: true, help: 'Fecha y hora del último cambio (America/Mexico_City).' },
    { key: 'requestId', header: 'id_solicitud', technical: true, help: 'Identificador de la solicitud que la guardó (reintentos sin duplicar).' },
  ] as ColumnDef[],
};

/** Ajustes: dos columnas, clave y valor. */
export const CONFIG_TAB = {
  name: 'Config',
  keys: {
    rsvpOpen: { key: 'confirmaciones_abiertas', help: 'Casilla. Desmarcar cierra las confirmaciones (p. ej. durante un cambio sensible).' },
    publicUrl: { key: 'url_publica', help: 'Dirección pública de la invitación, sin "/" final.' },
    schemaVersion: { key: 'version_estructura', help: 'No editar.' },
  },
};

export const SUMMARY_TAB = 'Resumen';

export const TABS = [INVITATIONS_TAB, PEOPLE_TAB, RESPONSES_TAB];

export const headersOf = (tab: { columns: ColumnDef[] }) => tab.columns.map((c) => c.header);

/** Convierte una fila (objeto por encabezado) a objeto por clave del código. */
export function rowByKey(tab: { columns: ColumnDef[] }, byHeader: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of tab.columns) out[c.key] = byHeader[c.header];
  return out;
}
