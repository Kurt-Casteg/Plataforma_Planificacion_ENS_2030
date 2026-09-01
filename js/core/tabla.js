/**
 * Listado de actividades: búsqueda, filtros, orden y acciones.
 * Todo el contenido se inserta como texto, nunca como HTML.
 */

import { el, render, vaciar, delegar, debounce, llenarSelect } from './dom.js';
import { monto, numero, fecha, recortar } from './formato.js';
import { etiquetaDe, aOpciones, buscarAsignacion } from './catalogos.js';
import { MESES } from './modelo.js';
import { abrirModal } from './ui.js';
import { perfil } from './perfil.js';

export class TablaActividades {
  constructor({ contenedor, plan, catalogos, ens, clasificador, acciones }) {
    this.contenedor = contenedor;
    this.plan = plan;
    this.catalogos = catalogos;
    this.ens = ens || null;           // índice ENS: permite mostrar los textos, no solo los códigos
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
        case 'acciones': {
          // Los botones que escriben no se dibujan si el perfil activo no puede
          // hacerlo. No se deshabilitan: un botón apagado que nunca se va a
          // encender solo estorba.
          const p = perfil.permisos;
          return el('td', { class: 'col--acciones' }, [
            el('div', { class: 'acciones-fila' }, [
              this.#boton('detalle', a.id, 'Ver', 'Ver detalle de la actividad'),
              p.puedeEditar   && this.#boton('editar', a.id, 'Editar', 'Editar la actividad'),
              p.puedeCrear    && this.#boton('duplicar', a.id, 'Duplicar', 'Crear una copia de la actividad'),
              p.puedeEliminar && this.#boton('eliminar', a.id, 'Eliminar', 'Eliminar la actividad', 'btn--peligro-texto')
            ].filter(Boolean))
          ]);
        }
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

  #verDetalle(id) {
    const a = this.actividades.find((x) => x.id === id);
    if (!a) return;

    const dato = (etiqueta, valor, { completo = false } = {}) => valor
      ? el('div', { class: completo ? 'detalle__dato detalle__dato--completo' : 'detalle__dato' }, [
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
          dato('Responsable', a.responsable)
        ].filter(Boolean)),

        this.#cadenaResultados(a),

        el('dl', { class: 'detalle__grilla detalle__grilla--continua' }, [
          dato('Tipo de Actividad', etiquetaDe(this.catalogos.tiposActividad, a.tipoActividad)),
          dato('Componentes Transversales', etiquetaDe(this.catalogos.componentesTransversales, a.componentesTransversales)),
          dato('Nombre de la Actividad', a.nombreActividad, { completo: true })
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

        (a.sinPresupuesto || a.totales.presupuesto > 0) && el('section', { class: 'detalle__bloque' }, [
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
            return el('div', { class: 'detalle__compra' }, [
              el('p', { class: 'detalle__subtitulo-titulo', text: `${i + 1}. ${c.producto || 'Sin producto indicado'}` }),
              ref && el('p', { class: 'tabla__sub', text: `${ref.item.nombre} · ${ref.asignacion.nombre}` }),
              el('div', { class: 'chips' }, [
                c.cantidad ? el('span', { class: 'chip', text: `Cantidad: ${numero(c.cantidad)}` }) : null,
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
        perfil.permisos.puedeEditar
          ? { texto: 'Editar', clase: 'btn--primario', alHacerClic: (m) => { m.cerrar(); this.acciones.editar(id); } }
          : null
      ].filter(Boolean)
    });
  }
}
