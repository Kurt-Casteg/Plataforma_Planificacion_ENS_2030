/**
 * Período de planificación con el que se trabaja en esta pestaña.
 *
 * Por defecto es el vigente, `CONFIG.anio`, y para los equipos no hay nada
 * más: nunca ven otro. Control de Gestión puede abrir además los años de
 * `CONFIG.otrosPeriodos` —por ejemplo, para seguir haciendo pruebas en 2026
 * mientras el ciclo real es 2027— con el selector «Período» de la cabecera.
 *
 * La elección vive en `sessionStorage`, que es propio de cada pestaña: al
 * cerrarla, o al abrir la plataforma en otra, se vuelve al vigente. Así nadie
 * se queda trabajando en un año que no corresponde por haberlo dejado elegido
 * la semana pasada.
 *
 * Cambiar de período RECARGA la página. Es deliberado: el año decide qué se
 * pide a la base, dónde se guarda la copia del navegador y qué numeración se
 * usa, y recargar es la única forma de garantizar que no quede nada del
 * período anterior en memoria. Por lo mismo, `periodo.anio` es constante
 * durante toda la vida de la página y se puede leer desde cualquier módulo.
 *
 * Esto gobierna la INTERFAZ. La base no restringe por año (cada perfil ve y
 * escribe lo mismo que antes, solo que de otro ciclo); lo que se protege aquí
 * es que nadie mezcle ciclos por accidente.
 */

import { CONFIG } from '../../config.js';

const CLAVE = 'seremi.planificacion.periodo';

/** Vigente + los habilitados en config.js, sin repetir, del más reciente al más antiguo. */
const DISPONIBLES = [...new Set([CONFIG.anio, ...(CONFIG.otrosPeriodos ?? [])])]
  .filter((a) => Number.isInteger(a) && a >= 2020 && a <= 2100)
  .sort((a, b) => b - a);

function leerElegido() {
  // Sin nube no hay perfiles, y por lo tanto nadie que pueda elegir.
  if (!CONFIG.nube?.habilitada) return CONFIG.anio;
  try {
    const guardado = Number(sessionStorage.getItem(CLAVE));
    return DISPONIBLES.includes(guardado) ? guardado : CONFIG.anio;
  } catch {
    return CONFIG.anio;
  }
}

const ELEGIDO = leerElegido();

/** Ya se pidió una recarga: no se pide otra encima (se cancelarían entre sí). */
let recargando = false;

export const periodo = {
  /** Año con el que trabaja esta pestaña. */
  anio: ELEGIDO,

  /** Año del ciclo vigente (config.js). */
  vigente: CONFIG.anio,

  /** ¿Se está trabajando en el ciclo vigente? */
  esVigente: ELEGIDO === CONFIG.anio,

  /** Años que se pueden elegir, del más reciente al más antiguo. */
  disponibles: DISPONIBLES,

  /** ¿Hay algo que elegir? Si no, el selector no aparece para nadie. */
  get hayOtros() {
    return DISPONIBLES.length > 1;
  },

  /**
   * Fija el período de esta pestaña y recarga. Elegir el vigente borra la
   * marca, de modo que la pestaña queda exactamente como cualquier otra.
   */
  cambiar(anio) {
    if (recargando) return;
    recargando = true;
    try {
      if (anio === CONFIG.anio || !DISPONIBLES.includes(anio)) sessionStorage.removeItem(CLAVE);
      else sessionStorage.setItem(CLAVE, String(anio));
    } catch { /* sin almacenamiento de sesión: se queda en el vigente */ }
    location.reload();
  },

  /** ¿Hay una recarga en curso pedida por este módulo? */
  get recargando() {
    return recargando;
  },

  /** Vuelve al vigente sin recargar (para quien vaya a recargar de todos modos). */
  olvidar() {
    try { sessionStorage.removeItem(CLAVE); } catch { /* nada */ }
  }
};
