/** Formateo consistente de números, montos y fechas en español de Chile. */

const NUM = new Intl.NumberFormat('es-CL');
const MILES = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 });
const FECHA = new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
const FECHA_LARGA = new Intl.DateTimeFormat('es-CL', { dateStyle: 'long', timeStyle: 'short' });

export const numero = (n) => NUM.format(Number(n) || 0);

/** Los montos del sistema están expresados en miles de pesos. */
export const monto = (n) => `M$ ${MILES.format(Number(n) || 0)}`;

/** Monto en pesos reales (para totales de gran magnitud). */
export const pesos = (n) => `$ ${MILES.format((Number(n) || 0) * 1000)}`;

export const fecha = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : FECHA.format(d);
};

/**
 * Fecha en palabras: "miércoles 15 de abril de 2026".
 *
 * Los campos <input type="date"> muestran el formato del idioma del navegador,
 * que en un equipo en inglés es mm/dd/aaaa. Escribir la fecha en palabras al
 * lado elimina la ambigüedad entre 04/09 y 09/04, que en un plan de compras
 * significa cinco meses de diferencia.
 */
export const fechaEnPalabras = (iso) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return '';
  const [a, m, d] = iso.split('-').map(Number);
  const fecha = new Date(a, m - 1, d);
  if (Number.isNaN(fecha.getTime())) return '';
  return new Intl.DateTimeFormat('es-CL', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  }).format(fecha);
};

export const fechaHora = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : FECHA_LARGA.format(d);
};

/** Recorta un texto largo agregando puntos suspensivos. */
export const recortar = (s, max = 80) => {
  const t = String(s ?? '');
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** Nombre de archivo seguro (sin acentos ni caracteres problemáticos). */
export function nombreArchivo(base, extension) {
  const limpio = String(base)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  const sello = new Date().toISOString().slice(0, 10);
  return `${limpio}-${sello}.${extension}`;
}
