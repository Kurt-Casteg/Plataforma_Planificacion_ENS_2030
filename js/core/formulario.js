/**
 * Constructor de formularios declarativo.
 *
 * Recibe la definición de un plan y dibuja el formulario completo, resolviendo
 * dependencias entre campos, validación y modo edición. El HTML no contiene
 * ningún campo escrito a mano: por eso agregar o quitar campos es editar
 * `js/plans/index.js` y nada más.
 */

import { el, render, vaciar, llenarSelect, debounce } from './dom.js';
import { MESES, IDS_MESES, SUBTITULOS, aNumero, normalizarActividad, validarActividad } from './modelo.js';
import { aOpciones, indexarENS } from './catalogos.js';
import { monto, numero } from './formato.js';
import { avisar } from './ui.js';

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
  constructor({ contenedor, plan, catalogos, ens, indicadores, alGuardar }) {
    this.contenedor = contenedor;
    this.plan = plan;
    this.catalogos = catalogos;
    this.ens = ens ? indexarENS(ens) : null;
    this.indicadores = indicadores || {};
    this.alGuardar = alGuardar;
    this.campos = new Map();   // id -> elemento de entrada
    this.editando = null;      // id de la actividad en edición
    this.#dibujar();
  }

  /* ---------------------------------------------------------------- */
  /* Dibujo                                                            */
  /* ---------------------------------------------------------------- */

  #dibujar() {
    const form = el('form', {
      class: 'formulario',
      id: 'formularioActividad',
      attrs: { novalidate: true, autocomplete: 'off' },
      on: { submit: (e) => { e.preventDefault(); this.enviar(); } }
    });

    this.plan.secciones.forEach((seccion, i) => {
      form.append(this.#seccion(seccion, i + 1));
    });

    this.avisoEdicion = el('div', { class: 'aviso-edicion', attrs: { hidden: true, role: 'status' } });

    form.append(
      this.avisoEdicion,
      el('div', { class: 'formulario__acciones' }, [
        el('button', {
          class: 'btn btn--primario btn--grande', attrs: { type: 'submit' }, id: 'btnGuardar'
        }, ['Guardar actividad']),
        el('button', {
          class: 'btn btn--secundario', attrs: { type: 'button' },
          text: 'Limpiar formulario',
          on: { click: () => this.limpiar({ avisar: true }) }
        })
      ])
    );

    render(this.contenedor, form);
    this.form = form;
    this.#actualizarTotales();
  }

  #seccion(seccion, numero) {
    const cuerpo = el('div', { class: 'seccion__cuerpo' });
    for (const campo of seccion.campos) cuerpo.append(this.#campo(campo));

    return el('section', { class: 'seccion' }, [
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
        ])
      ]));
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

  #alternarPresupuesto() {
    const desactivar = this.campos.get('sinPresupuesto').checked;
    this.bloquesPresupuesto.classList.toggle('presupuesto__bloques--inactivo', desactivar);
    this.bloquesPresupuesto.querySelectorAll('input, select').forEach((c) => {
      c.disabled = desactivar;
      if (desactivar) c.value = '';
    });
    if (desactivar) {
      SUBTITULOS.forEach((st) => llenarSelect(this.campos.get(`programa${st}`), [], { placeholder: '—', deshabilitado: true }));
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
      sinPresupuesto: this.campos.get('sinPresupuesto')?.checked || false,
      cronograma: Object.fromEntries(IDS_MESES.map((m) => [m, v(`cron-${m}`)])),
      presupuesto: Object.fromEntries(SUBTITULOS.map((st) => [st, {
        programatico: v(`programatico${st}`),
        programa: v(`programa${st}`),
        meses: Object.fromEntries(IDS_MESES.map((m) => [m, v(`pres-${st}-${m}`)]))
      }]))
    };
    for (const [id, control] of this.campos) {
      if (id.startsWith('cron-') || id.startsWith('pres-') || id === 'sinPresupuesto') continue;
      datos[id] = control.value;
    }
    return normalizarActividad(datos, { planId: this.plan.id });
  }

  /** Carga una actividad existente en el formulario (modo edición). */
  cargar(actividad) {
    this.limpiar();
    this.editando = actividad.id;
    this.creadaEn = actividad.creadaEn;

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
    this.#modoEdicion(true, actividad);
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
    this.editando = null;
    this.creadaEn = null;
    this.#alternarPresupuesto();
    this.#actualizarTotales();
    this.#modoEdicion(false);
    this.#limpiarError('cronograma');
    this.#limpiarError('presupuesto');
    if (mostrarAviso) avisar('Formulario limpio.', 'info', { duracion: 2000 });
  }

  #modoEdicion(activo, actividad) {
    const btn = this.form?.querySelector('#btnGuardar');
    if (btn) btn.textContent = activo ? 'Actualizar actividad' : 'Guardar actividad';
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
  }

  #mostrarError(id, mensaje) {
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

  async enviar() {
    const actividad = this.leer();
    const { valido, errores } = validarActividad(actividad, this.plan);

    for (const id of this.campos.keys()) this.#limpiarError(id);
    this.#limpiarError('cronograma');
    this.#limpiarError('presupuesto');

    if (!valido) {
      let primero = null;
      for (const [id, mensaje] of Object.entries(errores)) {
        const nodo = this.#mostrarError(id, mensaje);
        if (!primero && nodo) primero = this.campos.get(id) || nodo;
      }
      avisar(`Revisa ${Object.keys(errores).length} campo${Object.keys(errores).length > 1 ? 's' : ''} antes de guardar.`, 'alerta');
      primero?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      primero?.focus?.({ preventScroll: true });
      return null;
    }

    const editaba = Boolean(this.editando);
    await this.alGuardar(actividad, { editaba });
    this.limpiar();
    return actividad;
  }
}
