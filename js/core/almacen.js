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

import { normalizarActividad, nuevoId } from './modelo.js';
import { perfil } from './perfil.js';

const CLAVE = 'seremi.planificacion.v2';
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
  leer() {
    try {
      const crudo = localStorage.getItem(CLAVE);
      if (!crudo) return [];
      const datos = JSON.parse(crudo);
      const lista = Array.isArray(datos?.actividades) ? datos.actividades : [];
      // Se normaliza SIEMPRE al leer: lo guardado pudo venir de otra versión,
      // de una edición manual o de un respaldo antiguo. Así el resto de la
      // aplicación nunca recibe un objeto incompleto.
      return lista.map((a) => {
        try {
          return normalizarActividad(a);
        } catch (e) {
          console.warn('Se descartó una actividad ilegible:', e);
          return null;
        }
      }).filter(Boolean);
    } catch (e) {
      console.error('No se pudo leer el almacenamiento local:', e);
      return [];
    }
  },
  escribir(actividades) {
    const carga = JSON.stringify({ version: 2, actualizado: new Date().toISOString(), actividades });
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
    almacenLocal.escribir(recuperadas);
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

  /** Inicializa: migra datos antiguos y carga lo que exista. */
  async iniciar() {
    const { migradas } = migrarSiCorresponde();
    this.#actividades = almacenLocal.leer();
    this.#emitir();
    return { migradas, soportaAlmacenamiento: almacenLocal.disponible() };
  }

  /** Conecta un adaptador de nube (Supabase). Opcional. */
  async conectarNube(adaptador) {
    this.#adaptadorNube = adaptador;
    if (!adaptador) return;
    try {
      const remotas = await adaptador.listar();
      this.#fusionar(remotas);
      this.#persistir();
      this.#emitir();
    } catch (e) {
      console.error('No se pudo sincronizar con la nube:', e);
      this.#ultimoError = e;
    }
  }

  /** Fusiona por id conservando la versión más reciente (last-write-wins). */
  #fusionar(remotas) {
    const porId = new Map(this.#actividades.map((a) => [a.id, a]));
    for (const r of remotas) {
      const normal = normalizarActividad(r);
      const local = porId.get(normal.id);
      if (!local || new Date(normal.actualizadaEn) >= new Date(local.actualizadaEn)) {
        porId.set(normal.id, normal);
      }
    }
    this.#actividades = [...porId.values()];
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
    this.#sincronizarEnSegundoPlano('guardar', normal);
    return { actividad: normal, ...resultado };
  }

  async eliminar(id) {
    this.#exigirEscritura('eliminar actividades');
    const antes = this.#actividades.length;
    this.#actividades = this.#actividades.filter((a) => a.id !== id);
    if (this.#actividades.length === antes) return { ok: false };
    const resultado = this.#persistir();
    this.#emitir();
    this.#sincronizarEnSegundoPlano('eliminar', { id });
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
    const r = almacenLocal.escribir(this.#actividades);
    if (!r.ok) this.#ultimoError = r.error;
    return r;
  }

  #sincronizarEnSegundoPlano(accion, carga) {
    if (!this.#adaptadorNube) return;
    Promise.resolve()
      .then(() => this.#adaptadorNube[accion](carga))
      .catch((e) => {
        console.warn('Sincronización pendiente (se reintentará):', e);
        this.dispatchEvent(new CustomEvent('sincronizacion:error', { detail: e }));
      });
  }

  #emitir() {
    this.dispatchEvent(new CustomEvent('cambio', { detail: { actividades: this.todas } }));
  }

  get ultimoError() {
    return this.#ultimoError;
  }
}

export const almacen = new Almacen();
