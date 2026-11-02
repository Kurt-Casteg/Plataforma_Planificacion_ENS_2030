/**
 * Ajustes de la plataforma que Control de Gestión cambia desde la interfaz
 * («Más» → «Configuración»), sin tocar código ni publicar de nuevo.
 *
 * Viven en la tabla `configuracion` de Supabase, que cualquiera con sesión lee
 * y solo Control de Gestión modifica. Sin sesión (o sin nube) se usan los
 * valores por defecto de abajo: el circuito de aprobación apagado —no hay
 * jefaturas a quién enviar nada— y el análisis del PAC encendido, sin holgura
 * ni marco presupuestario porque esos datos solo existen en el servidor.
 *
 * El servidor no confía en estos valores: el bloqueo de lo aprobado lo decide
 * la propia base de datos leyendo la misma tabla. Aquí solo gobiernan qué se
 * muestra.
 */

import { perfil } from './perfil.js';

/** Clave en la base de datos ↔ nombre en la plataforma. */
const CLAVES = { aprobacion: 'aprobacion', analisis_pac: 'analisisPac' };

const POR_DEFECTO = {
  aprobacion: { activa: false, plazo: null },
  analisisPac: { activo: true, holgura: [], marco: {} }
};

class Ajustes extends EventTarget {
  #datos = structuredClone(POR_DEFECTO);
  #desdeServidor = false;

  /** { activa, plazo } */
  get aprobacion() { return this.#datos.aprobacion; }

  /** { activo, holgura: [{ hasta, dias }], marco: { '2027': { depto: M$ } } } */
  get analisisPac() { return this.#datos.analisisPac; }

  /**
   * ¿Rige el circuito de aprobación para quien está usando la plataforma?
   * Hace falta que esté encendido en el servidor y que haya una sesión: sin
   * sesión no hay jefatura que revise ni servidor que guarde los estados.
   */
  get circuitoActivo() {
    return this.#desdeServidor && Boolean(this.#datos.aprobacion.activa) && perfil.identificado;
  }

  /** Criterios de holgura ordenados por monto, o [] si no hay. */
  get criteriosHolgura() {
    const lista = Array.isArray(this.#datos.analisisPac.holgura) ? this.#datos.analisisPac.holgura : [];
    return lista
      .map((c) => ({ hasta: c.hasta == null || c.hasta === '' ? null : Number(c.hasta), dias: Number(c.dias) }))
      .filter((c) => Number.isFinite(c.dias) && c.dias > 0 && (c.hasta === null || Number.isFinite(c.hasta)))
      .sort((a, b) => (a.hasta ?? Infinity) - (b.hasta ?? Infinity));
  }

  /** Marco presupuestario del subtítulo 22 de un año: { depto: M$ } (puede venir vacío). */
  marcoDe(anio) {
    const m = this.#datos.analisisPac.marco?.[String(anio)];
    if (!m || typeof m !== 'object') return {};
    return Object.fromEntries(Object.entries(m)
      .map(([d, v]) => [d, Number(v)])
      .filter(([, v]) => Number.isFinite(v) && v > 0));
  }

  /** Lee los ajustes del servidor. Si falla, quedan los valores por defecto. */
  async cargar(nube) {
    try {
      const filas = await nube.configuracion();
      for (const { clave, valor } of filas) {
        const nombre = CLAVES[clave];
        if (nombre && valor && typeof valor === 'object') {
          this.#datos[nombre] = { ...POR_DEFECTO[nombre], ...valor };
        }
      }
      this.#desdeServidor = true;
    } catch (e) {
      console.warn('No se pudo leer la configuración; se usan los valores por defecto.', e);
    }
    this.#emitir();
  }

  /** Guarda un bloque de ajustes (solo Control de Gestión). */
  async guardar(nube, nombre, valor) {
    const clave = Object.keys(CLAVES).find((k) => CLAVES[k] === nombre);
    if (!clave) throw new Error(`Ajuste desconocido: ${nombre}`);
    await nube.guardarConfiguracion(clave, valor);
    this.#datos[nombre] = { ...POR_DEFECTO[nombre], ...valor };
    this.#emitir();
  }

  #emitir() {
    this.dispatchEvent(new CustomEvent('cambio'));
  }
}

export const ajustes = new Ajustes();
