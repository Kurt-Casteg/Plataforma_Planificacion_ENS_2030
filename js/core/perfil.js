/**
 * Perfil de la persona que está usando la plataforma.
 *
 * Es la fuente única de verdad para nombre, correo y departamento. El
 * formulario los toma de aquí en lugar de pedirlos, y el servidor los vuelve a
 * imponer al guardar, así que lo que se muestre nunca puede contradecir lo que
 * quede en la base de datos.
 *
 * Sin sesión (modo local), el perfil queda vacío y el formulario vuelve a pedir
 * esos datos a mano, igual que antes.
 */

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
  get rol() { return this.#datos?.rol ?? 'equipo'; }
  get datos() { return this.#datos ? { ...this.#datos } : null; }

  /**
   * Adaptador de nube asociado a esta sesión, o null en modo local.
   * Se expone aquí para que nadie más tenga que ir pasándolo de mano en mano.
   */
  get nube() { return this.#nube; }

  /** ¿Puede ver y consolidar el trabajo de todos? */
  get esControlDeGestion() { return this.rol === 'control_gestion'; }

  /** ¿Falta que elija su departamento? (perfil básico, fuera de la nómina) */
  get necesitaDepartamento() { return this.identificado && !this.departamento; }

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
      rol: remoto?.rol || 'equipo'
    };

    this.#emitir();
    return this.datos;
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
