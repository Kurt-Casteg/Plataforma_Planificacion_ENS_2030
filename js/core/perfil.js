/**
 * Perfil de la persona que está usando la plataforma.
 *
 * Es la fuente única de verdad para nombre, correo, departamento y permisos. El
 * formulario los toma de aquí en lugar de pedirlos, y el servidor los vuelve a
 * imponer al guardar, así que lo que se muestre nunca puede contradecir lo que
 * quede en la base de datos.
 *
 * Una cuenta puede tener VARIOS perfiles y usar uno a la vez. `roles` es la
 * lista a la que tiene derecho —la fija el administrador en la nómina— y
 * `rolActivo` el que rige ahora. Cambiar de perfil se guarda en el servidor:
 * las políticas de seguridad consultan el perfil activo, así que el cambio es
 * una restricción real y no un maquillaje de la interfaz.
 *
 * Sin sesión (modo local), el perfil queda vacío, el formulario vuelve a pedir
 * esos datos a mano y no hay restricciones: los datos son de este navegador.
 */

/** Catálogo de perfiles. Debe coincidir con la lista del esquema SQL. */
export const PERFILES = {
  equipo: {
    nombre: 'Equipo',
    descripcion: 'Registra y mantiene sus propias actividades.'
  },
  jefatura: {
    nombre: 'Jefatura',
    descripcion: 'Ve todas las actividades de su departamento; edita las suyas.'
  },
  control_gestion: {
    nombre: 'Control de Gestión',
    descripcion: 'Ve y edita las actividades de toda la institución; consolida.'
  },
  observador: {
    nombre: 'Observador',
    descripcion: 'Ve toda la institución y exporta. No modifica nada.'
  }
};

/** Perfiles que no pueden modificar datos. */
const SOLO_LECTURA = new Set(['observador']);

/** Perfiles que ven el trabajo de toda la institución. */
const VEN_TODO = new Set(['control_gestion', 'observador']);

export const nombrePerfil = (id) => PERFILES[id]?.nombre || id || '';

class Perfil extends EventTarget {
  #datos = null;
  #nube = null;

  /** @returns {boolean} true si hay una sesión iniciada con perfil cargado. */
  get identificado() {
    return Boolean(this.#datos?.correo);
  }

  get correo() { return this.#datos?.correo ?? ''; }
  get nombre() { return this.#datos?.nombre ?? ''; }
  get departamento() { return this.#datos?.departamento ?? ''; }
  get datos() { return this.#datos ? { ...this.#datos, roles: [...this.#datos.roles] } : null; }

  /** Perfiles a los que la cuenta tiene derecho. */
  get roles() { return this.#datos?.roles ? [...this.#datos.roles] : []; }

  /** Perfil en uso ahora. Sin sesión, 'equipo': el modo local no restringe. */
  get rol() { return this.#datos?.rolActivo ?? 'equipo'; }

  /** ¿Tiene más de un perfil? Es lo que decide si aparece el selector. */
  get tieneVariosPerfiles() { return this.roles.length > 1; }

  /**
   * Adaptador de nube asociado a esta sesión, o null en modo local.
   * Se expone aquí para que nadie más tenga que ir pasándolo de mano en mano.
   */
  get nube() { return this.#nube; }

  /** ¿Puede ver y consolidar el trabajo de todos? */
  get esControlDeGestion() { return this.rol === 'control_gestion'; }

  /**
   * Permisos derivados del perfil activo.
   *
   * Sin sesión iniciada nadie está restringido: los datos viven solo en este
   * navegador y no hay nada de nadie más que proteger.
   *
   * Esto gobierna la INTERFAZ. La restricción de verdad está en las políticas
   * de la base de datos: aunque alguien alterara estos valores desde la consola
   * del navegador, el servidor seguiría rechazando la escritura.
   */
  get permisos() {
    const soloLectura = this.identificado && SOLO_LECTURA.has(this.rol);
    return {
      soloLectura,
      puedeCrear: !soloLectura,
      puedeEditar: !soloLectura,
      puedeEliminar: !soloLectura,
      puedeImportar: !soloLectura,
      veTodo: VEN_TODO.has(this.rol)
    };
  }

  /** Atajo, porque es la pregunta que se hace en casi todos los llamados. */
  get soloLectura() { return this.permisos.soloLectura; }

  /** ¿Falta que elija su departamento? (perfil básico, fuera de la nómina) */
  get necesitaDepartamento() {
    return this.identificado && !this.departamento && !this.soloLectura;
  }

  /**
   * Carga el perfil desde la nube tras iniciar sesión.
   * Si la consulta falla, se arma un perfil mínimo con los datos de la sesión
   * para que la plataforma siga siendo usable.
   */
  async cargar(nube, sesion) {
    this.#nube = nube;
    const correo = sesion?.user?.email ?? '';

    let remoto = null;
    try {
      remoto = await nube.perfil();
    } catch (e) {
      console.warn('No se pudo leer el perfil; se usarán los datos de la sesión.', e);
    }

    this.#datos = {
      id: sesion?.user?.id ?? '',
      correo: remoto?.correo || correo,
      // Si aún no hay nombre registrado, se deduce del correo:
      // albert.mercado@… → "Albert Mercado".
      nombre: remoto?.nombre || nombreDesdeCorreo(correo),
      departamento: remoto?.departamento || '',
      ...normalizarRoles(remoto)
    };

    this.#emitir();
    return this.datos;
  }

  /**
   * Cambia el perfil activo. Lo decide el servidor, no el navegador: se envía
   * la preferencia y se adopta lo que la base devuelva. Si el perfil pedido no
   * estuviera entre los suyos, el servidor deja el anterior y aquí se refleja
   * ese resultado, no el deseo.
   *
   * @returns {Promise<boolean>} true si el perfil activo efectivamente cambió.
   */
  async cambiarPerfil(rol) {
    if (!this.identificado || rol === this.rol) return false;
    if (!this.roles.includes(rol)) {
      console.warn(`Perfil no asignado a esta cuenta: ${rol}`);
      return false;
    }

    const confirmado = await this.#nube.cambiarPerfil(rol);
    this.#datos = { ...this.#datos, ...normalizarRoles(confirmado) };
    this.#emitir();
    return this.rol === rol;
  }

  /**
   * Guarda el departamento elegido por quien no venía en la nómina, para no
   * volver a preguntárselo la próxima vez.
   */
  async fijarDepartamento(departamento) {
    if (!departamento || departamento === this.departamento) return;
    this.#datos = { ...this.#datos, departamento };
    this.#emitir();
    try {
      await this.#nube?.actualizarDepartamento(departamento);
    } catch (e) {
      console.warn('No se pudo guardar el departamento en el perfil:', e);
    }
  }

  limpiar() {
    this.#datos = null;
    this.#nube = null;
    this.#emitir();
  }

  #emitir() {
    this.dispatchEvent(new CustomEvent('cambio', { detail: this.datos }));
  }
}

/**
 * Deja `roles` y `rolActivo` en un estado siempre coherente, sea cual sea lo
 * que devuelva el servidor: perfiles desconocidos fuera, lista nunca vacía, y
 * un perfil activo que de verdad pertenezca a la lista.
 *
 * Ante la duda se cae al perfil MÍNIMO, nunca a uno amplio: si el dato llega
 * mal, que falle hacia el lado que no concede permisos.
 */
function normalizarRoles(remoto) {
  const roles = (Array.isArray(remoto?.roles) ? remoto.roles : [])
    .filter((r) => r in PERFILES);
  if (!roles.length) roles.push('equipo');

  const pedido = remoto?.rol_activo ?? remoto?.rolActivo;
  const rolActivo = roles.includes(pedido) ? pedido : roles[0];

  return { roles, rolActivo };
}

/** albert.mercado@redsalud.gob.cl → "Albert Mercado" */
export function nombreDesdeCorreo(correo) {
  const usuario = String(correo || '').split('@')[0];
  if (!usuario) return '';
  return usuario
    .replace(/[._-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(' ');
}

export const perfil = new Perfil();
