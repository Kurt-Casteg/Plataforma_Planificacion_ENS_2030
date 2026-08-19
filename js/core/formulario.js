/**
 * Constructor de formularios declarativo.
 *
 * Recibe la definición de un plan y dibuja el formulario completo, resolviendo
 * dependencias entre campos, validación y modo edición. El HTML no contiene
 * ningún campo escrito a mano: por eso agregar o quitar campos es editar
 * `js/plans/index.js` y nada más.
 */

import { el, render, vaciar, llenarSelect, llenarSelectAgrupado, debounce } from './dom.js';
import {
  MESES, IDS_MESES, SUBTITULOS, aNumero,
  normalizarActividad, validarActividad, revisarActividad, camposPendientes, nuevoId
} from './modelo.js';
import { aOpciones, indexarENS, opcionesClasificador } from './catalogos.js';
import { monto, numero, fechaEnPalabras } from './formato.js';
import { avisar } from './ui.js';
import { perfil } from './perfil.js';

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
    // Si la sesión se resuelve después de dibujar el formulario, se rellena solo.
    this.__alCambiarPerfil = () => this.aplicarPerfil();
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

    this.cuerpoPac = el('div', { class: 'pac__cuerpo', attrs: { hidden: true } }, [
      el('div', { class: 'nota nota--info' }, [
        el('p', {}, [
          'Registra cada producto o servicio que se comprará. ',
          el('strong', { text: 'Los montos van en miles de pesos' }),
          ', igual que el presupuesto de arriba.'
        ])
      ]),

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

      this.listaCompras,
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

    return el('div', { class: 'pac', dataset: { campo: 'pac' } }, [
      el('label', { class: 'interruptor interruptor--pac' }, [
        interruptor,
        el('span', { class: 'interruptor__control', attrs: { 'aria-hidden': 'true' } }),
        el('span', { class: 'interruptor__texto' }, [
          'Esta actividad forma parte del Plan Anual de Compras (PAC)',
          el('span', { class: 'interruptor__ayuda', text: 'Actívalo si el gasto del subtítulo 22 implica comprar o contratar.' })
        ])
      ]),
      this.cuerpoPac
    ]);
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

      const grupo = el('div', { class: `campo ${ancho}`, dataset: { pacCampo: `${id}.${clave}` } }, [
        el('label', { class: 'campo__etiqueta', text: etiqueta, attrs: { for: nodo.id } }),
        nodo,
        eco,
        ayuda && el('p', { class: 'campo__ayuda', text: ayuda }),
        error
      ].filter(Boolean));
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

    const tarjeta = el('article', { class: 'pac__tarjeta', dataset: { compra: id } }, [
      el('header', { class: 'pac__cabecera' }, [
        indice,
        estado,
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
      ])
    ]);

    // Valores iniciales (al editar una actividad existente).
    for (const [clave, nodo] of Object.entries(campos)) {
      const v = datos[clave];
      if (v == null || v === '' || v === 0) continue;
      nodo.value = String(v);
      if (nodo.type === 'date') nodo.dispatchEvent(new Event('change'));
    }

    this.compras.set(id, { nodo: tarjeta, campos, indice, estado });
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
      monto: ref.campos.monto.value
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
    this.#actualizarConciliacion();
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
    this.editando = null;
    this.creadaEn = null;
    this.#alternarPresupuesto();
    this.#actualizarTotales();
    this.#modoEdicion(false);
    this.#limpiarError('cronograma');
    this.#limpiarError('presupuesto');
    // Los campos que vienen de la sesión no se "limpian": se vuelven a poner.
    this.aplicarPerfil();
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

  async enviar() {
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

    // Avisos que no impiden guardar, pero conviene que la persona vea.
    for (const aviso of revisarActividad(actividad)) {
      const texto = aviso.tipo === 'descuadre'
        ? `Las compras del PAC suman ${monto(aviso.pac)} y el subtítulo 22 tiene ${monto(aviso.st22)}: ` +
          `${monto(Math.abs(aviso.diferencia))} de ${aviso.diferencia > 0 ? 'más' : 'menos'}.`
        : aviso.mensaje;
      avisar(texto, 'alerta', { duracion: 9000 });
    }

    const editaba = Boolean(this.editando);
    await this.alGuardar(actividad, { editaba });
    this.limpiar();
    return actividad;
  }
}
