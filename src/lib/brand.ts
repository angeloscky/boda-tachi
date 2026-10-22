/**
 * Recursos gráficos del logo.
 * Original conservado en assets/logo/original/ (captura JPEG 738×1600).
 * Las variantes SVG salen de scripts/vectorize-logo.py: son un trazado automático
 * fiel a esa captura, no el archivo vectorial de origen. Si llega el SVG original,
 * reemplaza los archivos de public/assets/logo/ conservando sus nombres.
 */
const base = import.meta.env.BASE_URL;

export const LOGO = {
  available: true,
  /** Variante monocromática clara para usar sobre negro. */
  onDark: `${base}assets/logo/logo-claro.svg`,
  /** Monograma SI para el sello del sobre. */
  monogram: `${base}assets/logo/monograma-claro.svg`,
  /** Monograma oscuro para la carta dentro del sobre. */
  monogramDark: `${base}assets/logo/monograma-negro.svg`,
  alt: 'Sofía e Isaac · 22 de mayo de 2027',
};
