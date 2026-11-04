/**
 * Constructor de formularios declarativo.
 *
 * Recibe la definición de un plan y dibuja el formulario completo, resolviendo
 * dependencias entre campos, validación y modo edición. El HTML no contiene
 * ningún campo escrito a mano: por eso agregar o quitar campos es editar
 * `js/plans/index.js` y nada más.
 */

import { CONFIG } from '../../config.js';
import { el, render, vaciar, llenarSelect, llenarSelectAgrupado, debounce } from './dom.js';
import {
  MESES, IDS_MESES, SUBTITULOS, aNumero,
  normalizarActividad, validarActividad, revisarActividad, camposPendientes, nuevoId
} from './modelo.js';
import { aOpciones, indexarENS, opcionesClasificador, etiquetaDe } from './catalogos.js';
import { monto, numero, fechaEnPalabras, recortar } from './formato.js';
import { avisar } from './ui.js';
import { perfil } from './perfil.js';
import { ajustes } from './ajustes.js';

export class Formulario {
  /**
   * @param {object} opciones
   * @param {HTMLElement} opciones.contenedor
   * @param {object} opciones.plan       Definición del plan.
   * @param {object} opciones.catalogos  catalogos.json
   * @param {object} [opciones.ens]      Árbol ENS (solo si el plan lo usa).
   * @param {object} [opciones.indicadores]
   * @param {Function} opciones.alGuardar
   */
  constructor({ contenedor, plan, catalogos, ens, indicadores, clasificador, alGuardar, previsualizarCodigo }) {
    this.contenedor = contenedor;
    this.plan = plan;
    this.catalogos = catalogos;
    this.ens = ens ? indexarENS(ens) : null;
    this.indicadores = indicadores || {};
    this.clasificador = clasificador || { items: [] };
    this.compras = new Map();   // id de compra -> { nodo, campos }
    this.alGuardar = alGuardar;
    // Devuelve el próximo código estimado, solo para mostrarlo antes de guardar.
    this.previsualizarCodigo = previsualizarCodigo || (() => '');
    this.campos = new Map();   // id -> elemento de entrada
    this.editando = null;      // id de la actividad en edición
    this.#dibujar();
    this.aplicarPerfil();
    this.#capaInicial();
    // Si la sesión se resuelve después de dibujar el formulario, se rellena solo.
    this.__alCambiarPerfil = () => { this.aplicarPerfil(); this.#capaInicial(); };
    perfil.addEventListener('cambio', this.__alCambiarPerfil);
  }

  /** Libera el listener del perfil al reemplazar el formulario. */
  destruir() {
    perfil.removeEventListener('cambio', this.__alCambiarPerfil);
  }

  /* ---------------------------------------------------------------- */
  /* Dibujo                                                            */
  /* ---------------------------------------------------------------- */

  #dibujar() {
    const form = el('form', {
      class: 'formulario',
      id: 'formularioActividad',
      attrs: { novalidate: true, autocomplete: 'off' },
      // Con el circuito de aprobación hay dos botones de guardar: el que se
      // pulsó dice si la actividad va a revisión o queda como borrador.
      on: { submit: (e) => { e.preventDefault(); this.enviar(e.submitter?.dataset?.intencion || 'enviar'); } }
    });

    // Acordeón (3.16) o clásico (3.15): lo decide config.js.
    this.acordeon = CONFIG.formulario !== 'clasico';
    if (this.acordeon) form.classList.add('formulario--acordeon');

    this.avisoEdicion = el('div', { class: 'aviso-edicion', attrs: { hidden: true, role: 'status' } });
    if (this.acordeon) form.append(this.avisoEdicion);

    this.plan.secciones.forEach((seccion, i) => {
      form.append(this.#seccion(seccion, i + 1));
    });

    const acciones = el('div', { class: 'formulario__acciones' }, [
        el('button', {
          class: 'btn btn--primario btn--grande', attrs: { type: 'submit' }, id: 'btnGuardar',
          dataset: { intencion: 'enviar' }
        }, ['Guardar actividad']),
        el('button', {
          class: 'btn btn--secundario btn--grande', attrs: { type: 'submit', hidden: true }, id: 'btnBorrador',
          dataset: { intencion: 'borrador' }, text: 'Guardar como borrador'
        }),
        el('button', {
          class: 'btn btn--secundario', attrs: { type: 'button' },
          text: 'Limpiar formulario',
          on: { click: () => this.limpiar({ avisar: true }) }
        })
      ]);

    if (this.acordeon) {
      // Sexta capa: el resumen de las cinco y los botones de guardar.
      this.listaRevision = el('ol', { class: 'revision-capas' });
      form.append(this.#capa({
        numero: this.plan.secciones.length + 1,
        titulo: 'Revisar y guardar',
        descripcion: 'Revisa el resumen antes de guardar.',
        clase: 'capa--revision',
        contenido: [this.listaRevision, acciones]
      }));
      // En lugar del índice lateral, una barra de avance sobre las capas.
      this.indice = null;
      this.progreso = el('div', { class: 'acordeon__progreso', attrs: { role: 'status' } });
      render(this.contenedor, el('div', { class: 'formulario__marco formulario__marco--acordeon' }, [this.progreso, form]));
    } else {
      form.append(this.avisoEdicion, acciones);
      // Índice lateral con el avance de cada sección. La sección en la que se
      // está escribiendo se resalta y las demás se atenúan (modo enfoque).
      this.indice = el('nav', { class: 'indice-form', attrs: { 'aria-label': 'Secciones del formulario' } });
      render(this.contenedor, el('div', { class: 'formulario__marco' }, [this.indice, form]));
    }
    this.form = form;
    this.nodosSeccion = [...form.querySelectorAll(':scope > .seccion')];
    this.capasMarcadas = new Set();
    this.capaActiva = -1;
    this.#prepararEnfoque();
    this.#actualizarTotales();
    this.aplicarModoAprobacion();
    if (this.acordeon) this.#abrirCapa(this.#primeraPendiente(), { desplazar: false, animar: false });
  }

  /* ---------------------------------------------------------------- */
  /* Índice de secciones y sección activa                              */
  /* ---------------------------------------------------------------- */

  #prepararEnfoque() {
    const form = this.form;
    this.seccionActiva = -1;

    const recalcular = debounce(() => this.#pintarIndice(), 160);
    form.addEventListener('input', recalcular);
    form.addEventListener('change', recalcular);
    this.__recalcularIndice = recalcular;

    // El índice y las capas quedan bajo la cabecera, que también es fija: se
    // mide su alto para que no los tape.
    const medir = () => {
      const alto = document.querySelector('.cabecera')?.offsetHeight || 0;
      document.documentElement.style.setProperty('--alto-cabecera', `${alto}px`);
    };
    medir();
    addEventListener('resize', debounce(medir, 120));

    if (this.acordeon) {
      // Quien quiera llevar a un campo (el asistente, un error) avisa con
      // «revelar»: la capa que lo contiene se abre al instante.
      form.addEventListener('revelar', (e) => {
        const capa = e.target.closest?.('.capa');
        if (capa) this.#abrirCapa(Number(capa.dataset.seccion), { desplazar: false, animar: false });
      });
      return;
    }

    form.addEventListener('focusin', (e) => {
      const nodo = e.target.closest?.('.seccion');
      if (nodo) this.#activarSeccion(Number(nodo.dataset.seccion));
    });
    // Un clic en el texto de una sección (sin caer en un campo) también la activa.
    form.addEventListener('pointerdown', (e) => {
      const nodo = e.target.closest?.('.seccion');
      if (nodo) this.#activarSeccion(Number(nodo.dataset.seccion));
    });
    // Al salir del formulario, todo vuelve a verse igual.
    form.addEventListener('focusout', () => {
      setTimeout(() => {
        const activo = document.activeElement;
        if (!form.contains(activo) && !this.indice.contains(activo)) this.#activarSeccion(-1);
      }, 0);
    });
  }

  #activarSeccion(i) {
    if (i === this.seccionActiva) return;
    this.seccionActiva = i;
    this.form.classList.toggle('formulario--enfocado', i >= 0);
    this.nodosSeccion.forEach((n, j) => n.classList.toggle('seccion--activa', j === i));
    this.#pintarIndice();
  }

  /** Completa, en curso o pendiente, según lo que valida la propia plataforma. */
  #estadoSecciones() {
    const { errores } = validarActividad(this.leer(), this.plan);
    const claves = Object.keys(errores);
    return this.plan.secciones.map((seccion, i) => {
      const ids = new Set(seccion.campos.map((c) => c.id));
      // La cadena ENS es un solo bloque en la definición, pero valida nivel por nivel.
      if (ids.has('cadenaENS')) ['objetivoEstrategico', 'tema', 'objetivoImpacto', 'resultadoEsperado', 'resultadoInmediato'].forEach((x) => ids.add(x));
      const propia = (k) => ids.has(k.split('.')[0]) ||
        (ids.has('presupuesto') && /^(presupuesto|programatico|programa|pac)/.test(k));
      const conError = claves.some(propia);
      const nodo = this.nodosSeccion[i];
      const conValor = [...(nodo?.querySelectorAll('input, select, textarea') ?? [])].some((c) =>
        !c.readOnly && !c.disabled && c.type !== 'hidden' &&
        (c.type === 'checkbox' || c.type === 'radio' ? c.checked : c.value !== '' && c.value !== '0'));
      const estado = conError ? (conValor ? 'curso' : 'pendiente') : 'completa';
      return Object.assign(new String(estado), { faltas: claves.filter(propia).length });
    });
  }

  #pintarIndice() {
    if (!this.form) return;
    if (this.acordeon) { this.#pintarCapas(); return; }
    if (!this.indice) return;
    const estados = this.#estadoSecciones().map(String);
    const completas = estados.filter((e) => e === 'completa').length;
    const total = estados.length;
    const TEXTO = { completa: 'Completa', curso: 'En curso', pendiente: 'Pendiente' };

    render(this.indice,
      el('p', { class: 'indice-form__titulo', text: this.editando ? 'Editando actividad' : 'Nueva actividad' }),
      el('p', { class: 'indice-form__avance', text: `${numero(completas)} de ${numero(total)} secciones completas` }),
      el('div', { class: 'indice-form__barra', attrs: { 'aria-hidden': 'true' } }, [
        el('span', { style: { width: `${Math.round((completas / total) * 100)}%` } })
      ]),
      el('ol', { class: 'indice-form__lista' }, this.plan.secciones.map((seccion, i) => {
        const e = estados[i];
        const actual = i === this.seccionActiva;
        return el('li', {}, [
          el('button', {
            class: `indice-form__paso indice-form__paso--${e}${actual ? ' indice-form__paso--actual' : ''}`,
            attrs: { type: 'button', 'aria-current': actual ? 'step' : false },
            on: { click: () => this.#irASeccion(i) }
          }, [
            el('span', { class: 'indice-form__marca', attrs: { 'aria-hidden': 'true' }, text: e === 'completa' ? '✓' : String(i + 1) }),
            el('span', { class: 'indice-form__texto' }, [
              seccion.tituloCorto || seccion.titulo,
              el('span', { class: 'indice-form__estado', text: TEXTO[e] })
            ])
          ])
        ]);
      }))
    );
  }

  /* ---------------------------------------------------------------- */
  /* Acordeón por capas (3.16)                                         */
  /* ---------------------------------------------------------------- */

  /**
   * Una capa: cabecera que abre y cierra (con el resumen de lo llenado cuando
   * está recogida) y un pliegue con los campos. El pliegue anima su alto con
   * `grid-template-rows` (0fr ↔ 1fr), lo único que permite animar «hasta el
   * alto del contenido» sin medirlo. Recogida, la capa queda `inert`: Tab no
   * entra a campos que no se ven.
   */
  #capa({ numero, titulo, descripcion, contenido, clase = '', textoContinuar = '' }) {
    const i = numero - 1;
    const idPliegue = `capa-${this.plan.id}-${numero}`;
    const linea = el('span', { class: 'capa__linea', text: descripcion || '' });
    const estado = el('span', { class: 'capa__estado' });
    const marca = el('span', { class: 'seccion__numero capa__marca', text: String(numero), attrs: { 'aria-hidden': 'true' } });
    const boton = el('button', {
      class: 'capa__cabecera', attrs: { type: 'button', 'aria-expanded': 'false', 'aria-controls': idPliegue },
      on: { click: () => (this.capaActiva === i ? this.#abrirCapa(-1) : this.#abrirCapa(i)) }
    }, [
      marca,
      el('span', { class: 'capa__textos' }, [
        el('span', { class: 'seccion__titulo capa__titulo', text: titulo }),
        linea
      ]),
      estado,
      el('span', {
        class: 'capa__flecha', attrs: { 'aria-hidden': 'true' },
        html: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>'
      })
    ]);
    const interior = el('div', { class: 'capa__interior' }, [
      ...contenido,
      textoContinuar && el('div', { class: 'capa__pie' }, [
        el('button', {
          class: 'btn btn--primario', attrs: { type: 'button' }, text: textoContinuar,
          on: { click: () => this.#continuar(i) }
        })
      ])
    ].filter(Boolean));
    interior.inert = true;

    const nodo = el('section', {
      class: `seccion capa ${clase}`.trim(), id: `seccion-${this.plan.id}-${numero}`,
      dataset: { seccion: i }, attrs: { 'aria-labelledby': `${idPliegue}-titulo` }
    }, [
      el('h2', { class: 'capa__h', id: `${idPliegue}-titulo` }, [boton]),
      el('div', { class: 'capa__pliegue', id: idPliegue }, [interior])
    ]);
    nodo.__capa = { boton, linea, estado, marca, interior, descripcion: descripcion || '' };
    return nodo;
  }

  /** Abre una capa (y recoge las demás). -1 las recoge todas. */
  #abrirCapa(i, { desplazar = true, animar = true } = {}) {
    if (!this.acordeon || !this.form) return;
    this.capaActiva = i;
    this.form.classList.toggle('formulario--sin-animar', !animar);
    for (const nodo of this.nodosSeccion) {
      const j = Number(nodo.dataset.seccion);
      const abierta = j === i;
      nodo.classList.toggle('capa--abierta', abierta);
      nodo.__capa.boton.setAttribute('aria-expanded', String(abierta));
      nodo.__capa.interior.inert = !abierta;
    }
    if (!animar) requestAnimationFrame(() => this.form?.classList.remove('formulario--sin-animar'));
    this.#pintarCapas();
    const nodo = this.nodosSeccion[i];
    if (!nodo || !desplazar) return;

    // La capa que se abre queda arriba, bajo la cabecera de la página. Las
    // que se recogen encima cambian de alto mientras tanto, así que al
    // terminar se corrige el destino si quedó corto.
    const suave = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    const ir = () => nodo.scrollIntoView({ behavior: suave ? 'smooth' : 'auto', block: 'start' });
    setTimeout(ir, 40);
    const pliegue = nodo.querySelector('.capa__pliegue');
    const alTerminar = (e) => {
      if (e.target !== pliegue) return;
      pliegue.removeEventListener('transitionend', alTerminar);
      const arriba = nodo.getBoundingClientRect().top;
      const destino = (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--alto-cabecera')) || 0) + 16;
      if (Math.abs(arriba - destino) > 12) ir();
    };
    pliegue.addEventListener('transitionend', alTerminar);
  }

  /**
   * Con un formulario nuevo y sin tocar, la capa abierta es la primera con
   * algo pendiente. Se recalcula cuando llega la sesión, que completa sola la
   * identificación.
   */
  #capaInicial() {
    if (!this.acordeon || this.editando || this.capasMarcadas.size) return;
    const i = this.#primeraPendiente();
    if (i !== this.capaActiva) this.#abrirCapa(i, { desplazar: false, animar: false });
  }

  /** «Continuar»: deja marcada la capa (completa o con faltas) y abre la siguiente. */
  #continuar(i) {
    this.capasMarcadas.add(i);
    this.#abrirCapa(i + 1);
  }

  /** La primera capa con algo pendiente; si no hay, la de revisar y guardar. */
  #primeraPendiente() {
    const estados = this.#estadoSecciones();
    const i = estados.findIndex((e) => String(e) !== 'completa');
    return i >= 0 ? i : this.plan.secciones.length;
  }

  /** Resumen de una sección recogida: lo que alguien quiere ver sin abrirla. */
  #resumenDe(seccion, a) {
    const ids = new Set(seccion.campos.map((c) => c.id));
    if (ids.has('cronograma')) {
      const total = a.totales.cronograma;
      if (!total) return 'Sin meses de ejecución';
      const con = MESES.filter((m) => (a.cronograma?.[m.id] || 0) > 0);
      const rango = con.length === 1 ? con[0].largo.toLowerCase() : `${con[0].largo.toLowerCase()} a ${con[con.length - 1].largo.toLowerCase()}`;
      return `${numero(total)} ejecuci${total === 1 ? 'ón' : 'ones'} · ${rango}`;
    }
    if (ids.has('presupuesto')) {
      if (a.sinPresupuesto) return 'No requiere presupuesto';
      if (!a.totales.presupuesto) return 'Sin montos todavía';
      const partes = [monto(a.totales.presupuesto)];
      if (a.totales.presupuesto21) partes.push(`ST21 ${monto(a.totales.presupuesto21)}`);
      if (a.totales.presupuesto22) partes.push(`ST22 ${monto(a.totales.presupuesto22)}`);
      const n = a.pac?.aplica ? a.pac.compras.length : 0;
      if (n) partes.push(`${n} compra${n > 1 ? 's' : ''} en el PAC`);
      return partes.join(' · ');
    }
    if (ids.has('cadenaENS')) {
      if (!a.resultadoInmediato) return 'Sin resultado inmediato todavía';
      let texto = '';
      const v = { oe: a.objetivoEstrategico, tema: a.tema, oi: a.objetivoImpacto, re: a.resultadoEsperado, ri: a.resultadoInmediato };
      try { texto = this.ens?.nombreDe('resultadoInmediato', v) || ''; } catch { /* sin índice */ }
      return recortar(`RI ${a.resultadoInmediato}${texto ? ` · ${texto}` : ''}`, 110);
    }
    if (ids.has('nombreActividad')) {
      const nombre = a.nombreActividad || 'Sin nombre';
      return `${recortar(nombre, 70)} · ${a.medioVerificacion ? `verificación: ${recortar(a.medioVerificacion, 40)}` : 'sin medio de verificación'}`;
    }
    if (ids.has('departamento')) {
      return [
        etiquetaDe(this.catalogos?.departamentos ?? [], a.departamento) || 'Sin departamento',
        a.responsable,
        a.codigoActividad ? `N° ${a.codigoActividad}` : 'código automático'
      ].filter(Boolean).join(' · ');
    }
    // Otras secciones (por ejemplo, «Objetivos y producto» del PGI): los textos.
    const textos = seccion.campos.map((c) => a[c.id]).filter((v) => typeof v === 'string' && v.trim());
    return textos.length ? recortar(textos.join(' · '), 110) : 'Sin completar';
  }

  #pintarCapas() {
    if (!this.acordeon || !this.form) return;
    const a = this.leer();
    const estados = this.#estadoSecciones();
    const total = this.plan.secciones.length;
    const TEXTO = { completa: 'Completa', curso: 'En curso', pendiente: 'Pendiente' };
    let completas = 0;
    const filas = [];

    this.plan.secciones.forEach((seccion, i) => {
      const nodo = this.nodosSeccion[i];
      if (!nodo?.__capa) return;
      const base = String(estados[i]);
      const faltas = estados[i].faltas;
      const e = base !== 'completa' && this.capasMarcadas.has(i) ? 'falta' : base;
      if (base === 'completa') completas += 1;
      const resumen = this.#resumenDe(seccion, a);
      const { linea, estado, marca } = nodo.__capa;
      const abierta = i === this.capaActiva;
      linea.textContent = abierta ? nodo.__capa.descripcion : resumen;
      estado.className = `capa__estado capa__estado--${e}`;
      estado.textContent = e === 'falta' ? `Falta${faltas === 1 ? '' : 'n'} ${numero(faltas || 1)} dato${faltas === 1 ? '' : 's'}` : TEXTO[e];
      marca.textContent = e === 'completa' ? '✓' : e === 'falta' ? '!' : String(i + 1);
      nodo.dataset.estado = e;
      filas.push(el('li', { class: `revision-capas__fila revision-capas__fila--${e}` }, [
        el('span', { class: 'revision-capas__icono', attrs: { 'aria-hidden': 'true' }, text: e === 'completa' ? '✓' : '!' }),
        el('span', { class: 'revision-capas__texto' }, [
          el('span', { class: 'revision-capas__titulo', text: seccion.titulo }),
          el('span', { class: 'revision-capas__linea', text: resumen })
        ]),
        el('button', {
          class: 'btn btn--texto', attrs: { type: 'button', 'aria-label': `${e === 'completa' ? 'Revisar' : 'Completar'} ${seccion.titulo}` },
          text: e === 'completa' ? 'Revisar' : 'Completar',
          on: { click: () => this.#abrirCapa(i) }
        })
      ]));
    });

    // Sexta capa: resumen y estado general.
    const rev = this.nodosSeccion[total];
    if (rev?.__capa) {
      const faltan = total - completas;
      const abierta = this.capaActiva === total;
      rev.__capa.linea.textContent = abierta ? rev.__capa.descripcion
        : faltan ? `${numero(faltan)} ${faltan === 1 ? 'sección' : 'secciones'} por completar` : 'Todo listo para guardar';
      rev.__capa.estado.className = `capa__estado capa__estado--${faltan ? 'antes' : 'completa'}`;
      rev.__capa.estado.textContent = faltan ? 'Antes de guardar' : 'Lista';
      rev.__capa.marca.textContent = '★';
      render(this.listaRevision, ...filas);
    }

    if (this.progreso) {
      render(this.progreso,
        el('div', { class: 'acordeon__progreso-texto' }, [
          el('span', { class: 'acordeon__progreso-titulo', text: this.editando ? 'Editando actividad' : 'Nueva actividad' }),
          el('span', { text: `${numero(completas)} de ${numero(total)} secciones completas` })
        ]),
        el('div', { class: 'indice-form__barra', attrs: { 'aria-hidden': 'true' } }, [
          el('span', { style: { width: `${Math.round((completas / total) * 100)}%` } })
        ])
      );
    }
  }

  /** Lleva a una sección y deja el cursor en su primer campo editable. */
  #irASeccion(i) {
    const nodo = this.nodosSeccion[i];
    if (!nodo) return;
    const suave = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    nodo.scrollIntoView({ behavior: suave ? 'smooth' : 'auto', block: 'start' });
    const campo = [...nodo.querySelectorAll('input, select, textarea, button')]
      .find((c) => !c.disabled && !c.readOnly && c.type !== 'hidden' && c.offsetParent !== null);
    this.#activarSeccion(i);
    campo?.focus({ preventScroll: true });
  }

  /**
   * Ajusta los botones al circuito de aprobación. Encendido: «Guardar y
   * enviar a revisión» y «Guardar como borrador». Apagado: el botón de siempre.
   * Una actividad ya aprobada (solo Control de Gestión puede editarla) conserva
   * su estado: se ofrece solo «Actualizar actividad».
   */
  aplicarModoAprobacion() {
    const principal = this.form?.querySelector('#btnGuardar');
    const borrador = this.form?.querySelector('#btnBorrador');
    if (!principal || !borrador) return;
    const editando = Boolean(this.editando);
    const circuito = ajustes.circuitoActivo && this.estadoCargado !== 'aprobada';
    borrador.hidden = !circuito;
    principal.textContent = circuito
      ? (editando ? 'Actualizar y enviar a revisión' : 'Guardar y enviar a revisión')
      : (editando ? 'Actualizar actividad' : 'Guardar actividad');
  }

  #seccion(seccion, numero) {
    const cuerpo = el('div', { class: 'seccion__cuerpo' });
    for (const campo of seccion.campos) cuerpo.append(this.#campo(campo));

    if (this.acordeon) {
      const siguiente = this.plan.secciones[numero];
      return this.#capa({
        numero, titulo: seccion.titulo, descripcion: seccion.descripcion,
        contenido: [cuerpo],
        textoContinuar: `Continuar con «${siguiente ? siguiente.titulo : 'Revisar y guardar'}» ›`
      });
    }

    return el('section', { class: 'seccion', id: `seccion-${this.plan.id}-${numero}`, dataset: { seccion: numero - 1 } }, [
      el('header', { class: 'seccion__cabecera' }, [
        el('span', { class: 'seccion__numero', text: numero, attrs: { 'aria-hidden': 'true' } }),
        el('div', {}, [
          el('h2', { class: 'seccion__titulo', text: seccion.titulo }),
          seccion.descripcion && el('p', { class: 'seccion__descripcion', text: seccion.descripcion })
        ])
      ]),
      cuerpo
    ]);
  }

  #campo(campo) {
    switch (campo.tipo) {
      case 'automatico': return this.#campoAutomatico(campo);
      case 'cadenaENS': return this.#cadenaENS();
      case 'cronograma': return this.#cronograma();
      case 'presupuesto': return this.#presupuesto();
      default: return this.#campoSimple(campo);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Campos simples                                                    */
  /* ---------------------------------------------------------------- */

  #envoltura(campo, control, extras = []) {
    const idError = `${campo.id}-error`;
    const error = el('p', { class: 'campo__error', id: idError, attrs: { hidden: true, role: 'alert' } });
    control.setAttribute('aria-describedby', [campo.ayuda ? `${campo.id}-ayuda` : '', idError].filter(Boolean).join(' '));

    const grupo = el('div', { class: `campo campo--${campo.ancho || 'medio'}`, dataset: { campo: campo.id } }, [
      el('label', { class: 'campo__etiqueta', text: campo.etiqueta, attrs: { for: campo.id } }, [
        campo.requerido ? el('span', { class: 'campo__requerido', text: ' *', attrs: { 'aria-label': 'obligatorio' } }) : null
      ]),
      control,
      campo.ayuda && el('p', { class: 'campo__ayuda', id: `${campo.id}-ayuda`, text: campo.ayuda }),
      error,
      ...extras
    ]);
    grupo.__error = error;
    return grupo;
  }

  #campoSimple(campo) {
    let control;
    if (campo.tipo === 'select') {
      control = el('select', { class: 'campo__control', id: campo.id, name: campo.id });
      llenarSelect(control, aOpciones(this.catalogos[campo.catalogo] || []), { placeholder: 'Seleccionar…' });
    } else if (campo.tipo === 'textoLargo') {
      control = el('textarea', {
        class: 'campo__control campo__control--area', id: campo.id, name: campo.id,
        attrs: { rows: campo.filas || 3, placeholder: campo.placeholder || '', maxlength: 3000 }
      });
    } else {
      control = el('input', {
        class: 'campo__control', id: campo.id, name: campo.id,
        attrs: {
          type: campo.tipo === 'correo' ? 'email' : 'text',
          placeholder: campo.placeholder || '',
          maxlength: 300,
          inputmode: campo.inputMode || null
        }
      });
    }

    control.addEventListener('input', () => this.#limpiarError(campo.id));
    control.addEventListener('change', () => this.#limpiarError(campo.id));
    this.campos.set(campo.id, control);

    const extras = [];
    if (campo.ayudaExtendida) extras.push(this.#ayudaExtendida(campo.ayudaExtendida));
    return this.#envoltura(campo, control, extras);
  }

  /**
   * Campo que la plataforma completa sola y la persona no edita.
   * Se muestra deshabilitado para dejar claro que no hay nada que escribir,
   * pero su valor sí viaja al guardar porque se lee del elemento, no del envío
   * nativo del formulario.
   */
  #campoAutomatico(campo) {
    const control = el('input', {
      class: 'campo__control campo__control--automatico', id: campo.id, name: campo.id,
      attrs: { type: 'text', readonly: true, 'aria-readonly': 'true', tabindex: '-1' }
    });
    this.campos.set(campo.id, control);
    return this.#envoltura(campo, control);
  }

  /**
   * Vuelca los datos de la sesión en los campos que se completan solos.
   *
   * Solo actúa sobre una actividad NUEVA. Al editar se respeta lo que quedó
   * guardado: si Control de Gestión abre la actividad de otra persona, no debe
   * reemplazarle el responsable por el suyo.
   */
  aplicarPerfil() {
    if (this.editando) return;

    for (const campo of this.plan.secciones.flatMap((s) => s.campos)) {
      if (!campo.autoDesde) continue;
      const control = this.campos.get(campo.id);
      if (!control) continue;

      const valor = perfil[campo.autoDesde] || '';
      const grupo = this.form?.querySelector(`[data-campo="${CSS.escape(campo.id)}"]`);

      if (perfil.identificado && valor) {
        control.value = valor;
        // Se recuerda qué valor puso la sesión, para poder retirarlo si el
        // perfil cambia (por ejemplo, al cerrar sesión o entrar con otra cuenta).
        control.dataset.desdePerfil = valor;
        this.#bloquear(control, true);
        this.#marcarAutomatico(grupo, 'Desde tu sesión');
      } else {
        // El perfil ya no aporta este dato: se limpia solo si lo había puesto
        // la sesión anterior, nunca lo que la persona escribió a mano.
        if (control.dataset.desdePerfil && control.value === control.dataset.desdePerfil) {
          control.value = '';
        }
        delete control.dataset.desdePerfil;
        this.#bloquear(control, false);
        this.#marcarAutomatico(grupo, null, campo.ayudaSinPerfil);
      }
    }

    this.#refrescarCodigo();
  }

  /** Deshabilita o rehabilita un control conservando su valor. */
  #bloquear(control, bloqueado) {
    if (control.tagName === 'SELECT') control.disabled = bloqueado;
    else control.readOnly = bloqueado;
    control.classList.toggle('campo__control--automatico', bloqueado);
    if (bloqueado) control.setAttribute('aria-readonly', 'true');
    else control.removeAttribute('aria-readonly');
  }

  /** Pone o quita la insignia "Desde tu sesión" junto a la etiqueta. */
  #marcarAutomatico(grupo, texto, ayudaAlternativa) {
    if (!grupo) return;
    grupo.querySelector('.campo__insignia')?.remove();
    grupo.querySelector('.campo__ayuda--perfil')?.remove();

    if (texto) {
      grupo.querySelector('.campo__etiqueta')
        ?.append(el('span', { class: 'campo__insignia', text: texto }));
    } else if (ayudaAlternativa) {
      grupo.append(el('p', { class: 'campo__ayuda campo__ayuda--perfil', text: ayudaAlternativa }));
    }
  }

  /** Muestra el código que se asignará, o el ya asignado si se está editando. */
  #refrescarCodigo() {
    const control = this.campos.get('codigoActividad');
    if (!control || this.editando) return;
    const proximo = this.previsualizarCodigo();
    control.value = '';
    control.placeholder = proximo ? `Automático · N° ${proximo}` : 'Automático';
  }

  #ayudaExtendida(clave) {
    const items = this.catalogos[clave] || [];
    return el('details', { class: 'ayuda-extendida' }, [
      el('summary', { text: 'Ver tipos de medio de verificación y qué debe incluir cada uno' }),
      el('dl', { class: 'ayuda-extendida__lista' },
        items.flatMap((i) => [
          el('dt', { text: i.tipo }),
          el('dd', { text: i.detalle })
        ])
      )
    ]);
  }

  /* ---------------------------------------------------------------- */
  /* Cadena de resultados ENS (selects dependientes)                   */
  /* ---------------------------------------------------------------- */

  #cadenaENS() {
    const niveles = [
      { id: 'objetivoEstrategico', etiqueta: 'Objetivo estratégico (OE)', vacio: 'Seleccionar objetivo…' },
      { id: 'tema', etiqueta: 'Tema', vacio: 'Primero selecciona un objetivo' },
      { id: 'objetivoImpacto', etiqueta: 'Objetivo de impacto (OI)', vacio: 'Primero selecciona un tema' },
      { id: 'resultadoEsperado', etiqueta: 'Resultado esperado (RE)', vacio: 'Primero selecciona un OI' },
      { id: 'resultadoInmediato', etiqueta: 'Resultado inmediato (RI)', vacio: 'Primero selecciona un RE', requerido: true }
    ];

    const contenedor = el('div', { class: 'cadena' });
    const detalle = el('div', { class: 'cadena__detalle', attrs: { hidden: true } });

    for (const nivel of niveles) {
      const select = el('select', { class: 'campo__control', id: nivel.id, name: nivel.id });
      llenarSelect(select, [], { placeholder: nivel.vacio, deshabilitado: nivel.id !== 'objetivoEstrategico' });
      select.addEventListener('change', () => {
        this.#limpiarError(nivel.id);
        this.#actualizarCadena(nivel.id);
      });
      this.campos.set(nivel.id, select);
      contenedor.append(this.#envoltura(
        { ...nivel, ancho: nivel.id === 'resultadoInmediato' ? 'completo' : 'medio' },
        select
      ));
    }

    this.detalleENS = detalle;
    // Carga inicial de objetivos estratégicos.
    llenarSelect(this.campos.get('objetivoEstrategico'),
      this.ens.objetivosEstrategicos.map((o) => ({ value: o.codigo, label: `${o.codigo}. ${o.nombre}` })),
      { placeholder: 'Seleccionar objetivo…' });

    return el('div', { class: 'campo campo--completo' }, [contenedor, detalle]);
  }

  #actualizarCadena(desde) {
    const v = (id) => this.campos.get(id).value;
    const orden = ['objetivoEstrategico', 'tema', 'objetivoImpacto', 'resultadoEsperado', 'resultadoInmediato'];
    const idx = orden.indexOf(desde);

    // Reinicia los niveles inferiores.
    for (const id of orden.slice(idx + 1)) {
      llenarSelect(this.campos.get(id), [], { placeholder: 'Selecciona el nivel anterior', deshabilitado: true });
    }

    if (desde === 'objetivoEstrategico' && v('objetivoEstrategico')) {
      llenarSelect(this.campos.get('tema'),
        this.ens.temasDe(v('objetivoEstrategico')).map((t) => ({ value: t.nombre, label: t.nombre })),
        { placeholder: 'Seleccionar tema…' });
    }
    if (desde === 'tema' && v('tema')) {
      llenarSelect(this.campos.get('objetivoImpacto'),
        this.ens.objetivosImpactoDe(v('objetivoEstrategico'), v('tema'))
          .map((o) => ({ value: o.codigo, label: `${o.codigo} — ${o.nombre}` })),
        { placeholder: 'Seleccionar objetivo de impacto…' });
    }
    if (desde === 'objetivoImpacto' && v('objetivoImpacto')) {
      llenarSelect(this.campos.get('resultadoEsperado'),
        this.ens.resultadosEsperadosDe(v('objetivoEstrategico'), v('tema'), v('objetivoImpacto'))
          .map((r) => ({ value: r.codigo, label: `${r.codigo} — ${r.nombre}` })),
        { placeholder: 'Seleccionar resultado esperado…' });
    }
    if (desde === 'resultadoEsperado' && v('resultadoEsperado')) {
      llenarSelect(this.campos.get('resultadoInmediato'),
        this.ens.resultadosInmediatosDe(v('objetivoEstrategico'), v('tema'), v('objetivoImpacto'), v('resultadoEsperado'))
          .map((r) => ({ value: r.codigo, label: `${r.codigo} — ${r.nombre}` })),
        { placeholder: 'Seleccionar resultado inmediato…' });
    }

    this.#mostrarContextoENS();
  }

  /** Muestra el texto completo del RI y el indicador oficial del RE seleccionado. */
  #mostrarContextoENS() {
    const v = (id) => this.campos.get(id).value;
    const caja = this.detalleENS;
    if (!caja) return;
    vaciar(caja);

    const codRE = v('resultadoEsperado');
    const codRI = v('resultadoInmediato');
    if (!codRE && !codRI) { caja.hidden = true; return; }

    const partes = [];

    if (codRI) {
      const nombre = this.ens.nombreDe('resultadoInmediato', {
        oe: v('objetivoEstrategico'), tema: v('tema'), oi: v('objetivoImpacto'), re: codRE, ri: codRI
      });
      partes.push(el('div', { class: 'ficha' }, [
        el('h3', { class: 'ficha__titulo', text: `Resultado inmediato ${codRI}` }),
        el('p', { class: 'ficha__texto', text: nombre })
      ]));
    }

    const indicadores = this.indicadores[codRE];
    if (indicadores?.length) {
      partes.push(el('div', { class: 'ficha ficha--indicador' }, [
        el('h3', { class: 'ficha__titulo', text: `Indicador${indicadores.length > 1 ? 'es' : ''} del resultado esperado ${codRE}` }),
        ...indicadores.map((i) => el('div', { class: 'ficha__indicador' }, [
          el('p', { class: 'ficha__texto ficha__texto--fuerte', text: i.nombre }),
          el('dl', { class: 'ficha__meta' }, [
            i.lineaBase && el('div', {}, [el('dt', { text: `Línea base ${i.anioLineaBase || ''}`.trim() }), el('dd', { text: i.lineaBase })]),
            i.meta2030 && el('div', {}, [el('dt', { text: 'Meta 2030' }), el('dd', { text: i.meta2030 })]),
            i.periodicidad && el('div', {}, [el('dt', { text: 'Periodicidad' }), el('dd', { text: i.periodicidad })]),
            i.fuente && el('div', {}, [el('dt', { text: 'Fuente' }), el('dd', { text: i.fuente })])
          ].filter(Boolean))
        ]))
      ]));
    }

    if (!partes.length) { caja.hidden = true; return; }
    caja.hidden = false;
    caja.append(...partes);
  }

  /* ---------------------------------------------------------------- */
  /* Cronograma                                                        */
  /* ---------------------------------------------------------------- */

  #cronograma() {
    const grilla = el('div', { class: 'meses', attrs: { role: 'group', 'aria-label': 'Cronograma mensual' } });

    for (const mes of MESES) {
      const input = el('input', {
        class: 'meses__entrada', id: `cron-${mes.id}`, name: `cron-${mes.id}`,
        attrs: { type: 'text', inputmode: 'numeric', placeholder: '0', 'aria-label': `${mes.largo}: cantidad de ejecuciones` }
      });
      input.addEventListener('input', () => this.#actualizarTotales());
      input.addEventListener('blur', () => { input.value = input.value.trim() ? String(aNumero(input.value)) : ''; });
      this.campos.set(`cron-${mes.id}`, input);
      grilla.append(el('div', { class: 'meses__celda' }, [
        el('label', { class: 'meses__etiqueta', text: mes.corto, attrs: { for: `cron-${mes.id}` } }),
        input
      ]));
    }

    this.totalCronograma = el('output', { class: 'total__valor', text: '0', attrs: { for: 'cronograma' } });
    this.errorCronograma = el('p', { class: 'campo__error', attrs: { hidden: true, role: 'alert' } });

    return el('div', { class: 'campo campo--completo', dataset: { campo: 'cronograma' } }, [
      grilla,
      el('div', { class: 'total' }, [
        el('span', { class: 'total__etiqueta', text: 'Total anual de ejecuciones' }),
        this.totalCronograma
      ]),
      this.errorCronograma,
      el('div', { class: 'nota nota--info' }, [
        el('p', { text: 'Ingresa la cantidad de veces que ejecutarás la actividad en cada mes. Deja en blanco los meses sin ejecución.' })
      ])
    ]);
  }

  /* ---------------------------------------------------------------- */
  /* Presupuesto                                                       */
  /* ---------------------------------------------------------------- */

  #presupuesto() {
    const sin = el('input', {
      class: 'interruptor__entrada', id: 'sinPresupuesto', name: 'sinPresupuesto',
      attrs: { type: 'checkbox' }
    });
    sin.addEventListener('change', () => this.#alternarPresupuesto());
    this.campos.set('sinPresupuesto', sin);

    this.bloquesPresupuesto = el('div', { class: 'presupuesto__bloques' });

    for (const st of SUBTITULOS) {
      const meta = this.catalogos.subtitulos.find((s) => s.id === st);

      const programatico = el('select', { class: 'campo__control', id: `programatico${st}`, name: `programatico${st}` });
      llenarSelect(programatico, aOpciones(this.catalogos.categoriasProgramaticas), { placeholder: 'Seleccionar…' });

      const programa = el('select', { class: 'campo__control', id: `programa${st}`, name: `programa${st}` });
      llenarSelect(programa, [], { placeholder: 'Primero selecciona la categoría', deshabilitado: true });

      programatico.addEventListener('change', () => {
        this.#limpiarError(`programatico${st}`);
        const lista = this.catalogos.programasPorCategoria[programatico.value] || [];
        llenarSelect(programa, lista, {
          placeholder: lista.length ? 'Seleccionar programa…' : 'Sin programas para esta categoría',
          deshabilitado: !lista.length
        });
      });
      programa.addEventListener('change', () => this.#limpiarError(`programa${st}`));

      this.campos.set(`programatico${st}`, programatico);
      this.campos.set(`programa${st}`, programa);

      const grilla = el('div', { class: 'meses', attrs: { role: 'group', 'aria-label': `Presupuesto mensual subtítulo ${st}` } });
      for (const mes of MESES) {
        const input = el('input', {
          class: 'meses__entrada', id: `pres-${st}-${mes.id}`, name: `pres-${st}-${mes.id}`,
          attrs: { type: 'text', inputmode: 'decimal', placeholder: '0', 'aria-label': `${mes.largo}, subtítulo ${st}, en miles de pesos` }
        });
        input.addEventListener('input', () => this.#actualizarTotales());
        input.addEventListener('blur', () => { input.value = input.value.trim() ? String(aNumero(input.value)) : ''; });
        this.campos.set(`pres-${st}-${mes.id}`, input);
        grilla.append(el('div', { class: 'meses__celda' }, [
          el('label', { class: 'meses__etiqueta', text: mes.corto, attrs: { for: `pres-${st}-${mes.id}` } }),
          input
        ]));
      }

      const total = el('output', { class: 'total__valor', text: monto(0) });
      this[`totalST${st}`] = total;

      this.bloquesPresupuesto.append(el('article', { class: 'subtitulo', dataset: { st } }, [
        el('header', { class: 'subtitulo__cabecera' }, [
          el('h3', { class: 'subtitulo__titulo', text: meta.nombre }),
          el('p', { class: 'subtitulo__descripcion', text: meta.descripcion })
        ]),
        el('div', { class: 'subtitulo__clasificacion' }, [
          this.#envoltura({ id: `programatico${st}`, etiqueta: 'Categoría programática' }, programatico),
          this.#envoltura({ id: `programa${st}`, etiqueta: 'Programa' }, programa)
        ]),
        grilla,
        el('div', { class: 'total' }, [
          el('span', { class: 'total__etiqueta', text: `Total subtítulo ${st}` }),
          total
        ]),
        // El Plan Anual de Compras solo aplica al subtítulo 22.
        st === '22' ? this.#bloquePac() : null
      ].filter(Boolean)));
    }

    this.totalPresupuesto = el('output', { class: 'total__valor total__valor--destacado', text: monto(0) });
    this.errorPresupuesto = el('p', { class: 'campo__error', attrs: { hidden: true, role: 'alert' } });

    return el('div', { class: 'campo campo--completo', dataset: { campo: 'presupuesto' } }, [
      el('label', { class: 'interruptor' }, [
        sin,
        el('span', { class: 'interruptor__control', attrs: { 'aria-hidden': 'true' } }),
        el('span', { class: 'interruptor__texto', text: 'Esta actividad no requiere presupuesto' })
      ]),
      el('div', { class: 'nota nota--info' }, [
        el('p', {}, [
          el('strong', { text: 'Los montos se expresan en miles de pesos. ' }),
          'Si escribes 1 equivale a $1.000; si escribes 1.000 equivale a $1.000.000.'
        ])
      ]),
      this.bloquesPresupuesto,
      el('div', { class: 'total total--general' }, [
        el('span', { class: 'total__etiqueta', text: 'Total presupuesto de la actividad' }),
        this.totalPresupuesto
      ]),
      this.errorPresupuesto
    ]);
  }

  /* ---------------------------------------------------------------- */
  /* Plan Anual de Compras (PAC)                                       */
  /* ---------------------------------------------------------------- */

  /**
   * Bloque plegable dentro del subtítulo 22.
   *
   * Se puede registrar más de una compra por actividad: una capacitación puede
   * necesitar impresión y además contratar al relator, y cada línea va a un
   * clasificador presupuestario distinto en el Plan Anual de Compras.
   */
  #bloquePac() {
    const interruptor = el('input', {
      class: 'interruptor__entrada', id: 'pacAplica', name: 'pacAplica',
      attrs: { type: 'checkbox' }
    });
    interruptor.addEventListener('change', () => {
      this.#alternarPac();
      // Al activarlo por primera vez se ofrece una compra ya abierta.
      if (interruptor.checked && !this.compras.size) this.#agregarCompra();
    });
    this.campos.set('pacAplica', interruptor);

    this.listaCompras = el('div', { class: 'pac__lista' });

    this.conciliacion = el('p', { class: 'pac__conciliacion', attrs: { hidden: true, role: 'status' } });
    this.errorPac = el('p', { class: 'campo__error', attrs: { hidden: true, role: 'alert' } });

    // Explica por qué el interruptor no se puede apagar. Sin esto, un control
    // bloqueado parece una falla.
    this.avisoPacObligatorio = el('p', {
      class: 'pac__obligatorio', attrs: { hidden: true, role: 'status' },
      text: 'Obligatorio: la actividad tiene presupuesto en el subtítulo 22. '
        + 'Registra qué se comprará, con los seis datos de cada compra.'
    });

    this.cuerpoPac = el('div', { class: 'pac__cuerpo', attrs: { hidden: true } }, [
      el('div', { class: 'nota nota--info' }, [
        el('p', {}, [
          'Registra cada producto o servicio que se comprará. ',
          el('strong', { text: 'Los montos van en miles de pesos' }),
          ', igual que el presupuesto de arriba.'
        ])
      ]),

      this.listaCompras,

      // Las dos fechas se confunden con facilidad y la diferencia entre ellas
      // es justamente el tiempo que demora una compra pública.
      el('div', { class: 'nota nota--info nota--fechas' }, [
        el('p', { class: 'nota__titulo', text: 'Las dos fechas no son lo mismo' }),
        el('dl', { class: 'nota__lista' }, [
          el('dt', { text: 'Fecha estimada de compra o contratación' }),
          el('dd', { text: 'Cuándo debes presentar tu solicitud de compra, para alcanzar a tener los insumos o el servicio disponibles.' }),
          el('dt', { text: 'Fecha estimada de ejecución' }),
          el('dd', { text: 'Cuándo estarás realizando la actividad, ya con esos insumos en tu poder.' })
        ]),
        el('p', { class: 'nota__cierre', text: 'Por eso la solicitud de compra debe ir antes que la ejecución, con el margen que necesite el proceso.' })
      ]),

      el('div', { class: 'pac__pie' }, [
        el('button', {
          class: 'btn btn--secundario', attrs: { type: 'button' },
          text: '+ Agregar compra',
          on: { click: () => this.#agregarCompra({ enfocar: true }) }
        }),
        this.conciliacion
      ]),
      this.errorPac
    ]);

    this.bloquePac = el('div', { class: 'pac', dataset: { campo: 'pac' } }, [
      el('label', { class: 'interruptor interruptor--pac' }, [
        interruptor,
        el('span', { class: 'interruptor__control', attrs: { 'aria-hidden': 'true' } }),
        el('span', { class: 'interruptor__texto' }, [
          'Esta actividad forma parte del Plan Anual de Compras (PAC)',
          el('span', { class: 'interruptor__ayuda', text: 'Se activa solo cuando la actividad tiene presupuesto en el subtítulo 22.' })
        ])
      ]),
      this.avisoPacObligatorio,
      this.cuerpoPac
    ]);
    return this.bloquePac;
  }

  /**
   * Con presupuesto en el subtítulo 22 el PAC es obligatorio.
   *
   * Se llama cada vez que cambia un monto, así que responde en el momento en
   * que la persona escribe la primera cifra del 22: el bloque se abre solo,
   * ofrece la primera compra, marca los seis datos como obligatorios y el
   * interruptor queda fijo —no se puede apagar mientras haya monto—.
   *
   * Y al revés: si la persona borra el monto del 22 y el PAC se había abierto
   * solo sin que alcanzara a escribir nada, se vuelve a cerrar. Sin esto, una
   * cifra puesta por error y corregida dejaba una compra vacía que impedía
   * guardar con errores sobre un PAC que nadie pidió.
   */
  #sincronizarPacObligatorio() {
    const interruptor = this.campos.get('pacAplica');
    if (!interruptor || !this.bloquePac) return;

    const sinPresupuesto = this.campos.get('sinPresupuesto')?.checked;
    const totalST22 = IDS_MESES.reduce((a, m) => a + aNumero(this.campos.get(`pres-22-${m}`)?.value), 0);
    const obligatorio = !sinPresupuesto && totalST22 > 0;

    this.bloquePac.classList.toggle('pac--obligatorio', obligatorio);
    this.avisoPacObligatorio.hidden = !obligatorio;
    interruptor.disabled = obligatorio || Boolean(sinPresupuesto);

    if (obligatorio) {
      if (!interruptor.checked) {
        interruptor.checked = true;
        this.pacAbiertoSolo = true;
        this.#alternarPac();
      }
      if (!this.compras.size) this.#agregarCompra();
      return;
    }

    // Dejó de ser obligatorio. Solo se deshace lo que hizo la plataforma, y
    // solo si sigue intacto: una compra con cualquier dato escrito se respeta.
    if (this.pacAbiertoSolo && interruptor.checked) {
      const intactas = this.#leerCompras().every((c) =>
        !c.clasificador && !c.producto && !c.cantidad && !c.fechaCompra && !c.fechaEjecucion && !c.monto && !c.criticaSGC);
      if (intactas) {
        this.#vaciarCompras();
        interruptor.checked = false;
        this.#alternarPac();
      }
    }
    this.pacAbiertoSolo = false;
  }

  #alternarPac() {
    const activo = this.campos.get('pacAplica')?.checked;
    if (this.cuerpoPac) this.cuerpoPac.hidden = !activo;
    this.#limpiarError('pac');
    this.#actualizarConciliacion();
  }

  /** Agrega una tarjeta de compra. Devuelve su identificador. */
  #agregarCompra(datos = {}) {
    const id = datos.id || nuevoId();
    const campos = {};
    const enfocar = datos.enfocar;

    const control = (clave, etiqueta, nodo, { ancho = '', ayuda = '' } = {}) => {
      campos[clave] = nodo;
      const idError = `pac-${id}-${clave}-error`;
      const error = el('p', { class: 'campo__error', id: idError, attrs: { hidden: true, role: 'alert' } });
      nodo.setAttribute('aria-describedby', idError);
      nodo.addEventListener('input', () => this.#alCambiarCompra(id, clave));
      nodo.addEventListener('change', () => this.#alCambiarCompra(id, clave));
      // Los campos de fecha repiten el valor en palabras: el formato nativo
      // depende del idioma del navegador y 04/09 es ambiguo.
      const eco = nodo.type === 'date'
        ? el('p', { class: 'campo__ayuda campo__eco', attrs: { 'aria-live': 'polite' } })
        : null;
      if (eco) {
        const refrescar = () => { eco.textContent = fechaEnPalabras(nodo.value); };
        nodo.addEventListener('change', refrescar);
        nodo.addEventListener('input', refrescar);
        refrescar();
      }

      // Etiqueta, control y "pie" (fecha en palabras, ayuda y error) van en tres
      // bloques fijos. Así los cuatro campos de la fila comparten las mismas
      // franjas y los controles quedan a la misma altura aunque una etiqueta
      // ocupe dos líneas y otra solo una.
      const grupo = el('div', { class: `campo ${ancho}`, dataset: { pacCampo: `${id}.${clave}` } }, [
        // El texto va en su propio `span`: la etiqueta es flex (para alinear
        // abajo), y el asterisco de «obligatorio» tiene que quedar pegado a la
        // última palabra, no flotando al borde derecho cuando el texto se parte.
        el('label', { class: 'campo__etiqueta', attrs: { for: nodo.id } }, [
          el('span', { class: 'campo__etiqueta-texto', text: etiqueta })
        ]),
        nodo,
        el('div', { class: 'campo__pie' }, [
          eco,
          ayuda && el('p', { class: 'campo__ayuda', text: ayuda }),
          error
        ].filter(Boolean))
      ]);
      grupo.__error = error;
      return grupo;
    };

    const entrada = (clave, tipo, extra = {}) => el('input', {
      class: 'campo__control', id: `pac-${id}-${clave}`, name: `pac-${id}-${clave}`,
      attrs: { type: tipo, ...extra }
    });

    // Clasificador: agrupado por ítem, en texto limpio.
    const selClasificador = el('select', { class: 'campo__control', id: `pac-${id}-clasificador` });
    llenarSelectAgrupado(selClasificador, opcionesClasificador(this.clasificador), {
      placeholder: 'Seleccionar clasificador…',
      valor: datos.clasificador || ''
    });

    const indice = el('span', { class: 'pac__indice' });
    const estado = el('span', { class: 'pac__estado', attrs: { hidden: true } });
    // Distintivo en la cabecera de la tarjeta: con varias compras abiertas, se
    // ve de un vistazo cuáles son críticas sin tener que bajar a la casilla.
    const distintivoSGC = el('span', { class: 'pac__sgc', text: 'Crítica SGC', attrs: { hidden: true } });

    // La marca de criticidad para el Sistema de Gestión de Calidad. No es
    // obligatoria —es una casilla, «no» es una respuesta válida— y por eso va
    // fuera de la grilla de datos de la compra, que tiene sus propias reglas de
    // alineación.
    const casillaSGC = el('input', {
      class: 'pac__sgc-casilla', id: `pac-${id}-criticaSGC`, name: `pac-${id}-criticaSGC`,
      attrs: { type: 'checkbox', 'aria-describedby': `pac-${id}-criticaSGC-ayuda` }
    });
    casillaSGC.checked = datos.criticaSGC === true;
    distintivoSGC.hidden = !casillaSGC.checked;
    casillaSGC.addEventListener('change', () => {
      distintivoSGC.hidden = !casillaSGC.checked;
      this.#alCambiarCompra(id, 'criticaSGC');
    });

    const tarjeta = el('article', { class: 'pac__tarjeta', dataset: { compra: id } }, [
      el('header', { class: 'pac__cabecera' }, [
        indice,
        estado,
        distintivoSGC,
        el('button', {
          class: 'btn btn--icono btn--peligro-texto',
          attrs: { type: 'button', title: 'Quitar esta compra', 'aria-label': 'Quitar esta compra' },
          text: 'Quitar',
          on: { click: () => this.#quitarCompra(id) }
        })
      ]),
      el('div', { class: 'pac__campos' }, [
        control('clasificador', 'Clasificador presupuestario', selClasificador, { ancho: 'campo--completo' }),
        control('producto', 'Producto o servicio a contratar',
          entrada('producto', 'text', { placeholder: 'Ej: Servicio de impresión de material educativo', maxlength: 300 }),
          { ancho: 'campo--completo' }),
        control('cantidad', 'Cantidad',
          entrada('cantidad', 'text', { inputmode: 'numeric', placeholder: '0' })),
        control('fechaCompra', 'Fecha estimada de compra o contratación', entrada('fechaCompra', 'date')),
        control('fechaEjecucion', 'Fecha estimada de ejecución', entrada('fechaEjecucion', 'date')),
        control('monto', 'Monto estimado',
          entrada('monto', 'text', { inputmode: 'decimal', placeholder: '0' }),
          { ayuda: 'En miles de pesos (M$).' })
      ]),
      el('div', { class: 'pac__sgc-fila' }, [
        el('label', { class: 'pac__sgc-etiqueta', attrs: { for: casillaSGC.id } }, [
          casillaSGC,
          el('span', { text: 'Compra crítica para el Sistema de Gestión de Calidad (SGC)' })
        ]),
        el('p', {
          class: 'campo__ayuda', id: `pac-${id}-criticaSGC-ayuda`,
          text: 'Márcala si esta adquisición es crítica para el SGC. Se usa para priorizarla y hacerle seguimiento en los reportes.'
        })
      ])
    ]);

    // Valores iniciales (al editar una actividad existente).
    for (const [clave, nodo] of Object.entries(campos)) {
      const v = datos[clave];
      if (v == null || v === '' || v === 0) continue;
      nodo.value = String(v);
      if (nodo.type === 'date') nodo.dispatchEvent(new Event('change'));
    }

    this.compras.set(id, { nodo: tarjeta, campos, indice, estado, casillaSGC });
    this.listaCompras.append(tarjeta);
    this.#renumerarCompras();
    this.#actualizarConciliacion();

    if (enfocar) selClasificador.focus();
    return id;
  }

  #quitarCompra(id) {
    const ref = this.compras.get(id);
    if (!ref) return;
    ref.nodo.remove();
    this.compras.delete(id);
    this.#renumerarCompras();
    this.#actualizarConciliacion();
    if (!this.compras.size) this.#limpiarError('pac');
  }

  #alCambiarCompra(id, clave) {
    const grupo = this.form?.querySelector(`[data-pac-campo="${CSS.escape(`${id}.${clave}`)}"]`);
    if (grupo) {
      grupo.classList.remove('campo--invalido');
      if (grupo.__error) { grupo.__error.hidden = true; grupo.__error.textContent = ''; }
    }
    this.#limpiarError('pac');
    this.#actualizarConciliacion();
  }

  #renumerarCompras() {
    let n = 0;
    for (const ref of this.compras.values()) {
      n += 1;
      ref.indice.textContent = `Compra ${n}`;
    }
  }

  /** Lee las compras tal como están en pantalla. */
  #leerCompras() {
    return [...this.compras.entries()].map(([id, ref]) => ({
      id,
      clasificador: ref.campos.clasificador.value,
      producto: ref.campos.producto.value,
      cantidad: ref.campos.cantidad.value,
      fechaCompra: ref.campos.fechaCompra.value,
      fechaEjecucion: ref.campos.fechaEjecucion.value,
      monto: ref.campos.monto.value,
      criticaSGC: ref.casillaSGC.checked
    }));
  }

  /**
   * Compara lo planificado en el PAC con el presupuesto del subtítulo 22.
   * No bloquea nada: solo hace visible una diferencia que, de otro modo,
   * llegaría hasta la entrega sin que nadie la note.
   */
  #actualizarConciliacion() {
    if (!this.conciliacion) return;
    const activo = this.campos.get('pacAplica')?.checked;
    if (!activo) { this.conciliacion.hidden = true; return; }

    const totalPac = this.#leerCompras().reduce((a, c) => a + aNumero(c.monto), 0);
    const totalST22 = IDS_MESES.reduce((a, m) => a + aNumero(this.campos.get(`pres-22-${m}`)?.value), 0);
    const diferencia = totalPac - totalST22;

    vaciar(this.conciliacion);
    this.conciliacion.hidden = false;

    // Marca de estado por compra (completa / faltan datos).
    for (const [id, ref] of this.compras) {
      const compra = this.#leerCompras().find((c) => c.id === id);
      const pendientes = camposPendientes({
        cantidad: aNumero(compra.cantidad),
        fechaCompra: compra.fechaCompra,
        fechaEjecucion: compra.fechaEjecucion
      });
      ref.estado.hidden = pendientes.length === 0;
      ref.estado.textContent = pendientes.length ? `Faltan ${pendientes.length} datos` : '';
    }

    if (totalST22 === 0) {
      this.conciliacion.className = 'pac__conciliacion';
      this.conciliacion.append(`Total de las compras: ${monto(totalPac)}`);
      return;
    }

    const cuadra = Math.abs(diferencia) < 0.5;
    this.conciliacion.className = `pac__conciliacion ${cuadra ? 'pac__conciliacion--ok' : 'pac__conciliacion--alerta'}`;
    this.conciliacion.append(
      el('strong', { text: monto(totalPac) }),
      ` en compras frente a ${monto(totalST22)} del subtítulo 22. `,
      cuadra
        ? 'Cuadra.'
        : `Diferencia de ${monto(Math.abs(diferencia))} ${diferencia > 0 ? 'de más' : 'de menos'}.`
    );
  }

  #alternarPresupuesto() {
    const desactivar = this.campos.get('sinPresupuesto').checked;
    this.bloquesPresupuesto.classList.toggle('presupuesto__bloques--inactivo', desactivar);
    this.bloquesPresupuesto.querySelectorAll('input, select').forEach((c) => {
      c.disabled = desactivar;
      if (desactivar) c.value = '';
    });
    if (desactivar) {
      SUBTITULOS.forEach((st) => llenarSelect(this.campos.get(`programa${st}`), [], { placeholder: '—', deshabilitado: true }));
      // Sin presupuesto no hay compras que planificar.
      const pac = this.campos.get('pacAplica');
      if (pac) { pac.checked = false; this.#alternarPac(); }
      this.#vaciarCompras();
    }
    this.#limpiarError('presupuesto');
    this.#actualizarTotales();
  }

  #actualizarTotales() {
    const totalCron = IDS_MESES.reduce((a, m) => a + aNumero(this.campos.get(`cron-${m}`)?.value), 0);
    if (this.totalCronograma) this.totalCronograma.textContent = numero(totalCron);

    let general = 0;
    for (const st of SUBTITULOS) {
      const t = IDS_MESES.reduce((a, m) => a + aNumero(this.campos.get(`pres-${st}-${m}`)?.value), 0);
      general += t;
      if (this[`totalST${st}`]) this[`totalST${st}`].textContent = monto(t);
    }
    if (this.totalPresupuesto) this.totalPresupuesto.textContent = monto(general);
    this.#sincronizarPacObligatorio();
    this.#actualizarConciliacion();
    this.__recalcularIndice?.();
  }

  #vaciarCompras() {
    for (const ref of this.compras.values()) ref.nodo.remove();
    this.compras.clear();
  }

  /* ---------------------------------------------------------------- */
  /* Lectura y escritura de valores                                    */
  /* ---------------------------------------------------------------- */

  /** Construye una actividad normalizada a partir del estado del formulario. */
  leer() {
    const v = (id) => this.campos.get(id)?.value ?? '';
    const datos = {
      id: this.editando || undefined,
      plan: this.plan.id,
      creadaEn: this.creadaEn || undefined,
      // Lo que el formulario no muestra pero la actividad ya tenía: se conserva.
      estado: this.estadoCargado || 'borrador',
      revision: this.revisionCargada || {},
      propietario: this.propietarioCargado || '',
      sinPresupuesto: this.campos.get('sinPresupuesto')?.checked || false,
      cronograma: Object.fromEntries(IDS_MESES.map((m) => [m, v(`cron-${m}`)])),
      pac: {
        aplica: this.campos.get('pacAplica')?.checked || false,
        compras: this.#leerCompras()
      },
      presupuesto: Object.fromEntries(SUBTITULOS.map((st) => [st, {
        programatico: v(`programatico${st}`),
        programa: v(`programa${st}`),
        meses: Object.fromEntries(IDS_MESES.map((m) => [m, v(`pres-${st}-${m}`)]))
      }]))
    };
    for (const [id, control] of this.campos) {
      if (id.startsWith('cron-') || id.startsWith('pres-') || id.startsWith('pac')) continue;
      if (id === 'sinPresupuesto') continue;
      datos[id] = control.value;
    }
    return normalizarActividad(datos, { planId: this.plan.id });
  }

  /** Carga una actividad existente en el formulario (modo edición). */
  cargar(actividad) {
    this.limpiar();
    this.editando = actividad.id;
    this.creadaEn = actividad.creadaEn;
    this.estadoCargado = actividad.estado;
    this.revisionCargada = actividad.revision;
    this.propietarioCargado = actividad.propietario;

    // La cadena ENS debe llenarse en orden para que cada nivel tenga opciones.
    if (this.ens) {
      const orden = ['objetivoEstrategico', 'tema', 'objetivoImpacto', 'resultadoEsperado', 'resultadoInmediato'];
      for (const id of orden) {
        const control = this.campos.get(id);
        if (!control) continue;
        control.value = actividad[id] || '';
        if (id !== 'resultadoInmediato') this.#actualizarCadena(id);
      }
      // Reasigna tras repoblar cada nivel.
      for (const id of orden) {
        const control = this.campos.get(id);
        if (control) control.value = actividad[id] || '';
      }
      this.#mostrarContextoENS();
    }

    for (const [id, control] of this.campos) {
      if (id.startsWith('cron-') || id.startsWith('pres-') || id === 'sinPresupuesto') continue;
      if (this.ens && ['objetivoEstrategico', 'tema', 'objetivoImpacto', 'resultadoEsperado', 'resultadoInmediato'].includes(id)) continue;
      if (id.startsWith('programatico')) continue;
      if (id.startsWith('programa') && !id.startsWith('programatico')) continue;
      if (actividad[id] != null) control.value = actividad[id];
    }

    this.campos.get('sinPresupuesto').checked = Boolean(actividad.sinPresupuesto);
    this.#alternarPresupuesto();

    // Plan Anual de Compras
    this.#vaciarCompras();
    const interruptorPac = this.campos.get('pacAplica');
    if (interruptorPac) {
      interruptorPac.checked = Boolean(actividad.pac?.aplica);
      this.pacAbiertoSolo = false;
      this.#alternarPac();
      for (const compra of actividad.pac?.compras ?? []) this.#agregarCompra(compra);
    }

    for (const m of IDS_MESES) {
      const val = actividad.cronograma?.[m] || 0;
      this.campos.get(`cron-${m}`).value = val ? String(val) : '';
    }
    for (const st of SUBTITULOS) {
      const bloque = actividad.presupuesto?.[st] || {};
      const progCat = this.campos.get(`programatico${st}`);
      progCat.value = bloque.programatico || '';
      progCat.dispatchEvent(new Event('change'));
      this.campos.get(`programa${st}`).value = bloque.programa || '';
      for (const m of IDS_MESES) {
        const val = bloque.meses?.[m] || 0;
        this.campos.get(`pres-${st}-${m}`).value = val ? String(val) : '';
      }
    }

    this.#actualizarTotales();

    // En edición se muestra el código ya asignado, no el próximo de la serie.
    const controlCodigo = this.campos.get('codigoActividad');
    if (controlCodigo) {
      controlCodigo.value = actividad.codigoActividad || '';
      controlCodigo.placeholder = actividad.codigoActividad ? '' : 'Sin código asignado';
    }

    this.#modoEdicion(true, actividad);
    if (this.acordeon) {
      // Una actividad guardada ya pasó por todas las capas: se abre la
      // primera con algo pendiente, o la de revisar si está completa.
      this.capasMarcadas = new Set(this.plan.secciones.map((_, i) => i));
      this.#abrirCapa(this.#primeraPendiente(), { desplazar: false, animar: false });
    }
    this.contenedor.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  limpiar({ avisar: mostrarAviso = false } = {}) {
    this.form?.reset();
    for (const [id, control] of this.campos) {
      if (control.type === 'checkbox') control.checked = false;
      else control.value = '';
      if (control.tagName === 'SELECT' && id !== 'departamento' && !id.startsWith('programatico')) {
        const dependiente = ['tema', 'objetivoImpacto', 'resultadoEsperado', 'resultadoInmediato']
          .includes(id) || id.startsWith('programa');
        if (dependiente) llenarSelect(control, [], { placeholder: 'Selecciona el nivel anterior', deshabilitado: true });
      }
      this.#limpiarError(id);
    }
    if (this.detalleENS) { vaciar(this.detalleENS); this.detalleENS.hidden = true; }
    this.#vaciarCompras();
    const pacLimpio = this.campos.get('pacAplica');
    if (pacLimpio) { pacLimpio.checked = false; this.#alternarPac(); }
    this.pacAbiertoSolo = false;
    this.editando = null;
    this.creadaEn = null;
    this.estadoCargado = null;
    this.revisionCargada = null;
    this.propietarioCargado = null;
    this.#alternarPresupuesto();
    this.#actualizarTotales();
    this.#modoEdicion(false);
    this.#limpiarError('cronograma');
    this.#limpiarError('presupuesto');
    // Los campos que vienen de la sesión no se "limpian": se vuelven a poner.
    this.aplicarPerfil();
    if (this.acordeon) {
      this.capasMarcadas = new Set();
      this.#abrirCapa(this.#primeraPendiente(), { desplazar: false, animar: false });
    }
    if (mostrarAviso) avisar('Formulario limpio.', 'info', { duracion: 2000 });
  }

  #modoEdicion(activo, actividad) {
    this.aplicarModoAprobacion();
    this.form?.classList.toggle('formulario--editando', activo);
    if (!this.avisoEdicion) return;
    vaciar(this.avisoEdicion);
    this.avisoEdicion.hidden = !activo;
    if (activo) {
      this.avisoEdicion.append(
        el('span', { text: `Editando: ${actividad.nombreActividad || 'actividad sin nombre'}` }),
        el('button', {
          class: 'btn btn--texto', attrs: { type: 'button' }, text: 'Cancelar edición',
          on: { click: () => this.limpiar({ avisar: true }) }
        })
      );
    }
  }

  /* ---------------------------------------------------------------- */
  /* Validación y envío                                                */
  /* ---------------------------------------------------------------- */

  #limpiarError(id) {
    const grupo = this.form?.querySelector(`[data-campo="${CSS.escape(id)}"]`);
    if (grupo) {
      grupo.classList.remove('campo--invalido');
      if (grupo.__error) { grupo.__error.hidden = true; grupo.__error.textContent = ''; }
    }
    const control = this.campos.get(id);
    control?.removeAttribute('aria-invalid');
    if (id === 'cronograma' && this.errorCronograma) { this.errorCronograma.hidden = true; this.errorCronograma.textContent = ''; }
    if (id === 'presupuesto' && this.errorPresupuesto) { this.errorPresupuesto.hidden = true; this.errorPresupuesto.textContent = ''; }
    if (id === 'pac' && this.errorPac) { this.errorPac.hidden = true; this.errorPac.textContent = ''; }
  }

  /** Traduce una clave de error del modelo (pac.2.monto) al campo en pantalla. */
  #grupoDeCompra(clave) {
    const m = /^pac\.(\d+)\.(.+)$/.exec(clave);
    if (!m) return null;
    const id = [...this.compras.keys()][Number(m[1])];
    if (!id) return null;
    return {
      grupo: this.form?.querySelector(`[data-pac-campo="${CSS.escape(`${id}.${m[2]}`)}"]`),
      control: this.compras.get(id)?.campos[m[2]]
    };
  }

  #mostrarError(id, mensaje) {
    const deCompra = this.#grupoDeCompra(id);
    if (deCompra) {
      const { grupo, control } = deCompra;
      if (grupo) {
        grupo.classList.add('campo--invalido');
        if (grupo.__error) { grupo.__error.textContent = mensaje; grupo.__error.hidden = false; }
      }
      control?.setAttribute('aria-invalid', 'true');
      return control || grupo;
    }
    if (id === 'pac' && this.errorPac) {
      this.errorPac.textContent = mensaje;
      this.errorPac.hidden = false;
      return this.errorPac;
    }
    if (id === 'cronograma' && this.errorCronograma) {
      this.errorCronograma.textContent = mensaje;
      this.errorCronograma.hidden = false;
      return this.errorCronograma;
    }
    if (id === 'presupuesto' && this.errorPresupuesto) {
      this.errorPresupuesto.textContent = mensaje;
      this.errorPresupuesto.hidden = false;
      return this.errorPresupuesto;
    }
    const grupo = this.form?.querySelector(`[data-campo="${CSS.escape(id)}"]`);
    if (grupo) {
      grupo.classList.add('campo--invalido');
      if (grupo.__error) { grupo.__error.textContent = mensaje; grupo.__error.hidden = false; }
    }
    this.campos.get(id)?.setAttribute('aria-invalid', 'true');
    return grupo;
  }

  /** @param {'enviar'|'borrador'} intencion  Qué botón se pulsó. */
  async enviar(intencion = 'enviar') {
    const actividad = this.leer();
    const { valido, errores } = validarActividad(actividad, this.plan);

    for (const id of this.campos.keys()) this.#limpiarError(id);
    this.#limpiarError('cronograma');
    this.#limpiarError('presupuesto');
    this.#limpiarError('pac');
    for (const [id, ref] of this.compras) {
      for (const clave of Object.keys(ref.campos)) this.#alCambiarCompra(id, clave);
    }

    if (!valido) {
      // El primero según el orden de la pantalla, no el de la validación: así
      // se recorre el formulario de arriba hacia abajo.
      let primero = null;
      for (const [id, mensaje] of Object.entries(errores)) {
        const nodo = this.#mostrarError(id, mensaje);
        const destino = nodo ? (this.campos.get(id) || nodo) : null;
        if (destino && (!primero || (destino.compareDocumentPosition(primero) & Node.DOCUMENT_POSITION_FOLLOWING))) primero = destino;
      }
      // Un nivel de la cadena ENS sigue deshabilitado hasta elegir el anterior:
      // el cursor va al primer campo vacío que sí se puede llenar.
      if (primero?.disabled) {
        const seccion = primero.closest('.seccion');
        primero = [...(seccion?.querySelectorAll('input, select, textarea') ?? [])]
          .find((c) => !c.disabled && !c.readOnly && c.type !== 'hidden' && !c.value) || primero;
      }
      avisar(`Revisa ${Object.keys(errores).length} campo${Object.keys(errores).length > 1 ? 's' : ''} antes de guardar.`, 'alerta');
      if (this.acordeon) {
        // Todas las capas quedan marcadas: las que tienen faltas lo dicen en
        // su cabecera. Se abre la primera, y al terminar de abrirse se lleva
        // al campo.
        this.plan.secciones.forEach((_, i) => this.capasMarcadas.add(i));
        const capa = primero?.closest?.('.capa');
        if (capa) {
          this.#abrirCapa(Number(capa.dataset.seccion), { desplazar: false });
          const suave = !matchMedia('(prefers-reduced-motion: reduce)').matches;
          setTimeout(() => {
            primero.scrollIntoView({ behavior: suave ? 'smooth' : 'auto', block: 'center' });
            primero.focus?.({ preventScroll: true });
          }, suave ? 380 : 0);
        } else this.#pintarCapas();
        return null;
      }
      primero?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      primero?.focus?.({ preventScroll: true });
      return null;
    }

    // Avisos que no impiden guardar, pero conviene que la persona vea.
    for (const aviso of revisarActividad(actividad)) {
      const texto = aviso.tipo === 'descuadre'
        ? `Las compras del PAC suman ${monto(aviso.pac)} y el subtítulo 22 tiene ${monto(aviso.st22)}: ` +
          `${monto(Math.abs(aviso.diferencia))} de ${aviso.diferencia > 0 ? 'más' : 'menos'}.`
        : aviso.mensaje;
      avisar(texto, 'alerta', { duracion: 9000 });
    }

    const editaba = Boolean(this.editando);
    await this.alGuardar(actividad, { editaba, enviar: intencion !== 'borrador' });
    this.limpiar();
    return actividad;
  }
}
