export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    /** Campos adicionales para la respuesta JSON (p. ej. la respuesta vigente en un conflicto). */
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}
