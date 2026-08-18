/**
 * Listado de actividades: búsqueda, filtros, orden y acciones.
 * Todo el contenido se inserta como texto, nunca como HTML.
 */

import { el, render, vaciar, delegar, debounce, llenarSelect } from './dom.js';
import { monto, numero, fecha, recortar } from './formato.js';
import { etiquetaDe, aOpciones, buscarAsignacion } from './catalogos.js';
import { MESES, UNIDADES_TIEMPO } from './modelo.js';
import { abrirModal } from './ui.js';

export class TablaActividades {
  constructor({ contenedor, plan, catalogos, clasificador, acciones }) {
    this.contenedor = contenedor;
    this.plan = plan;
    this.catalogos = catalogos;
    this.clasificador = clasificador || { items: [] };
    this.acciones = acciones;         // { editar, duplicar, eliminar }
    this.actividades = [];
    this.filtro = { texto: '', departamento: '', tipo: '' };
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

    this.resumen = el('p', { class: 'tabla__resumen', attrs: { role: 'status' } });
    this.cuerpo = el('div', { class: 'tabla__contenedor' });

    render(this.contenedor, this.barra, this.resumen, this.cuerpo);

    delegar(this.cuerpo, 'click', '[data-accion]', (e, boton) => {
      const { accion, id } = boton.dataset;
      if (accion === 'detalle') this.#verDetalle(id);
      else this.acciones[accion]?.(id);
    });
  }

  actualizar(actividades) {
    this.actividades = actividades;
    this.pintar();
  }

  #filtradas() {
    const { texto, departamento, tipo } = this.filtro;
    return this.actividades.filter((a) => {
      if (departamento && a.departamento !== departamento) return false;
      if (tipo && a.tipoActividad !== tipo) return false;
      if (!texto) return true;
      const heno = [
        a.codigoActividad, a.nombreActividad, a.descripcionActividad, a.tema,
        a.objetivoEstrategicoTexto, a.objetivoOperacional, a.producto,
        a.resultadoInmediato, a.responsable, a.medioVerificacion
      ].join(' ').toLowerCase();
      return heno.includes(texto);
    });
  }

  pintar() {
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
            : 'Completa el formulario de arriba y guarda tu primera actividad.'
        })
      ]));
      return;
    }

    const columnas = [
      { id: 'codigoActividad', etiqueta: 'Código', clase: 'col--codigo' },
      { id: 'nombreActividad', etiqueta: 'Actividad' },
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
      el('tbody', {}, filas.map((a) => this.#fila(a, columnas)))
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
        case 'acciones':
          return el('td', { class: 'col--acciones' }, [
            el('div', { class: 'acciones-fila' }, [
              this.#boton('detalle', a.id, 'Ver', 'Ver detalle de la actividad'),
              this.#boton('editar', a.id, 'Editar', 'Editar la actividad'),
              this.#boton('duplicar', a.id, 'Duplicar', 'Crear una copia de la actividad'),
              this.#boton('eliminar', a.id, 'Eliminar', 'Eliminar la actividad', 'btn--peligro-texto')
            ])
          ]);
        default:
          return el('td', { text: a[col.id] || '—' });
      }
    };
    return el('tr', {}, columnas.map(celda));
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

  #verDetalle(id) {
    const a = this.actividades.find((x) => x.id === id);
    if (!a) return;

    const dato = (etiqueta, valor) => valor
      ? el('div', { class: 'detalle__dato' }, [
          el('dt', { text: etiqueta }),
          el('dd', { text: String(valor) })
        ])
      : null;

    const mesesConDatos = MESES.filter((m) => a.cronograma[m.id] > 0);

    abrirModal({
      titulo: a.nombreActividad || 'Actividad',
      ancho: '820px',
      contenido: [
        el('dl', { class: 'detalle__grilla' }, [
          dato('Código', a.codigoActividad),
          dato('Departamento', etiquetaDe(this.catalogos.departamentos, a.departamento)),
          dato('Responsable', a.responsable),
          dato('Correo', a.correoInstitucional),
          dato('Tipo', etiquetaDe(this.catalogos.tiposActividad, a.tipoActividad)),
          dato('Componente transversal', etiquetaDe(this.catalogos.componentesTransversales, a.componentesTransversales)),
          dato('Objetivo estratégico', a.objetivoEstrategico || a.objetivoEstrategicoTexto),
          dato('Tema', a.tema),
          dato('Objetivo de impacto', a.objetivoImpacto),
          dato('Resultado esperado', a.resultadoEsperado),
          dato('Resultado inmediato', a.resultadoInmediato),
          dato('Objetivo operacional', a.objetivoOperacional),
          dato('Producto', a.producto),
          dato('Registrada', fecha(a.creadaEn))
        ].filter(Boolean)),

        a.descripcionActividad && el('section', { class: 'detalle__bloque' }, [
          el('h3', { text: 'Descripción' }),
          el('p', { class: 'texto-cuerpo', text: a.descripcionActividad })
        ]),
        a.medioVerificacion && el('section', { class: 'detalle__bloque' }, [
          el('h3', { text: 'Medio de verificación' }),
          el('p', { class: 'texto-cuerpo', text: a.medioVerificacion })
        ]),

        el('section', { class: 'detalle__bloque' }, [
          el('h3', { text: `Cronograma · ${numero(a.totales.cronograma)} ejecuciones` }),
          mesesConDatos.length
            ? el('div', { class: 'chips' }, mesesConDatos.map((m) =>
                el('span', { class: 'chip', text: `${m.corto}: ${numero(a.cronograma[m.id])}` })))
            : el('p', { class: 'texto-cuerpo', text: 'Sin meses de ejecución registrados.' })
        ]),

        el('section', { class: 'detalle__bloque' }, [
          el('h3', { text: 'Presupuesto' }),
          a.sinPresupuesto
            ? el('p', { class: 'texto-cuerpo', text: 'Esta actividad no requiere presupuesto.' })
            : el('div', {}, ['21', '22'].map((st) => {
                const total = a.totales[`presupuesto${st}`];
                if (!total) return null;
                const b = a.presupuesto[st];
                return el('div', { class: 'detalle__subtitulo' }, [
                  el('p', { class: 'detalle__subtitulo-titulo', text: `Subtítulo ${st} · ${monto(total)}` }),
                  (b.programatico || b.programa) && el('p', { class: 'tabla__sub', text: [b.programatico, b.programa].filter(Boolean).join(' · ') }),
                  el('div', { class: 'chips' }, MESES.filter((m) => b.meses[m.id] > 0).map((m) =>
                    el('span', { class: 'chip', text: `${m.corto}: ${monto(b.meses[m.id])}` })))
                ].filter(Boolean));
              }).filter(Boolean)),
          !a.sinPresupuesto && el('p', { class: 'detalle__total', text: `Total: ${monto(a.totales.presupuesto)}` })
        ].filter(Boolean)),

        a.pac?.aplica && a.pac.compras.length && el('section', { class: 'detalle__bloque' }, [
          el('h3', { text: `Plan Anual de Compras · ${a.pac.compras.length} compra${a.pac.compras.length > 1 ? 's' : ''} · ${monto(a.totales.pac)}` }),
          ...a.pac.compras.map((c, i) => {
            const ref = buscarAsignacion(this.clasificador, c.clasificador);
            const unidad = UNIDADES_TIEMPO.find((u) => u.id === c.tiempoUnidad)?.nombre ?? c.tiempoUnidad;
            return el('div', { class: 'detalle__compra' }, [
              el('p', { class: 'detalle__subtitulo-titulo', text: `${i + 1}. ${c.producto || 'Sin producto indicado'}` }),
              ref && el('p', { class: 'tabla__sub', text: `${ref.item.nombre} · ${ref.asignacion.nombre}` }),
              el('div', { class: 'chips' }, [
                c.cantidad ? el('span', { class: 'chip', text: `Cantidad: ${numero(c.cantidad)}` }) : null,
                c.tiempoValor ? el('span', { class: 'chip', text: `Ejecución: ${numero(c.tiempoValor)} ${unidad}` }) : null,
                c.fechaCompra ? el('span', { class: 'chip', text: `Compra: ${fecha(c.fechaCompra)}` }) : null,
                c.fechaEjecucion ? el('span', { class: 'chip', text: `Ejecuta: ${fecha(c.fechaEjecucion)}` }) : null,
                el('span', { class: 'chip', text: monto(c.monto) })
              ].filter(Boolean))
            ].filter(Boolean));
          })
        ])
      ].filter(Boolean),
      acciones: [
        { texto: 'Cerrar', clase: 'btn--secundario', alHacerClic: (m) => m.cerrar() },
        { texto: 'Editar', clase: 'btn--primario', alHacerClic: (m) => { m.cerrar(); this.acciones.editar(id); } }
      ]
    });
  }
}
