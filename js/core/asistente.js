/**
 * Asistente de la plataforma.
 *
 * NO es inteligencia artificial y el panel lo dice con todas sus letras. Son
 * reglas que leen el formulario en curso y un banco de respuestas escritas a
 * mano. La distinción importa: un modelo pequeño podría inventar un código de
 * resultado inmediato que parezca correcto, y alguien lo copiaría. Esto no
 * puede equivocarse en ese sentido, porque no genera nada: solo mira lo que hay
 * y compara contra las mismas reglas que ya validan al guardar.
 *
 * Todo el contenido vive en `data/asistente.json`, editable sin tocar código.
 */

import { el, render, vaciar, debounce } from './dom.js';
import { monto, numero, fecha } from './formato.js';
import { MESES, SUBTITULOS } from './modelo.js';
import { etiquetaDe } from './catalogos.js';
import { perfil } from './perfil.js';
import { avisar } from './ui.js';

const CLAVE_MINIMIZADO = 'seremi.asistente.minimizado';
const CLAVE_GUIA_VISTA = 'seremi.asistente.guiaVista';

/** Severidades, de mayor a menor urgencia. */
const ORDEN = { alerta: 0, sugerencia: 1, info: 2 };

export async function cargarContenidoAsistente() {
  const url = new URL('../../data/asistente.json', import.meta.url);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`No se pudo cargar el contenido del asistente (${r.status})`);
  return r.json();
}

/** Quita tildes y baja a minúsculas, para que la búsqueda perdone el tipeo. */
const normalizar = (t) => String(t || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export class Asistente {
  /**
   * @param {object} opciones
   * @param {HTMLElement} opciones.contenedor  Dónde se monta (el body).
   * @param {object} opciones.contenido        Lo cargado de asistente.json.
   * @param {Function} opciones.contexto       Devuelve { plan, formulario, actividades, catalogos, indicadores }.
   */
  constructor({ contenedor, contenido, contexto }) {
    this.contenedor = contenedor;
    this.contenido = contenido || { guia: [], campos: {}, preguntas: [], mediosSugeridos: {} };
    this.contexto = contexto;
    this.abierto = false;
    this.observaciones = [];
    this.vista = 'revision';
    this.busqueda = '';

    this.#dibujar();
    this.revisar = debounce(() => this.actualizar(), 400);
  }

  /* ---------------------------------------------------------------- */
  /* Figura                                                            */
  /* ---------------------------------------------------------------- */

  /**
   * El destello: la señal que hoy se asocia a la ayuda asistida. Va dibujado
   * como SVG y no como imagen para que siga los colores del tema, se vea nítido
   * en cualquier pantalla y no dependa de descargar nada.
   */
  #figura(clase = 'asistente__figura') {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 32 32');
    svg.setAttribute('class', clase);
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');

    // Un destello grande y dos pequeños: la forma de cuatro puntas, hecha con
    // curvas que se hunden hacia el centro.
    const destello = (cx, cy, r, opacidad) => {
      const k = r * 0.42;
      const p = document.createElementNS(ns, 'path');
      p.setAttribute('d', [
        `M ${cx} ${cy - r}`,
        `C ${cx + k} ${cy - k} ${cx + k} ${cy - k} ${cx + r} ${cy}`,
        `C ${cx + k} ${cy + k} ${cx + k} ${cy + k} ${cx} ${cy + r}`,
        `C ${cx - k} ${cy + k} ${cx - k} ${cy + k} ${cx - r} ${cy}`,
        `C ${cx - k} ${cy - k} ${cx - k} ${cy - k} ${cx} ${cy - r}`,
        'Z'
      ].join(' '));
      p.setAttribute('fill', 'currentColor');
      if (opacidad) p.setAttribute('opacity', String(opacidad));
      return p;
    };

    svg.append(
      destello(13, 14, 10),
      destello(25, 8, 4.5, 0.75),
      destello(24, 23, 3.5, 0.55)
    );
    return svg;
  }

  /* ---------------------------------------------------------------- */
  /* Estructura                                                        */
  /* ---------------------------------------------------------------- */

  #dibujar() {
    this.insignia = el('span', { class: 'asistente__insignia', attrs: { hidden: true } });

    this.boton = el('button', {
      class: 'asistente__boton',
      attrs: {
        type: 'button', 'aria-expanded': 'false', 'aria-controls': 'asistentePanel',
        title: 'Asistente de la plataforma'
      },
      on: { click: () => this.alternar() }
    }, [
      this.#figura(),
      el('span', { class: 'visualmente-oculto', text: 'Abrir el asistente de la plataforma' }),
      this.insignia
    ]);

    this.buscador = el('input', {
      class: 'campo__control asistente__buscador', id: 'asistenteBuscador',
      attrs: {
        type: 'search',
        placeholder: 'Busca en las preguntas frecuentes…',
        'aria-label': 'Buscar en las preguntas frecuentes'
      }
    });
    this.buscador.addEventListener('input', debounce(() => {
      this.busqueda = this.buscador.value.trim();
      if (this.busqueda) this.vista = 'buscar';
      this.#pintarCuerpo();
    }, 180));

    this.pestanas = el('div', { class: 'asistente__pestanas', attrs: { role: 'tablist' } }, [
      this.#pestana('revision', 'Revisión'),
      this.#pestana('preguntas', 'Preguntas'),
      this.#pestana('guia', 'Guía')
    ]);

    this.cuerpo = el('div', { class: 'asistente__cuerpo', attrs: { id: 'asistenteCuerpo' } });

    this.panel = el('div', {
      class: 'asistente__panel', attrs: { id: 'asistentePanel', hidden: true, role: 'dialog', 'aria-label': 'Asistente de la plataforma' }
    }, [
      el('div', { class: 'asistente__cabecera' }, [
        this.#figura('asistente__figura asistente__figura--chica'),
        el('div', { class: 'asistente__titulos' }, [
          el('p', { class: 'asistente__titulo', text: 'Asistente de la plataforma' }),
          // La honestidad va aquí, no en una nota al pie: si alguien cree que
          // es un chat, va a escribir una pregunta abierta y concluir que la
          // plataforma no sirve cuando no le responda.
          el('p', { class: 'asistente__subtitulo', text: 'Revisa lo que escribes y busca en las respuestas oficiales. No es un chat ni genera texto.' })
        ]),
        el('button', {
          class: 'btn btn--icono asistente__cerrar',
          attrs: { type: 'button', 'aria-label': 'Cerrar el asistente' }, text: '✕',
          on: { click: () => this.cerrar() }
        })
      ]),
      this.buscador,
      this.pestanas,
      this.cuerpo,
      el('button', {
        class: 'asistente__ocultar', attrs: { type: 'button' },
        // El texto dice dónde se recupera. Un interruptor sin vuelta visible es
        // una trampa: quien lo pulsa no tiene por qué saber que existe.
        text: 'Ocultar en este navegador (se recupera desde Ayuda)',
        on: { click: () => this.ocultarDelTodo() }
      })
    ]);

    this.raiz = el('div', { class: 'asistente' }, [this.panel, this.boton]);
    this.contenedor.append(this.raiz);

    // Escape cierra, como en los demás diálogos de la plataforma.
    this.__alTeclear = (e) => { if (e.key === 'Escape' && this.abierto) this.cerrar(); };
    document.addEventListener('keydown', this.__alTeclear);

    if (localStorage.getItem(CLAVE_MINIMIZADO) === '1') this.raiz.hidden = true;
  }

  #pestana(id, texto) {
    return el('button', {
      class: 'asistente__pestana', dataset: { vista: id },
      attrs: { type: 'button', role: 'tab', 'aria-selected': String(this.vista === id) },
      text: texto,
      on: { click: () => { this.vista = id; this.busqueda = ''; this.buscador.value = ''; this.#pintarCuerpo(); } }
    });
  }

  /* ---------------------------------------------------------------- */
  /* Apertura y cierre                                                 */
  /* ---------------------------------------------------------------- */

  alternar() { this.abierto ? this.cerrar() : this.abrir(); }

  /**
   * Al abrir vuelve siempre a «Revisión», salvo que se pida otra pestaña.
   * Si la insignia dice que hay seis observaciones y alguien la pulsa, quiere
   * ver esas seis: reabrir en la pestaña donde quedó la vez anterior obliga a
   * un clic extra para llegar a lo que motivó el aviso.
   */
  abrir({ vista } = {}) {
    this.vista = vista || 'revision';
    this.busqueda = '';
    if (this.buscador) this.buscador.value = '';
    this.abierto = true;
    this.panel.hidden = false;
    this.boton.setAttribute('aria-expanded', 'true');
    this.actualizar();
    this.buscador.focus();
  }

  cerrar() {
    this.abierto = false;
    this.panel.hidden = true;
    this.boton.setAttribute('aria-expanded', 'false');
    this.boton.focus();
  }

  ocultarDelTodo() {
    localStorage.setItem(CLAVE_MINIMIZADO, '1');
    this.raiz.hidden = true;
    this.abierto = false;
    avisar('Asistente oculto. Para volver a mostrarlo: botón «Ayuda» de la cabecera.', 'info', { duracion: 8000 });
  }

  mostrar() {
    localStorage.removeItem(CLAVE_MINIMIZADO);
    this.raiz.hidden = false;
  }

  get oculto() { return this.raiz.hidden; }

  /* ---------------------------------------------------------------- */
  /* Revisión                                                          */
  /* ---------------------------------------------------------------- */

  /** Recalcula las observaciones y pone al día la insignia y el panel. */
  actualizar() {
    if (this.raiz.hidden) return;
    let ctx;
    try {
      ctx = this.contexto?.() || {};
    } catch (e) {
      console.warn('El asistente no pudo leer el contexto:', e);
      ctx = {};
    }
    this.observaciones = this.#revisar(ctx);

    // El contador cuenta solo lo que PIDE ALGO. Las observaciones informativas
    // (azules) se siguen mostrando en el panel porque son útiles, pero no
    // suman: un número que incluye avisos que no hay que atender deja de
    // significar nada y se aprende a ignorar.
    const porAtender = this.observaciones.filter((o) => o.nivel !== 'info');
    const alertas = porAtender.filter((o) => o.nivel === 'alerta').length;
    const n = porAtender.length;

    this.insignia.hidden = n === 0;
    this.insignia.textContent = n > 9 ? '9+' : String(n);
    this.insignia.dataset.nivel = alertas ? 'alerta' : 'sugerencia';
    this.boton.dataset.avisa = String(n > 0);
    this.boton.title = n
      ? `Asistente: ${numero(n)} ${n === 1 ? 'observación por atender' : 'observaciones por atender'}`
      : 'Asistente de la plataforma';

    if (this.abierto) this.#pintarCuerpo();
  }

  /**
   * Todas las comprobaciones. Ninguna inventa criterios nuevos: son las mismas
   * reglas que la plataforma ya aplica al guardar, adelantadas al momento en
   * que todavía es cómodo corregirlas.
   */
  #revisar({ plan, formulario, actividades = [], catalogos, indicadores }) {
    const obs = [];
    const agregar = (nivel, texto, extra) => obs.push({ nivel, texto, ...extra });

    if (perfil.soloLectura) {
      agregar('info', 'Estás en un perfil de solo lectura, así que no hay formulario que revisar. Las preguntas y la guía siguen disponibles.');
      return obs.concat(this.#revisarConjunto(actividades, plan));
    }
    if (!formulario) return this.#revisarConjunto(actividades, plan);

    let a;
    try { a = formulario.leer(); } catch { return this.#revisarConjunto(actividades, plan); }

    // Formulario en blanco: en vez de una lista de reproches, se ofrece la guía.
    const enBlanco = !a.nombreActividad && !a.objetivoEstrategico && !a.objetivoEstrategicoTexto
      && a.totales.cronograma === 0 && a.totales.presupuesto === 0;
    if (enBlanco) {
      agregar('info', 'El formulario está en blanco. Si es tu primera vez, la pestaña «Guía» explica en qué orden conviene llenarlo.', { accion: 'guia' });
      return obs.concat(this.#revisarConjunto(actividades, plan));
    }

    /* --- Identificación y cadena --- */
    if (!a.nombreActividad) {
      agregar('alerta', 'Falta el nombre de la actividad. Es obligatorio y es lo que permitirá reconocerla en una planilla de cien filas.', { campo: 'nombreActividad' });
    }

    if (plan?.id === 'pns') {
      const niveles = [
        ['objetivoEstrategico', 'el objetivo estratégico'],
        ['tema', 'el tema'],
        ['objetivoImpacto', 'el objetivo de impacto'],
        ['resultadoEsperado', 'el resultado esperado'],
        ['resultadoInmediato', 'el resultado inmediato']
      ];
      const faltan = niveles.filter(([id]) => !a[id]);
      if (faltan.length && faltan.length < niveles.length) {
        agregar('alerta', `La cadena de resultados quedó a medio elegir: falta ${faltan.map(([, n]) => n).join(', ')}. Sin el resultado inmediato la actividad no queda amarrada a la ENS.`, { campo: 'resultadoInmediato' });
      } else if (faltan.length === niveles.length) {
        agregar('alerta', 'Todavía no eliges la cadena de resultados. Se llena de arriba hacia abajo: cada nivel habilita el siguiente.', { campo: 'objetivoEstrategico' });
      }

      // Los indicadores oficiales están asociados al resultado esperado.
      const lista = a.resultadoEsperado && indicadores?.[a.resultadoEsperado];
      if (lista?.length) {
        agregar('info', `El resultado esperado ${a.resultadoEsperado} tiene ${numero(lista.length)} indicador${lista.length === 1 ? '' : 'es'} oficial${lista.length === 1 ? '' : 'es'} asociado${lista.length === 1 ? '' : 's'}. Aparecen bajo el campo: no hay que llenarlos, pero conviene leerlos para saber con qué se medirá tu aporte.`);
      }
    } else if (!a.objetivoOperacional) {
      agregar('sugerencia', 'Falta el objetivo operacional: qué se propone lograr la unidad este año, en términos verificables.', { campo: 'objetivoOperacional' });
    }

    /* --- Descripción --- */
    if (!a.tipoActividad) {
      agregar('sugerencia', 'No has indicado el tipo de actividad. Sirve para agrupar en el panel y para saber qué medio de verificación corresponde.', { campo: 'tipoActividad' });
    }
    if (!a.descripcionActividad) {
      agregar('sugerencia', 'Falta la descripción detallada. Es lo que permitirá entender la actividad el año siguiente, cuando ya no estés a cargo.', { campo: 'descripcionActividad' });
    } else if (a.descripcionActividad.trim().length < 40) {
      agregar('sugerencia', 'La descripción es muy breve. Vale la pena decir el alcance, la población objetivo y cómo se hará.', { campo: 'descripcionActividad' });
    }

    if (!a.medioVerificacion) {
      const sugerido = this.contenido.mediosSugeridos?.[a.tipoActividad];
      const detalle = sugerido && catalogos?.mediosVerificacion?.find((m) => m.tipo === sugerido)?.detalle;
      agregar('alerta',
        sugerido
          ? `Falta el medio de verificación. Para una actividad de tipo «${etiquetaDe(catalogos.tiposActividad, a.tipoActividad)}» corresponde «${sugerido}»${detalle ? `: ${detalle}` : '.'}`
          : 'Falta el medio de verificación: el documento con el que demostrarás que la actividad se ejecutó. Debe existir de verdad y poder recuperarse después.',
        { campo: 'medioVerificacion' });
    }

    /* --- Cronograma --- */
    if (a.totales.cronograma === 0) {
      agregar('alerta', 'El cronograma está vacío. Indica en qué meses ejecutas la actividad y cuántas veces en cada uno: tres talleres en abril son un 3 en abril.', { campo: 'cron-ene' });
    }

    /* --- Presupuesto --- */
    if (!a.sinPresupuesto && a.totales.presupuesto === 0) {
      agregar('sugerencia',
        'No cargaste presupuesto ni marcaste «esta actividad no requiere presupuesto». Marcar la casilla deja constancia de que fue una decisión y no un olvido.',
        { campo: 'sinPresupuesto' });
    }

    for (const st of SUBTITULOS) {
      const b = a.presupuesto[st];
      const total = a.totales[`presupuesto${st}`];
      if (total > 0 && (!b.programatico || !b.programa)) {
        agregar('sugerencia',
          `El subtítulo ${st} tiene ${monto(total)} sin categoría programática o programa asignado.`,
          { campo: `programatico${st}` });
      }
    }

    // Meses con recursos pero sin ejecución: suele ser un dedazo de columna.
    if (a.totales.presupuesto > 0 && a.totales.cronograma > 0) {
      const sueltos = MESES.filter((m) => {
        const conPlata = SUBTITULOS.some((st) => a.presupuesto[st].meses[m.id] > 0);
        return conPlata && !a.cronograma[m.id];
      });
      if (sueltos.length) {
        agregar('info', `Hay presupuesto en ${sueltos.map((m) => m.largo.toLowerCase()).join(', ')} pero ninguna ejecución programada en ${sueltos.length === 1 ? 'ese mes' : 'esos meses'}. Puede ser correcto (una compra anticipada), pero conviene revisarlo.`);
      }
    }

    /* --- Plan Anual de Compras --- */
    if (!a.sinPresupuesto && a.totales.presupuesto22 > 0 && !a.pac.aplica) {
      agregar('sugerencia',
        `El subtítulo 22 tiene ${monto(a.totales.presupuesto22)} y el Plan Anual de Compras está apagado. Si esos recursos se van en bienes o servicios, activa el interruptor y detalla las compras.`,
        { campo: 'pacAplica' });
    }

    if (a.pac.aplica) {
      const dif = a.totales.pac - a.totales.presupuesto22;
      if (dif !== 0) {
        agregar('alerta',
          `Las compras suman ${monto(a.totales.pac)} y el subtítulo 22 tiene ${monto(a.totales.presupuesto22)}: ${monto(Math.abs(dif))} ${dif > 0 ? 'de más' : 'sin imputar'}. Puedes guardar igual, pero debe cuadrar antes de la entrega a Adquisiciones.`,
          // Al primer monto: es donde se ajusta el descuadre.
          { campo: `pac-${a.pac.compras[0]?.id}-monto` });
      }

      a.pac.compras.forEach((c, i) => {
        const nombre = c.producto ? `«${c.producto}»` : `la compra ${i + 1}`;
        const faltan = [];
        if (!c.clasificador) faltan.push('el clasificador');
        if (!c.producto) faltan.push('el producto');
        if (!c.monto) faltan.push('el monto');
        if (faltan.length) {
          agregar('alerta',
            `En ${nombre} falta ${faltan.join(', ')}. Son los tres datos obligatorios de cada compra.`,
            { campo: `pac-${c.id}-${!c.clasificador ? 'clasificador' : !c.producto ? 'producto' : 'monto'}` });
        }

        const sugeridos = [];
        if (!c.cantidad) sugeridos.push('la cantidad');
        if (!c.fechaCompra) sugeridos.push('la fecha de compra');
        if (!c.fechaEjecucion) sugeridos.push('la fecha de ejecución');
        if (sugeridos.length && !faltan.length) {
          agregar('sugerencia',
            `En ${nombre} falta ${sugeridos.join(', ')}. No bloquea el guardado, pero Adquisiciones lo va a pedir.`,
            { campo: `pac-${c.id}-${!c.cantidad ? 'cantidad' : !c.fechaCompra ? 'fechaCompra' : 'fechaEjecucion'}` });
        }

        if (c.fechaCompra && c.fechaEjecucion && c.fechaCompra > c.fechaEjecucion) {
          agregar('alerta',
            `En ${nombre} la fecha de compra (${fecha(c.fechaCompra)}) es posterior a la de ejecución (${fecha(c.fechaEjecucion)}). Primero se solicita la compra y después se ejecuta la actividad con esos insumos.`,
            { campo: `pac-${c.id}-fechaCompra` });
        }
      });
    }

    return obs.concat(this.#revisarConjunto(actividades, plan));
  }

  /**
   * Observaciones sobre lo ya guardado, no sobre lo que se está escribiendo.
   *
   * Nombran las actividades concretas en vez de decir «2 actividades tienen un
   * problema»: un número sin nombres obliga a ir a buscarlas una por una en el
   * listado, que es justo el trabajo que el asistente debería ahorrar.
   */
  #revisarConjunto(actividades, plan) {
    if (!actividades.length) return [];
    const obs = [];

    const grupo = (lista, texto) => {
      if (!lista.length) return;
      obs.push({
        nivel: 'sugerencia',
        conjunto: true,
        texto: `${numero(lista.length)} actividad${lista.length === 1 ? '' : 'es'} ya guardada${lista.length === 1 ? '' : 's'} ${texto}`,
        actividades: lista
      });
    };

    grupo(actividades.filter((a) => !a.medioVerificacion),
      'sin medio de verificación.');
    grupo(actividades.filter((a) => a.totales.cronograma === 0),
      'con el cronograma vacío.');
    grupo(actividades.filter((a) => !a.sinPresupuesto && a.totales.presupuesto === 0),
      'sin presupuesto ni la marca de «no requiere presupuesto».');
    grupo(actividades.filter((a) => a.pac?.aplica && a.totales.pac !== a.totales.presupuesto22),
      'con el Plan Anual de Compras descuadrado respecto de su subtítulo 22.');

    if (obs.length) {
      obs.push({
        nivel: 'info', conjunto: true,
        texto: `Revisado sobre ${numero(actividades.length)} actividad${actividades.length === 1 ? '' : 'es'} del ${plan?.nombreCorto || 'plan'}.`
      });
    }
    return obs;
  }

  /* ---------------------------------------------------------------- */
  /* Búsqueda                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * Coincidencia por términos, sin librerías. Pesa más el título que el cuerpo
   * para que «no puedo editar» encuentre la pregunta y no cualquier respuesta
   * que mencione «editar» de pasada.
   */
  #buscar(texto) {
    const terminos = normalizar(texto).split(/\s+/).filter((t) => t.length > 2);
    if (!terminos.length) return [];

    const candidatos = [
      ...(this.contenido.preguntas || []).map((x) => ({
        titulo: x.p, cuerpo: x.r, claves: x.claves || [], tipo: 'pregunta'
      })),
      ...Object.entries(this.contenido.campos || {}).map(([id, x]) => ({
        titulo: x.titulo, cuerpo: x.texto, claves: [id], tipo: 'campo'
      })),
      ...(this.contenido.guia || []).map((x) => ({
        titulo: x.titulo, cuerpo: x.texto, claves: [], tipo: 'guia'
      }))
    ];

    return candidatos
      .map((c) => {
        const t = normalizar(c.titulo);
        const b = normalizar(c.cuerpo);
        const k = normalizar(c.claves.join(' '));
        let puntos = 0;
        for (const termino of terminos) {
          if (t.includes(termino)) puntos += 5;
          if (k.includes(termino)) puntos += 4;
          if (b.includes(termino)) puntos += 1;
        }
        return { ...c, puntos };
      })
      .filter((c) => c.puntos > 0)
      .sort((a, b) => b.puntos - a.puntos)
      .slice(0, 8);
  }

  /* ---------------------------------------------------------------- */
  /* Pintado                                                           */
  /* ---------------------------------------------------------------- */

  #pintarCuerpo() {
    for (const p of this.pestanas.querySelectorAll('.asistente__pestana')) {
      p.setAttribute('aria-selected', String(!this.busqueda && p.dataset.vista === this.vista));
    }

    if (this.busqueda) return this.#pintarBusqueda();
    if (this.vista === 'guia') return this.#pintarGuia();
    if (this.vista === 'preguntas') return this.#pintarPreguntas();
    return this.#pintarRevision();
  }

  #pintarRevision() {
    if (!this.observaciones.length) {
      render(this.cuerpo, el('div', { class: 'asistente__vacio' }, [
        this.#figura('asistente__figura asistente__figura--grande'),
        el('p', { class: 'asistente__vacio-titulo', text: 'Todo en orden por aquí' }),
        el('p', { class: 'texto-cuerpo', text: 'No encuentro vacíos ni incoherencias en lo que llevas. Si tienes una duda, búscala arriba.' })
      ]));
      return;
    }

    const ordenadas = [...this.observaciones].sort((a, b) => ORDEN[a.nivel] - ORDEN[b.nivel]);
    const propias = ordenadas.filter((o) => !o.conjunto);
    const conjunto = ordenadas.filter((o) => o.conjunto);
    const porAtender = ordenadas.filter((o) => o.nivel !== 'info').length;

    const bloque = (titulo, lista) => lista.length
      ? el('section', { class: 'asistente__bloque' }, [
          el('h3', { class: 'asistente__bloque-titulo', text: titulo }),
          ...lista.map((o) => this.#observacion(o))
        ])
      : null;

    render(this.cuerpo, ...[
      // Explica de dónde sale el número del botón, para que no haya que
      // contar tarjetas a ojo y descubrir que no cuadra.
      el('p', {
        class: 'asistente__resumen',
        text: porAtender
          ? `${numero(porAtender)} ${porAtender === 1 ? 'observación por atender' : 'observaciones por atender'}. El resto es información.`
          : 'Nada por atender. Lo de abajo es solo información.'
      }),
      bloque('En lo que estás llenando', propias),
      bloque('En lo ya guardado', conjunto)
    ].filter(Boolean));
  }

  /**
   * Una observación. Si tiene un destino, la tarjeta ENTERA es el botón: un
   * enlace de once píxeles dentro de un recuadro grande obliga a apuntar, y
   * quien está corrigiendo errores quiere pulsar rápido.
   */
  #observacion(o) {
    const cuerpo = [el('p', { class: 'asistente__obs-texto', text: o.texto })];

    // Caso 1: lleva a un campo del formulario. Toda la tarjeta es pulsable.
    if (o.campo) {
      return el('button', {
        class: `asistente__obs asistente__obs--${o.nivel} asistente__obs--accionable`,
        attrs: { type: 'button' },
        on: { click: () => this.#irAlCampo(o.campo) }
      }, [...cuerpo, el('span', { class: 'asistente__pista', text: 'Ir al campo →' })]);
    }

    // Caso 2: lleva a la guía.
    if (o.accion === 'guia') {
      return el('button', {
        class: `asistente__obs asistente__obs--${o.nivel} asistente__obs--accionable`,
        attrs: { type: 'button' },
        on: { click: () => { this.vista = 'guia'; this.#pintarCuerpo(); } }
      }, [...cuerpo, el('span', { class: 'asistente__pista', text: 'Ver la guía →' })]);
    }

    // Caso 3: apunta a varias actividades ya guardadas. No puede ser un botón
    // porque contiene botones: cada actividad se abre por separado.
    if (o.actividades?.length) {
      return el('div', { class: `asistente__obs asistente__obs--${o.nivel}` }, [
        ...cuerpo,
        el('div', { class: 'asistente__afectadas' }, this.#listaActividades(o.actividades))
      ]);
    }

    return el('div', { class: `asistente__obs asistente__obs--${o.nivel}` }, cuerpo);
  }

  /** Máximo de actividades listadas antes de resumir el resto. */
  static TOPE_AFECTADAS = 8;

  #listaActividades(lista) {
    const tope = Asistente.TOPE_AFECTADAS;
    const nodos = lista.slice(0, tope).map((a) => el('button', {
      class: 'asistente__afectada',
      attrs: {
        type: 'button',
        title: perfil.soloLectura ? 'Ver el detalle de esta actividad' : 'Abrir esta actividad para corregirla'
      },
      on: { click: () => this.#abrirActividad(a.id) }
    }, [
      el('span', { class: 'asistente__afectada-codigo', text: a.codigoActividad || '—' }),
      el('span', { class: 'asistente__afectada-nombre', text: a.nombreActividad || 'Sin nombre' }),
      el('span', { class: 'asistente__afectada-ir', text: '→', attrs: { 'aria-hidden': 'true' } })
    ]));

    if (lista.length > tope) {
      nodos.push(el('p', {
        class: 'asistente__afectadas-resto',
        text: `y ${numero(lista.length - tope)} más. Corrige estas y vuelve a mirar.`
      }));
    }
    return nodos;
  }

  /**
   * Abre una actividad ya guardada. Quien decide qué significa «abrir» es la
   * aplicación, no el asistente: en un perfil de solo lectura no hay formulario
   * al que cargarla, así que allá se muestra el detalle.
   */
  #abrirActividad(id) {
    const ctx = this.contexto?.() || {};
    if (typeof ctx.abrirActividad !== 'function') return;
    this.cerrar();
    ctx.abrirActividad(id);
  }

  #irAlCampo(id) {
    const nodo = document.getElementById(id);
    if (!nodo) return;
    this.cerrar();
    nodo.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    nodo.focus({ preventScroll: true });
    const grupo = nodo.closest('.campo');
    if (grupo) {
      grupo.classList.add('campo--senalado');
      setTimeout(() => grupo.classList.remove('campo--senalado'), 2200);
    }
  }

  #pintarPreguntas() {
    render(this.cuerpo, el('div', { class: 'asistente__lista' },
      (this.contenido.preguntas || []).map((q) => this.#desplegable(q.p, q.r))
    ));
  }

  #pintarGuia() {
    localStorage.setItem(CLAVE_GUIA_VISTA, '1');
    render(this.cuerpo, el('div', { class: 'asistente__lista' }, [
      el('p', { class: 'texto-cuerpo asistente__intro', text: 'El orden en que conviene llenar el formulario. Cada paso corresponde a una sección de la pantalla.' }),
      ...(this.contenido.guia || []).map((g) => el('div', { class: 'asistente__paso' }, [
        el('p', { class: 'asistente__paso-titulo', text: g.titulo }),
        el('p', { class: 'texto-cuerpo', text: g.texto })
      ]))
    ]));
  }

  #pintarBusqueda() {
    const resultados = this.#buscar(this.busqueda);
    if (!resultados.length) {
      render(this.cuerpo, el('div', { class: 'asistente__vacio' }, [
        el('p', { class: 'asistente__vacio-titulo', text: 'No encontré nada sobre eso' }),
        el('p', { class: 'texto-cuerpo', text: 'Este asistente busca en un banco de respuestas escritas, no las genera. Si la pregunta debería estar y no está, avísale a Control de Gestión para agregarla.' })
      ]));
      return;
    }
    const etiqueta = { pregunta: 'Pregunta frecuente', campo: 'Campo del formulario', guia: 'Guía' };
    render(this.cuerpo, el('div', { class: 'asistente__lista' },
      resultados.map((r) => this.#desplegable(r.titulo, r.cuerpo, etiqueta[r.tipo]))
    ));
  }

  #desplegable(titulo, texto, etiqueta) {
    return el('details', { class: 'asistente__item' }, [
      el('summary', {}, [
        etiqueta ? el('span', { class: 'asistente__etiqueta', text: etiqueta }) : null,
        el('span', { text: titulo })
      ].filter(Boolean)),
      el('p', { class: 'texto-cuerpo', text: texto })
    ]);
  }

  /* ---------------------------------------------------------------- */

  /** Explicación de un campo concreto, para abrirla desde el formulario. */
  explicarCampo(id) {
    const c = this.contenido.campos?.[id];
    if (!c) return false;
    this.mostrar();
    this.busqueda = '';
    this.buscador.value = '';
    this.abrir();
    render(this.cuerpo, el('div', { class: 'asistente__lista' }, [
      el('div', { class: 'asistente__paso' }, [
        el('p', { class: 'asistente__paso-titulo', text: c.titulo }),
        el('p', { class: 'texto-cuerpo', text: c.texto })
      ])
    ]));
    return true;
  }

  destruir() {
    document.removeEventListener('keydown', this.__alTeclear);
    this.raiz.remove();
  }
}
