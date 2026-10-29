/**
 * Almacén de actividades.
 *
 * Ofrece una interfaz única al resto de la aplicación y esconde de dónde
 * vienen los datos. Hoy hay dos adaptadores:
 *   - `local`  : navegador (localStorage), funciona sin internet ni cuentas.
 *   - `nube`   : Supabase (opcional), permite consolidar entre equipos.
 *
 * Si mañana se cambia el backend, solo se agrega un adaptador nuevo:
 * ningún otro módulo se entera.
 */

import { CONFIG } from '../../config.js';
import { normalizarActividad, nuevoId } from './modelo.js';
import { perfil } from './perfil.js';
import { periodo } from './periodo.js';

/**
 * Copia del navegador del período con que trabaja la pestaña.
 *
 * El vigente usa la clave de siempre. Un período elegido con el selector de
 * Control de Gestión (ver periodo.js) tiene su propia clave,
 * `seremi.planificacion.v2.periodo.2026`, para que abrir un año de prueba
 * jamás toque ni archive la copia del ciclo real.
 */
const CLAVE = periodo.esVigente
  ? 'seremi.planificacion.v2'
  : `seremi.planificacion.v2.periodo.${periodo.anio}`;

/**
 * Prefijo de los archivos de ciclos anteriores: `seremi.planificacion.archivo.2026`.
 * Ver `#archivarCicloAnterior()`.
 */
const PREFIJO_ARCHIVO = 'seremi.planificacion.archivo.';

/**
 * Año al que pertenece lo guardado sin marca de año.
 *
 * Hasta la versión 3.9 el navegador no anotaba de qué ciclo eran sus
 * actividades. Esta plataforma solo existió para el ciclo 2026 antes de esa
 * versión, así que todo lo que no trae marca es de 2026. Es un dato histórico
 * fijo: NO se cambia al pasar de año.
 */
const ANIO_SIN_MARCA = 2026;
/** Claves de las versiones anteriores, para migrar automáticamente. */
const CLAVES_ANTIGUAS = [
  { clave: 'actividadesENS', plan: 'pns' },
  { clave: 'actividadesENS_planGestion2026', plan: 'pgi' }
];

/* ------------------------------------------------------------------ */
/* Adaptador local                                                     */
/* ------------------------------------------------------------------ */

const almacenLocal = {
  id: 'local',
  disponible: () => {
    try {
      const p = '__prueba__';
      localStorage.setItem(p, '1');
      localStorage.removeItem(p);
      return true;
    } catch {
      return false;
    }
  },
  /**
   * Devuelve las actividades guardadas y dos datos de control:
   *  - `anio`: el ciclo al que pertenecen (ver ANIO_SIN_MARCA).
   *  - `sincronizadas`: ids que este navegador sabe que existen en la nube.
   */
  leer() {
    const vacio = { actividades: [], anio: periodo.anio, sincronizadas: [] };
    try {
      const crudo = localStorage.getItem(CLAVE);
      if (!crudo) return vacio;
      const datos = JSON.parse(crudo);
      const lista = Array.isArray(datos?.actividades) ? datos.actividades : [];
      // Se normaliza SIEMPRE al leer: lo guardado pudo venir de otra versión,
      // de una edición manual o de un respaldo antiguo. Así el resto de la
      // aplicación nunca recibe un objeto incompleto.
      const actividades = lista.map((a) => {
        try {
          return normalizarActividad(a);
        } catch (e) {
          console.warn('Se descartó una actividad ilegible:', e);
          return null;
        }
      }).filter(Boolean);
      return {
        actividades,
        anio: Number.isInteger(datos?.anio) ? datos.anio : ANIO_SIN_MARCA,
        sincronizadas: Array.isArray(datos?.sincronizadas) ? datos.sincronizadas.map(String) : []
      };
    } catch (e) {
      console.error('No se pudo leer el almacenamiento local:', e);
      return vacio;
    }
  },
  escribir(actividades, { anio = periodo.anio, sincronizadas = [] } = {}) {
    const carga = JSON.stringify({
      version: 2, actualizado: new Date().toISOString(), anio, sincronizadas, actividades
    });
    try {
      localStorage.setItem(CLAVE, carga);
      return { ok: true };
    } catch (e) {
      const lleno = e?.name === 'QuotaExceededError' || e?.code === 22;
      return {
        ok: false,
        error: lleno
          ? 'El navegador se quedó sin espacio. Exporta un respaldo y elimina actividades antiguas.'
          : 'No se pudieron guardar los cambios en este navegador.'
      };
    }
  }
};

/* ------------------------------------------------------------------ */
/* Migración desde las versiones anteriores                            */
/* ------------------------------------------------------------------ */

function migrarSiCorresponde() {
  if (!almacenLocal.disponible()) return { migradas: 0 };
  if (localStorage.getItem(CLAVE)) return { migradas: 0 };

  const recuperadas = [];
  for (const { clave, plan } of CLAVES_ANTIGUAS) {
    try {
      const crudo = localStorage.getItem(clave);
      if (!crudo) continue;
      const lista = JSON.parse(crudo);
      if (!Array.isArray(lista)) continue;
      for (const vieja of lista) recuperadas.push(normalizarActividad(vieja, { planId: plan }));
    } catch (e) {
      console.warn(`No se pudo migrar la clave "${clave}":`, e);
    }
  }
  if (recuperadas.length) {
    // Las claves antiguas son de la plataforma original, que fue del ciclo
    // 2026: se marcan así para que, si el ciclo ya cambió, pasen al archivo y
    // no se mezclen con el actual.
    almacenLocal.escribir(recuperadas, { anio: ANIO_SIN_MARCA });
    // Se conservan las claves antiguas como respaldo; no se borran.
  }
  return { migradas: recuperadas.length };
}

/* ------------------------------------------------------------------ */
/* Almacén público                                                     */
/* ------------------------------------------------------------------ */

class Almacen extends EventTarget {
  #actividades = [];
  #adaptadorNube = null;
  #ultimoError = null;

  /**
   * Ids que este navegador sabe que existen en la nube.
   *
   * Es lo que permite distinguir, al sincronizar, dos casos que se ven iguales
   * —una actividad local que la nube no trae—:
   *   - estaba en la nube y ya no está → alguien la eliminó: se quita aquí.
   *   - nunca llegó a la nube (sin sesión, o subiendo) → se conserva.
   * Hasta la versión 3.9 no existía, y por eso las eliminaciones no se
   * propagaban: lo que Control de Gestión borraba seguía apareciendo en el
   * navegador de la persona que lo había registrado.
   */
  #sincronizadas = new Set();

  /** Momento en que la nube confirmó cada guardado (ver `#reconciliar`). */
  #confirmadas = new Map();

  /** Ids en proceso de eliminación: la nube puede devolverlos un instante más. */
  #eliminando = new Set();

  /**
   * Inicializa: migra datos antiguos, archiva el ciclo anterior si cambió el
   * año y carga lo que exista.
   */
  async iniciar() {
    // La migración y el cambio de ciclo son asuntos del período vigente: en un
    // período elegido a mano no hay nada que migrar ni que archivar.
    const { migradas } = periodo.esVigente ? migrarSiCorresponde() : { migradas: 0 };
    const archivadas = periodo.esVigente ? this.#archivarCicloAnterior() : null;
    const { actividades, sincronizadas } = almacenLocal.leer();
    this.#actividades = actividades;
    this.#sincronizadas = new Set(sincronizadas);
    this.#emitir();
    return { migradas, archivadas, soportaAlmacenamiento: almacenLocal.disponible() };
  }

  /**
   * Cambio de ciclo.
   *
   * Si lo guardado en este navegador es de otro año que `CONFIG.anio`, se
   * aparta completo a `seremi.planificacion.archivo.<año>` y el ciclo nuevo
   * empieza vacío. Así, cambiar `anio` en config.js deja limpios los
   * navegadores de todos los equipos la próxima vez que abren la plataforma,
   * sin pedirle a nadie que borre nada.
   *
   * Se ARCHIVA, no se borra: puede haber actividades que nunca subieron a la
   * nube (registradas sin sesión) y esta sería su única copia. Se pueden
   * descargar desde «Más» y volver a importar si hiciera falta.
   *
   * @returns {{anio: number, total: number} | null}
   */
  #archivarCicloAnterior() {
    if (!almacenLocal.disponible()) return null;
    let crudo;
    let datos;
    try {
      crudo = localStorage.getItem(CLAVE);
      if (!crudo) return null;
      datos = JSON.parse(crudo);
    } catch {
      return null;
    }
    const anio = Number.isInteger(datos?.anio) ? datos.anio : ANIO_SIN_MARCA;
    if (anio === CONFIG.anio) return null;

    const lista = Array.isArray(datos?.actividades) ? datos.actividades : [];
    const claveArchivo = `${PREFIJO_ARCHIVO}${anio}`;

    if (lista.length) {
      // Si ya existía un archivo de ese año (por ejemplo, alguien volvió a
      // abrir una copia antigua), se suman sin duplicar.
      let previas = [];
      try { previas = JSON.parse(localStorage.getItem(claveArchivo) || '{}').actividades || []; } catch { /* nada */ }
      const porId = new Map([...previas, ...lista].map((a) => [a.id, a]));
      const archivo = JSON.stringify({
        anio, archivadoEn: new Date().toISOString(), actividades: [...porId.values()]
      });

      // Primero se libera el espacio del ciclo anterior y después se escribe
      // el archivo, que pesa lo mismo: así cabe aunque el navegador esté justo
      // de espacio. Si aun así fallara, se restaura todo y no se archiva: un
      // ciclo mezclado se puede limpiar después, una actividad perdida no.
      try {
        localStorage.removeItem(CLAVE);
        localStorage.setItem(claveArchivo, archivo);
      } catch (e) {
        console.error('No se pudo archivar el ciclo anterior:', e);
        try { localStorage.setItem(CLAVE, crudo); } catch { /* nada más que hacer */ }
        return null;
      }
    }

    // El ciclo nuevo queda marcado desde ya, aunque esté vacío. Sin esto, la
    // migración de las claves de la plataforma original se volvería a ejecutar.
    almacenLocal.escribir([], { anio: CONFIG.anio, sincronizadas: [] });
    return lista.length ? { anio, total: lista.length } : null;
  }

  /** Ciclos anteriores archivados en este navegador: [{ anio, total, archivadoEn }]. */
  archivos() {
    const lista = [];
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const clave = localStorage.key(i);
        if (!clave?.startsWith(PREFIJO_ARCHIVO)) continue;
        const datos = JSON.parse(localStorage.getItem(clave) || '{}');
        const total = Array.isArray(datos.actividades) ? datos.actividades.length : 0;
        if (total) lista.push({ anio: Number(datos.anio), total, archivadoEn: datos.archivadoEn });
      }
    } catch { /* sin almacenamiento: no hay archivos */ }
    return lista.sort((a, b) => b.anio - a.anio);
  }

  /** Actividades de un ciclo archivado, tal como quedaron guardadas. */
  leerArchivo(anio) {
    try {
      const datos = JSON.parse(localStorage.getItem(`${PREFIJO_ARCHIVO}${anio}`) || '{}');
      return Array.isArray(datos.actividades) ? datos.actividades : [];
    } catch {
      return [];
    }
  }

  /** Conecta un adaptador de nube (Supabase). Opcional. */
  async conectarNube(adaptador) {
    this.#adaptadorNube = adaptador;
    if (!adaptador) return;
    const inicio = Date.now();
    try {
      const remotas = await adaptador.listar();
      this.#reconciliar(remotas, inicio);
      this.#persistir();
      this.#emitir();
    } catch (e) {
      console.error('No se pudo sincronizar con la nube:', e);
      this.#ultimoError = e;
    }
  }

  /**
   * Deja el navegador igual a la nube, sin perder lo que todavía no ha subido.
   *
   *  1. Lo que la nube trae se fusiona por id, ganando la versión más reciente.
   *  2. Lo que este navegador sabía que estaba en la nube y la nube ya no trae
   *     se quita: alguien lo eliminó (o el perfil activo ya no puede verlo).
   *  3. Lo que nunca llegó a la nube se conserva.
   *
   * `inicio` es el momento en que se pidió la lista. Un guardado que la nube
   * confirmó DESPUÉS de ese momento pudo no alcanzar a salir en la lista; no
   * por eso se ha eliminado, así que se respeta.
   */
  #reconciliar(remotas, inicio) {
    const idsRemotos = new Set();
    const porId = new Map(this.#actividades.map((a) => [a.id, a]));

    for (const r of remotas) {
      const normal = normalizarActividad(r);
      if (this.#eliminando.has(normal.id)) continue;
      idsRemotos.add(normal.id);
      const local = porId.get(normal.id);
      if (!local || new Date(normal.actualizadaEn) >= new Date(local.actualizadaEn)) {
        porId.set(normal.id, normal);
      }
    }

    for (const id of this.#sincronizadas) {
      if (idsRemotos.has(id)) continue;
      const confirmada = this.#confirmadas.get(id);
      if (confirmada && confirmada >= inicio) continue;
      porId.delete(id);
    }

    this.#actividades = [...porId.values()];
    this.#sincronizadas = new Set(
      [...idsRemotos, ...[...this.#confirmadas].filter(([, t]) => t >= inicio).map(([id]) => id)]
        .filter((id) => porId.has(id))
    );
  }

  get todas() {
    return this.#actividades.slice();
  }

  /** Actividades de un plan, ordenadas por código y luego por fecha. */
  porPlan(planId) {
    return this.#actividades
      .filter((a) => a.plan === planId)
      .sort((a, b) => {
        const ca = parseInt(a.codigoActividad, 10);
        const cb = parseInt(b.codigoActividad, 10);
        if (Number.isFinite(ca) && Number.isFinite(cb) && ca !== cb) return ca - cb;
        return new Date(a.creadaEn) - new Date(b.creadaEn);
      });
  }

  obtener(id) {
    return this.#actividades.find((a) => a.id === id) || null;
  }

  /**
   * Cerrojo de escritura.
   *
   * La interfaz ya esconde los botones y la base de datos ya rechaza la
   * operación; esto es la barrera del medio. Existe porque las otras dos pueden
   * fallar de maneras distintas: un camino de código que olvide consultar los
   * permisos llegaría igual hasta aquí, y en modo local (sin sesión) no hay
   * servidor que diga que no.
   */
  #exigirEscritura(accion) {
    if (!perfil.soloLectura) return;
    const e = new Error(
      `Tu perfil actual (${perfil.rol === 'observador' ? 'Observador' : perfil.rol}) es de solo lectura: ` +
      `no puede ${accion}. Cambia de perfil en la cabecera si tienes otro asignado.`
    );
    e.codigo = 'solo_lectura';
    throw e;
  }

  /** Crea o actualiza. Devuelve la actividad guardada. */
  async guardar(actividad) {
    this.#exigirEscritura('guardar actividades');
    // Guardar SIEMPRE actualiza la marca de tiempo: nunca se confía en la del cliente.
    const normal = normalizarActividad({ ...actividad, actualizadaEn: new Date().toISOString() });
    const i = this.#actividades.findIndex((a) => a.id === normal.id);
    if (i >= 0) this.#actividades[i] = normal;
    else this.#actividades.push(normal);

    const resultado = this.#persistir();
    this.#emitir();
    this.#sincronizarEnSegundoPlano('guardar', normal, () => {
      this.#sincronizadas.add(normal.id);
      this.#confirmadas.set(normal.id, Date.now());
      this.#persistir();
    });
    return { actividad: normal, ...resultado };
  }

  async eliminar(id) {
    this.#exigirEscritura('eliminar actividades');
    const antes = this.#actividades.length;
    this.#actividades = this.#actividades.filter((a) => a.id !== id);
    if (this.#actividades.length === antes) return { ok: false };
    this.#sincronizadas.delete(id);
    this.#confirmadas.delete(id);
    const resultado = this.#persistir();
    this.#emitir();
    if (this.#adaptadorNube) this.#eliminando.add(id);
    this.#sincronizarEnSegundoPlano('eliminar', { id }, null, () => this.#eliminando.delete(id));
    return resultado;
  }

  /** Duplica una actividad como borrador nuevo. */
  async duplicar(id) {
    this.#exigirEscritura('duplicar actividades');
    const original = this.obtener(id);
    if (!original) return null;
    const copia = normalizarActividad({
      ...structuredClone(original),
      id: nuevoId(),
      codigoActividad: '',
      nombreActividad: `${original.nombreActividad} (copia)`,
      creadaEn: undefined
    });
    await this.guardar(copia);
    return copia;
  }

  /** Reemplaza o agrega un lote de actividades (importación). */
  async importar(lista, { modo = 'agregar' } = {}) {
    this.#exigirEscritura('importar actividades');
    const entrantes = lista.map((a) => normalizarActividad(a));
    // Lo importado es local hasta que se vuelva a guardar con sesión: si la
    // nube no lo tiene, no debe interpretarse como «eliminado por otro».
    for (const a of entrantes) { this.#sincronizadas.delete(a.id); this.#confirmadas.delete(a.id); }
    if (modo === 'reemplazar') {
      this.#actividades = entrantes;
    } else {
      const porId = new Map(this.#actividades.map((a) => [a.id, a]));
      for (const a of entrantes) porId.set(a.id, a);
      this.#actividades = [...porId.values()];
    }
    const resultado = this.#persistir();
    this.#emitir();
    return { total: entrantes.length, ...resultado };
  }

  async vaciarPlan(planId) {
    this.#exigirEscritura('borrar actividades');
    this.#actividades = this.#actividades.filter((a) => a.plan !== planId);
    const resultado = this.#persistir();
    this.#emitir();
    return resultado;
  }

  #persistir() {
    const r = almacenLocal.escribir(this.#actividades, {
      anio: periodo.anio,
      sincronizadas: (() => {
        const presentes = new Set(this.#actividades.map((a) => a.id));
        return [...this.#sincronizadas].filter((id) => presentes.has(id));
      })()
    });
    if (!r.ok) this.#ultimoError = r.error;
    return r;
  }

  #sincronizarEnSegundoPlano(accion, carga, alConfirmar = null, alTerminar = null) {
    if (!this.#adaptadorNube) { alTerminar?.(); return; }
    Promise.resolve()
      .then(() => this.#adaptadorNube[accion](carga))
      .then(() => alConfirmar?.())
      .catch((e) => {
        console.warn('Sincronización pendiente (se reintentará):', e);
        this.dispatchEvent(new CustomEvent('sincronizacion:error', { detail: e }));
      })
      .finally(() => alTerminar?.());
  }

  #emitir() {
    this.dispatchEvent(new CustomEvent('cambio', { detail: { actividades: this.todas } }));
  }

  get ultimoError() {
    return this.#ultimoError;
  }
}

export const almacen = new Almacen();
