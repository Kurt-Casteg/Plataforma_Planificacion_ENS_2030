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
 * @returns {Promise<{codigo: string, origen: 'servidor'|'local', motivo?: string}>}
 */
export async function siguienteCodigo({ plan, anio, actividadesLocales = [] }) {
  const enLinea = Boolean(perfil.nube && perfil.identificado && perfil.departamento);

  if (enLinea) {
    try {
      const codigo = await perfil.nube.reservarCodigo(plan, anio);
      if (Number.isFinite(codigo) && codigo > 0) return { codigo: String(codigo), origen: 'servidor' };
      throw new Error('El servidor no devolvió un número válido.');
    } catch (e) {
      // Se informa el motivo hacia arriba: numerar localmente teniendo sesión
      // puede repetir códigos dentro del departamento, y eso no debe pasar
      // inadvertido.
      console.warn('No se pudo reservar el código en el servidor; se numera localmente.', e);
      return {
        codigo: String(mayorCodigoLocal(actividadesLocales) + 1),
        origen: 'local',
        motivo: e?.message || 'Error desconocido'
      };
    }
  }

  return { codigo: String(mayorCodigoLocal(actividadesLocales) + 1), origen: 'local' };
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
