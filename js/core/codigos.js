/**
 * Código correlativo automático de las actividades.
 *
 * La numeración es por departamento, plan y año: si dos personas del mismo
 * departamento cargan actividades, la serie sigue corrida entre ambas.
 *
 * Con sesión iniciada, el número lo entrega la base de datos mediante una
 * reserva atómica (`reservar_codigo`), así que dos personas guardando en el
 * mismo instante nunca obtienen el mismo número. Un usuario normal no puede ver
 * las actividades de sus colegas, de modo que este cálculo NO puede hacerse en
 * el navegador: la función corre en el servidor con privilegios elevados y
 * devuelve solo un número.
 *
 * Sin sesión (modo local), se numera a partir de lo que hay en este navegador.
 */

import { perfil } from './perfil.js';

/** Mayor código numérico presente en una lista de actividades. */
function mayorCodigoLocal(actividades) {
  return actividades.reduce((max, a) => {
    const n = parseInt(String(a.codigoActividad ?? '').trim(), 10);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
}

/**
 * Reserva y devuelve el siguiente código.
 *
 * @param {object} opciones
 * @param {string} opciones.plan
 * @param {number} opciones.anio
 * @param {Array}  opciones.actividadesLocales  Para el respaldo sin conexión.
 * @returns {Promise<string>} El código como texto, listo para el formulario.
 */
export async function siguienteCodigo({ plan, anio, actividadesLocales = [] }) {
  if (perfil.nube && perfil.identificado && perfil.departamento) {
    try {
      const codigo = await perfil.nube.reservarCodigo(plan, anio);
      if (Number.isFinite(codigo) && codigo > 0) return String(codigo);
    } catch (e) {
      console.warn('No se pudo reservar el código en el servidor; se numera localmente.', e);
    }
  }
  return String(mayorCodigoLocal(actividadesLocales) + 1);
}

/**
 * Cuál sería el próximo código, sin reservarlo.
 * Sirve solo para mostrar una previsualización en el formulario: el número
 * definitivo se pide al guardar, porque entremedio otra persona puede haber
 * tomado el siguiente.
 */
export function previsualizarCodigo(actividadesLocales = []) {
  return String(mayorCodigoLocal(actividadesLocales) + 1);
}
