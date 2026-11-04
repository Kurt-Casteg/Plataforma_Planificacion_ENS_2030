/**
 * Listado de actividades: búsqueda, filtros, orden y acciones.
 * Todo el contenido se inserta como texto, nunca como HTML.
 */

import { el, render, vaciar, delegar, debounce, llenarSelect } from './dom.js';
import { monto, numero, fecha, recortar } from './formato.js';
import { etiquetaDe, aOpciones, buscarAsignacion } from './catalogos.js';
import { MESES, ESTADOS, NOMBRE_ESTADO } from './modelo.js';
import { abrirEnfoque, navegacionEnfoque } from './enfoque.js';
import { perfil } from './perfil.js';
import { ajustes } from './ajustes.js';
import { chipEstado, permisosSobre, lineaRevision } from './aprobacion.js';

export class TablaActividades {
  constructor({ contenedor, plan, catalogos, ens, clasificador, acciones }) {
    this.contenedor = contenedor;
    this.plan = plan;
    this.catalogos = catalogos;
    this.ens = ens || null;           // índice ENS: permite mostrar los textos, no solo los códigos
    this.clasificador = clasificador || { items: [] };
    this.acciones = acciones;         // { editar, duplicar, eliminar }
    this.actividades = [];
    this.filtro = { texto: '', departamento: '', tipo: '', estado: '' };
    this.orden = { campo: 'codigoActividad', asc: true };
    this.#dibujar();
  }

  #dibujar() {
    const buscador = el('input', {
      class: 'campo__control', id: 'buscadorActividades',
      attrs: { type: 'search', placeholder: 'Buscar por nombre, código, objetivo…', 'aria-label': 'Buscar actividades' }
    });
    buscador.addEventListener('input', debounce(() => {
      this.filtro.texto = buscador.value.trim().toLowerCase();
      this.pintar();
    }, 180));

    const filtroDepto = el('select', { class: 'campo__control', attrs: { 'aria-label': 'Filtrar por departamento' } });
    llenarSelect(filtroDepto, aOpciones(this.catalogos.departamentos), { placeholder: 'Todos los departamentos' });
    filtroDepto.addEventListener('change', () => { this.filtro.departamento = filtroDepto.value; this.pintar(); });

    const filtroTipo = el('select', { class: 'campo__control', attrs: { 'aria-label': 'Filtrar por tipo de actividad' } });
    llenarSelect(filtroTipo, aOpciones(this.catalogos.tiposActividad), { placeholder: 'Todos los tipos' });
    filtroTipo.addEventListener('change', () => { this.filtro.tipo = filtroTipo.value; this.pintar(); });

    this.barra = el('div', { class: 'tabla__barra' }, [
      el('div', { class: 'tabla__busqueda' }, [buscador]),
      filtroDepto,
      filtroTipo
    ]);

    // Filtro por estado del circuito de aprobación: solo se ve con el circuito
    // encendido (se rehace en cada pintada porque los totales cambian).
    this.filtrosEstado = el('div', { class: 'filtro-estados', attrs: { role: 'group', 'aria-label': 'Filtrar por estado' } });

    this.resumen = el('p', { class: 'tabla__resumen', attrs: { role: 'status' } });
    this.cuerpo = el('div', { class: 'tabla__contenedor' });

    render(this.contenedor, this.barra, this.filtrosEstado, this.resumen, this.cuerpo);

    delegar(this.cuerpo, 'click', '[data-accion]', (e, boton) => {
      const { accion, id } = boton.dataset;
      // La ficha crece desde su fila: así se entiende de dónde salió.
      if (accion === 'detalle') this.#verDetalle(id, { origen: boton.closest('tr') || boton });
      else this.acciones[accion]?.(id);
    });
  }

  actualizar(actividades) {
    this.actividades = actividades;
    this.pintar();
    this.#refrescarFicha();
  }

  #filtradas() {
    const { texto, departamento, tipo, estado } = this.filtro;
    const conEstado = ajustes.circuitoActivo;
    return this.actividades.filter((a) => {
      if (departamento && a.departamento !== departamento) return false;
      if (tipo && a.tipoActividad !== tipo) return false;
      if (conEstado && estado && a.estado !== estado) return false;
      if (!texto) return true;
      const heno = [
        a.codigoActividad, a.nombreActividad, a.descripcionActividad, a.tema,
        a.objetivoEstrategicoTexto, a.objetivoOperacional, a.producto,
        a.resultadoInmediato, a.responsable, a.medioVerificacion
      ].join(' ').toLowerCase();
      return heno.includes(texto);
    });
  }

  #pintarFiltrosEstado() {
    const activo = ajustes.circuitoActivo;
    this.filtrosEstado.hidden = !activo || !this.actividades.length;
    if (!activo) { this.filtro.estado = ''; vaciar(this.filtrosEstado); return; }
    const cuenta = (e) => this.actividades.filter((a) => a.estado === e).length;
    const opcion = (valor, etiqueta, n) => el('button', {
      class: `filtro-estados__opcion${this.filtro.estado === valor ? ' filtro-estados__opcion--activa' : ''}`,
      attrs: { type: 'button', 'aria-pressed': String(this.filtro.estado === valor) },
      text: `${etiqueta} · ${numero(n)}`,
      on: { click: () => { this.filtro.estado = valor; this.pintar(); } }
    });
    render(this.filtrosEstado,
      opcion('', 'Todas', this.actividades.length),
      ...ESTADOS.map((e) => opcion(e, e === 'observada' ? 'Observadas' : e === 'aprobada' ? 'Aprobadas' : NOMBRE_ESTADO[e], cuenta(e)))
    );
  }

  pintar() {
    this.#pintarFiltrosEstado();
    const filas = this.#filtradas();
    const totalPres = filas.reduce((s, a) => s + a.totales.presupuesto, 0);
    const totalEjec = filas.reduce((s, a) => s + a.totales.cronograma, 0);

    vaciar(this.resumen);
    if (!this.actividades.length) {
      this.resumen.append('Aún no registras actividades en este plan.');
    } else {
      this.resumen.append(
        `${numero(filas.length)} de ${numero(this.actividades.length)} actividad${this.actividades.length === 1 ? '' : 'es'} · `,
        el('strong', { text: `${numero(totalEjec)} ejecuciones` }),
        ' · ',
        el('strong', { text: monto(totalPres) })
      );
    }

    if (!filas.length) {
      render(this.cuerpo, el('div', { class: 'vacio' }, [
        el('p', { class: 'vacio__titulo', text: this.actividades.length ? 'Sin coincidencias' : 'Todavía no hay actividades' }),
        el('p', {
          class: 'vacio__texto',
          text: this.actividades.length
            ? 'Ajusta la búsqueda o los filtros para ver resultados.'
            : perfil.soloLectura
              ? 'Todavía no hay nada registrado en este plan para mostrar.'
              : 'Completa el formulario de arriba y guarda tu primera actividad.'
        })
      ]));
      return;
    }

    const columnas = [
      { id: 'codigoActividad', etiqueta: 'Código', clase: 'col--codigo' },
      { id: 'nombreActividad', etiqueta: 'Actividad' },
      ...(ajustes.circuitoActivo ? [{ id: 'estado', etiqueta: 'Estado' }] : []),
      { id: 'departamento', etiqueta: 'Departamento' },
      ...(this.plan.id === 'pns'
        ? [{ id: 'tema', etiqueta: 'Tema' }]
        : [{ id: 'objetivoOperacional', etiqueta: 'Objetivo operacional' }]),
      { id: 'tipoActividad', etiqueta: 'Tipo' },
      { id: 'cronograma', etiqueta: 'Ejec.', clase: 'col--num' },
      { id: 'presupuesto', etiqueta: 'Presupuesto', clase: 'col--num' },
      { id: 'acciones', etiqueta: 'Acciones', clase: 'col--acciones' }
    ];

    const tabla = el('table', { class: 'tabla' }, [
      el('caption', { class: 'visualmente-oculto', text: `Actividades registradas del ${this.plan.nombre}` }),
      el('thead', {}, [
        el('tr', {}, columnas.map((c) => el('th', {
          class: c.clase || '', text: c.etiqueta, attrs: { scope: 'col' }
        })))
      ]),
      el('tbody', {}, filas.flatMap((a) => this.#filasDe(a, columnas)))
    ]);

    render(this.cuerpo, tabla);
  }

  #fila(a, columnas) {
    const celda = (col) => {
      switch (col.id) {
        case 'codigoActividad':
          return el('td', { class: 'col--codigo', text: a.codigoActividad || '—' });
        case 'nombreActividad':
          return el('td', {}, [
            el('button', {
              class: 'enlace-tabla', attrs: { type: 'button' },
              dataset: { accion: 'detalle', id: a.id },
              text: a.nombreActividad
            }),
            a.responsable && el('span', { class: 'tabla__sub', text: a.responsable })
          ]);
        case 'departamento':
          return el('td', { text: etiquetaDe(this.catalogos.departamentos, a.departamento) || '—' });
        case 'estado': {
          const linea = lineaRevision(a);
          return el('td', { class: 'col--estado' }, [
            chipEstado(a.estado),
            linea && el('span', { class: 'tabla__sub', text: linea })
          ]);
        }
        case 'tipoActividad':
          return el('td', {}, [a.tipoActividad
            ? el('span', { class: 'etiqueta', text: etiquetaDe(this.catalogos.tiposActividad, a.tipoActividad) })
            : '—']);
        case 'tema':
          return el('td', { class: 'col--texto', text: recortar(a.tema, 40) || '—', attrs: { title: a.tema || '' } });
        case 'objetivoOperacional':
          return el('td', { class: 'col--texto', text: recortar(a.objetivoOperacional, 50) || '—', attrs: { title: a.objetivoOperacional || '' } });
        case 'cronograma':
          return el('td', { class: 'col--num', text: numero(a.totales.cronograma) });
        case 'presupuesto':
          return el('td', { class: 'col--num' }, [
            a.sinPresupuesto
              ? el('span', { class: 'etiqueta etiqueta--neutra', text: 'Sin presupuesto' })
              : el('span', { text: monto(a.totales.presupuesto) })
          ]);
        case 'acciones': {
          // Los botones que escriben no se dibujan si el perfil activo no puede
          // hacerlo. No se deshabilitan: un botón apagado que nunca se va a
          // encender solo estorba.
          const p = perfil.permisos;
          const puede = permisosSobre(a);
          return el('td', { class: 'col--acciones' }, [
            el('div', { class: 'acciones-fila' }, [
              this.#boton('detalle', a.id, 'Ver', 'Ver detalle de la actividad'),
              puede.enviar    && this.#boton('enviar', a.id, a.estado === 'observada' ? 'Reenviar' : 'Enviar', 'Enviar a revisión de la jefatura', 'btn--accion'),
              puede.observar  && this.#boton('observar', a.id, 'Observar', 'Devolver al equipo con una observación'),
              puede.aprobar   && this.#boton('aprobar', a.id, 'Aprobar', 'Aprobar la actividad', 'btn--exito-texto'),
              puede.reabrir   && this.#boton('reabrir', a.id, 'Reabrir', 'Reabrir para que el equipo pueda modificarla'),
              puede.editar    && this.#boton('editar', a.id, 'Editar', 'Editar la actividad'),
              p.puedeCrear    && this.#boton('duplicar', a.id, 'Duplicar', 'Crear una copia de la actividad'),
              puede.eliminar  && this.#boton('eliminar', a.id, 'Eliminar', 'Eliminar la actividad', 'btn--peligro-texto')
            ].filter(Boolean))
          ]);
        }
        default:
          return el('td', { text: a[col.id] || '—' });
      }
    };
    return el('tr', {}, columnas.map(celda));
  }

  /** La fila de la actividad y, si está observada, la observación debajo. */
  #filasDe(a, columnas) {
    const fila = this.#fila(a, columnas);
    if (!ajustes.circuitoActivo || a.estado !== 'observada' || !a.revision?.observacion) return [fila];
    fila.classList.add('fila--observada');
    return [fila, el('tr', { class: 'fila-observacion' }, [
      el('td', { attrs: { colspan: columnas.length } }, [
        el('div', { class: 'observacion' }, [
          el('p', {
            class: 'observacion__titulo',
            text: `Observación${a.revision.decididaPor ? ` de ${a.revision.decididaPor}` : ''}${a.revision.decididaEn ? ` · ${fecha(a.revision.decididaEn)}` : ''}`
          }),
          el('p', { class: 'observacion__texto', text: a.revision.observacion })
        ])
      ])
    ])];
  }

  #boton(accion, id, texto, titulo, claseExtra = '') {
    return el('button', {
      class: `btn btn--icono ${claseExtra}`,
      attrs: { type: 'button', title: titulo, 'aria-label': `${titulo}` },
      dataset: { accion, id },
      text: texto
    });
  }

  /* ---------------------------------------------------------------- */
  /* Detalle                                                           */
  /* ---------------------------------------------------------------- */

  /**
   * Cadena de resultados con el texto completo de cada nivel, no solo el código.
   * Para el PNS se resuelve contra el índice ENS; para los demás planes se
   * muestran los campos de texto que el propio plan define.
   */
  #cadenaResultados(a) {
    const nivel = (etiqueta, codigo, texto) => {
      const cuerpo = texto || codigo;
      if (!cuerpo) return null;
      const mostrarCodigo = codigo && texto && codigo !== texto;
      return el('div', { class: 'ruta__nivel' }, [
        // El espacio se reserva siempre, aunque el nivel no tenga código
        // propio (el Tema), para que todas las etiquetas queden alineadas.
        el('span', { class: 'ruta__codigo', text: mostrarCodigo ? String(codigo) : '' }),
        el('div', { class: 'ruta__cuerpo' }, [
          el('p', { class: 'ruta__etiqueta', text: etiqueta }),
          el('p', { class: 'ruta__texto', text: String(cuerpo) })
        ])
      ]);
    };

    let niveles;
    if (this.ens) {
      const v = {
        oe: a.objetivoEstrategico,
        tema: a.tema,
        oi: a.objetivoImpacto,
        re: a.resultadoEsperado,
        ri: a.resultadoInmediato
      };
      const texto = (n) => {
        try { return this.ens.nombreDe(n, v) || ''; } catch { return ''; }
      };
      niveles = [
        nivel('Objetivo Estratégico', v.oe, texto('objetivoEstrategico')),
        nivel('Tema', v.tema, texto('tema')),
        nivel('Objetivo de Impacto', v.oi, texto('objetivoImpacto')),
        nivel('Resultado Esperado', v.re, texto('resultadoEsperado')),
        nivel('Resultado Inmediato', v.ri, texto('resultadoInmediato'))
      ];
    } else {
      niveles = [
        nivel('Objetivo Estratégico', '', a.objetivoEstrategicoTexto || a.objetivoEstrategico),
        nivel('Objetivo Operacional', '', a.objetivoOperacional),
        nivel('Producto', '', a.producto)
      ];
    }

    const visibles = niveles.filter(Boolean);
    if (!visibles.length) return null;

    return el('section', { class: 'detalle__bloque' }, [
      el('h3', { text: 'Cadena de resultados' }),
      el('div', { class: 'ruta' }, visibles)
    ]);
  }

  /**
   * Abre la ficha de una actividad desde fuera del listado: la bandeja de la
   * jefatura (con su lista de pendientes para recorrerla) o el asistente.
   *
   * @param {string} id
   * @param {object} [o]
   * @param {Element} [o.origen]   Desde dónde crece la ficha.
   * @param {string[]} [o.lista]   Qué recorren «Anterior» y «Siguiente».
   */
  verDetalle(id, opciones = {}) { this.#verDetalle(id, opciones); }

  /* ---------------------------------------------------------------- */
  /* Ficha en modo enfoque                                             */
  /* ---------------------------------------------------------------- */

  #verDetalle(id, { origen = null, lista = null } = {}) {
    const existe = (x) => this.actividades.some((a) => a.id === x);
    if (!existe(id)) return;
    // «Anterior» y «Siguiente» recorren lo que se está viendo: el listado con
    // sus filtros, o la lista que mandó quien abrió la ficha.
    let ids = (lista?.length ? lista : this.#filtradas().map((a) => a.id)).filter(existe);
    if (!ids.includes(id)) ids = [id];

    if (this.ficha?.enfoque.abierto) this.ficha.enfoque.cerrar();
    const enfoque = abrirEnfoque({
      etiqueta: 'Ficha de la actividad',
      origen,
      ancho: '980px',
      clase: 'foco',
      alNavegar: (paso) => this.#moverFicha(paso),
      alCerrar: () => { if (this.ficha?.enfoque === enfoque) this.ficha = null; }
    });
    this.ficha = { enfoque, ids, indice: ids.indexOf(id), version: '' };
    this.#pintarFicha(0);
    enfoque.entrar();
  }

  #moverFicha(paso) {
    const f = this.ficha;
    if (!f || f.ids.length < 2) return;
    f.indice = (f.indice + paso + f.ids.length) % f.ids.length;
    this.#pintarFicha(paso);
  }

  /** Con la ficha abierta, una actividad que cambió (aquí o en otro equipo) se redibuja. */
  #refrescarFicha() {
    const f = this.ficha;
    if (!f?.enfoque.abierto) return;
    f.ids = f.ids.filter((x) => this.actividades.some((a) => a.id === x));
    if (!f.ids.length) { f.enfoque.cerrar(); return; }
    f.indice = Math.min(f.indice, f.ids.length - 1);
    const a = this.actividades.find((x) => x.id === f.ids[f.indice]);
    if (`${a.actualizadaEn}|${a.estado}` !== f.version) this.#pintarFicha(0);
  }

  #pintarFicha(direccion) {
    const f = this.ficha;
    if (!f) return;
    const a = this.actividades.find((x) => x.id === f.ids[f.indice]);
    if (!a) { f.enfoque.cerrar(); return; }
    f.version = `${a.actualizadaEn}|${a.estado}`;
    const idTitulo = `ficha-titulo-${a.id}`;

    const cabecera = el('header', { class: 'enfoque__cabecera' }, [
      el('div', { class: 'foco__encabezado' }, [
        el('div', { class: 'foco__etiquetas' }, [
          ajustes.circuitoActivo ? chipEstado(a.estado) : null,
          el('span', { class: 'foco__codigo', text: `${a.codigoActividad ? `N° ${a.codigoActividad} · ` : ''}${this.plan.nombre}` })
        ].filter(Boolean)),
        el('h2', { class: 'foco__titulo', id: idTitulo, text: a.nombreActividad || 'Actividad sin nombre' }),
        el('p', {
          class: 'foco__meta',
          text: [
            etiquetaDe(this.catalogos.departamentos, a.departamento),
            a.responsable,
            a.tipoActividad && etiquetaDe(this.catalogos.tiposActividad, a.tipoActividad)
          ].filter(Boolean).join(' · ')
        })
      ]),
      el('button', {
        class: 'enfoque__cerrar', attrs: { type: 'button', 'aria-label': 'Cerrar la ficha' }, text: '×',
        on: { click: () => f.enfoque.cerrar() }
      })
    ]);

    const observada = ajustes.circuitoActivo && a.estado === 'observada' && a.revision?.observacion;

    const cuerpo = [
      observada && el('div', { class: 'observacion foco__observacion' }, [
        el('p', { class: 'observacion__titulo', text: `Observación${a.revision.decididaPor ? ` de ${a.revision.decididaPor}` : ''}${a.revision.decididaEn ? ` · ${fecha(a.revision.decididaEn)}` : ''}` }),
        el('p', { class: 'observacion__texto', text: a.revision.observacion })
      ]),
      el('div', { class: 'foco__columnas' }, [
        el('div', { class: 'foco__columna' }, [
          this.#cadenaResultados(a),
          a.componentesTransversales && el('section', { class: 'detalle__bloque' }, [
            el('h3', { text: 'Componente transversal' }),
            el('p', { class: 'texto-cuerpo', text: etiquetaDe(this.catalogos.componentesTransversales, a.componentesTransversales) })
          ]),
          el('section', { class: 'detalle__bloque' }, [
            el('h3', { text: 'Descripción' }),
            el('p', { class: 'texto-cuerpo', text: a.descripcionActividad || 'Sin descripción.' })
          ]),
          el('section', { class: 'detalle__bloque' }, [
            el('h3', { text: 'Medio de verificación' }),
            el('p', { class: 'texto-cuerpo', text: a.medioVerificacion || 'Sin medio de verificación.' })
          ])
        ].filter(Boolean)),
        el('div', { class: 'foco__columna' }, [
          this.#miniCronograma(a),
          this.#bloquePresupuesto(a),
          this.#bloqueCompras(a),
          this.#bloqueRevision(a)
        ].filter(Boolean))
      ])
    ].filter(Boolean);

    f.enfoque.mostrar({
      etiqueta: `Ficha de la actividad «${a.nombreActividad || 'sin nombre'}»`,
      direccion,
      cabecera,
      cuerpo,
      pie: el('footer', { class: 'enfoque__pie' }, [
        navegacionEnfoque({ indice: f.indice, total: f.ids.length, alMover: (p) => this.#moverFicha(p), nombre: 'Actividad' }) || el('span'),
        el('div', { class: 'enfoque__acciones' }, this.#accionesFicha(a))
      ])
    });
  }

  /** Doce barras: cuándo se ejecuta, de un vistazo. */
  #miniCronograma(a) {
    const valores = MESES.map((m) => Number(a.cronograma?.[m.id]) || 0);
    const max = Math.max(...valores, 1);
    return el('section', { class: 'detalle__bloque' }, [
      el('div', { class: 'foco__bloque-cabecera' }, [
        el('h3', { text: 'Cronograma' }),
        el('span', { class: 'foco__lateral', text: `${numero(a.totales.cronograma)} ejecuci${a.totales.cronograma === 1 ? 'ón' : 'ones'}` })
      ]),
      el('div', {
        class: 'mini-crono',
        attrs: { role: 'img', 'aria-label': `Ejecuciones por mes: ${MESES.map((m, i) => `${m.largo} ${valores[i]}`).join(', ')}.` }
      }, MESES.map((m, i) => el('span', { class: 'mini-crono__mes', attrs: { title: `${m.largo}: ${numero(valores[i])}` } }, [
        el('span', { class: `mini-crono__barra${valores[i] ? '' : ' mini-crono__barra--vacia'}`, style: { height: `${Math.round((valores[i] / max) * 100)}%` } })
      ]))),
      el('div', { class: 'mini-crono__etiquetas', attrs: { 'aria-hidden': 'true' } }, MESES.map((m) => el('span', { text: m.corto.slice(0, 1) })))
    ]);
  }

  #bloquePresupuesto(a) {
    if (a.sinPresupuesto) {
      return el('section', { class: 'detalle__bloque' }, [
        el('h3', { text: 'Presupuesto' }),
        el('p', { class: 'texto-cuerpo', text: 'Esta actividad no requiere presupuesto.' })
      ]);
    }
    const ficha = (titulo, valor, clase = '') => el('div', { class: `foco__monto ${clase}`.trim() }, [
      el('p', { class: 'foco__monto-titulo', text: titulo }),
      el('p', { class: 'foco__monto-valor', text: monto(valor) })
    ]);
    const lineas = ['21', '22'].map((st) => {
      const b = a.presupuesto?.[st];
      if (!a.totales[`presupuesto${st}`] || !(b?.programatico || b?.programa)) return null;
      return el('p', { class: 'tabla__sub', text: `ST${st}: ${[b.programatico, b.programa].filter(Boolean).join(' · ')}` });
    }).filter(Boolean);
    const meses = ['21', '22'].flatMap((st) => {
      const b = a.presupuesto?.[st];
      const conMonto = MESES.filter((m) => b?.meses?.[m.id] > 0);
      return conMonto.length ? [el('div', { class: 'detalle__subtitulo' }, [
        el('p', { class: 'detalle__subtitulo-titulo', text: `Subtítulo ${st}` }),
        el('div', { class: 'chips' }, conMonto.map((m) => el('span', { class: 'chip', text: `${m.corto}: ${monto(b.meses[m.id])}` })))
      ])] : [];
    });
    return el('section', { class: 'detalle__bloque' }, [
      el('h3', { text: 'Presupuesto' }),
      el('div', { class: 'foco__montos' }, [
        ficha('Subtítulo 21', a.totales.presupuesto21),
        ficha('Subtítulo 22', a.totales.presupuesto22),
        ficha('Total', a.totales.presupuesto, 'foco__monto--total')
      ]),
      ...lineas,
      meses.length ? el('details', { class: 'foco__desplegable' }, [el('summary', { text: 'Montos por mes' }), ...meses]) : null
    ].filter(Boolean));
  }

  #bloqueCompras(a) {
    if (!a.pac?.aplica || !a.pac.compras.length) return null;
    const n = a.pac.compras.length;
    return el('section', { class: 'detalle__bloque' }, [
      el('div', { class: 'foco__bloque-cabecera' }, [
        el('h3', { text: 'Plan Anual de Compras' }),
        el('span', { class: 'foco__lateral', text: `${n} compra${n > 1 ? 's' : ''} · ${monto(a.totales.pac)}` })
      ]),
      el('ul', { class: 'foco__compras' }, a.pac.compras.map((c) => {
        const ref = buscarAsignacion(this.clasificador, c.clasificador);
        const detalle = [
          ref && ref.asignacion.nombre,
          c.cantidad && `Cantidad ${numero(c.cantidad)}`,
          c.fechaCompra && `compra ${fecha(c.fechaCompra)}`,
          c.fechaEjecucion && `ejecución ${fecha(c.fechaEjecucion)}`
        ].filter(Boolean).join(' · ');
        return el('li', { class: 'foco__compra' }, [
          el('div', { class: 'foco__compra-texto' }, [
            el('p', { class: 'foco__compra-producto', text: c.producto || 'Sin producto indicado' }),
            detalle && el('p', { class: 'tabla__sub', text: detalle }),
            c.criticaSGC && el('span', { class: 'chip chip--sgc', text: 'Crítica para el SGC' })
          ].filter(Boolean)),
          el('strong', { class: 'foco__compra-monto', text: monto(c.monto) })
        ]);
      }))
    ]);
  }

  /** Estado en el circuito de aprobación y su historial. */
  #bloqueRevision(a) {
    if (!ajustes.circuitoActivo) return null;
    const r = a.revision || {};
    const historial = (r.historial || []).slice().reverse();
    const linea = lineaRevision(a);
    return el('section', { class: 'detalle__bloque foco__revision' }, [
      el('h3', { text: 'Revisión' }),
      el('p', { class: 'foco__revision-linea', text: linea || (a.estado === 'borrador' ? 'En borrador: todavía no se envía a revisión.' : NOMBRE_ESTADO[a.estado]) }),
      a.estado === 'aprobada' && !permisosSobre(a).editar && el('p', {
        class: 'tabla__sub', text: 'Aprobada: queda bloqueada. Si hay que cambiarla, la jefatura puede reabrirla.'
      }),
      historial.length > 0 && el('details', { class: 'detalle__historial' }, [
        el('summary', { text: `Historial (${historial.length})` }),
        el('ol', {}, historial.map((h) => el('li', {}, [
          el('strong', { text: NOMBRE_ESTADO[h.estado] || h.estado }),
          ` · ${fecha(h.en)}${h.por ? ` · ${h.por}` : ''}`,
          h.observacion ? el('span', { class: 'detalle__historial-obs', text: `«${h.observacion}»` }) : null
        ].filter(Boolean))))
      ])
    ].filter(Boolean));
  }

  #accionesFicha(a) {
    const puede = permisosSobre(a);
    const f = this.ficha;
    const boton = (texto, clase, alHacerClic) => el('button', {
      class: `btn ${clase}`, attrs: { type: 'button' }, text: texto, on: { click: alHacerClic }
    });
    // Editar y duplicar llevan al formulario: la ficha se cierra primero.
    const fuera = (accion) => () => { f.enfoque.cerrar(); this.acciones[accion]?.(a.id); };
    const botones = [
      puede.reabrir && boton('Reabrir', 'btn--secundario', () => this.#decidirEnFicha('reabrir', a.id)),
      puede.editar && boton('Editar', 'btn--secundario', fuera('editar')),
      puede.enviar && boton(a.estado === 'observada' ? 'Reenviar a revisión' : 'Enviar a revisión', 'btn--primario', () => this.#decidirEnFicha('enviar', a.id)),
      puede.observar && boton('Observar', 'btn--observar', () => this.#decidirEnFicha('observar', a.id)),
      puede.aprobar && boton('Aprobar', 'btn--exito', () => this.#decidirEnFicha('aprobar', a.id))
    ].filter(Boolean);
    return botones.length ? botones : [boton('Cerrar', 'btn--secundario', () => f.enfoque.cerrar())];
  }

  /**
   * Aprobar, observar, reabrir o enviar sin salir de la ficha. Tras aprobar u
   * observar, la ficha pasa sola a la siguiente actividad por revisar: la
   * jefatura recorre su bandeja sin volver al listado entre una y otra.
   */
  async #decidirEnFicha(accion, id) {
    const antes = this.actividades.find((x) => x.id === id)?.estado;
    await this.acciones[accion]?.(id);
    const f = this.ficha;
    if (!f?.enfoque.abierto) return;
    const ahora = this.actividades.find((x) => x.id === id)?.estado;
    if (ahora === antes || (accion !== 'aprobar' && accion !== 'observar')) { this.#pintarFicha(0); return; }

    const orden = [...f.ids.slice(f.indice + 1), ...f.ids.slice(0, f.indice)];
    const siguiente = orden.find((x) => this.actividades.find((a) => a.id === x)?.estado === 'revision');
    if (!siguiente) { this.#pintarFicha(0); return; }
    // Una pausa breve: alcanza a verse el cambio de estado antes de avanzar.
    setTimeout(() => {
      if (this.ficha !== f || !f.enfoque.abierto) return;
      f.indice = f.ids.indexOf(siguiente);
      this.#pintarFicha(1);
    }, 450);
  }
}
