/**
 * Circuito de aprobación (versión 3.14).
 *
 *   Borrador → En revisión → Aprobada
 *                  ↓    ↑
 *              Observada
 *
 * El equipo registra y envía a revisión; la jefatura de su departamento
 * aprueba u observa; Control de Gestión ve el avance de toda la institución.
 * Una actividad aprobada queda bloqueada hasta que la jefatura la reabre.
 *
 * Se enciende y se apaga desde «Más» → «Configuración» (ver ajustes.js). Este
 * módulo solo decide qué se MUESTRA y qué botones aparecen: las reglas de
 * verdad las aplica el servidor (docs/aprobacion.sql), que rechaza cualquier
 * cambio que no corresponda aunque alguien lo intente desde la consola.
 */

import { el, render, vaciar } from './dom.js';
import { abrirModal } from './ui.js';
import { numero, fecha } from './formato.js';
import { etiquetaDe } from './catalogos.js';
import { NOMBRE_ESTADO } from './modelo.js';
import { perfil } from './perfil.js';
import { ajustes } from './ajustes.js';

export { NOMBRE_ESTADO };

/** Etiqueta de color con el estado de una actividad. */
export function chipEstado(estado) {
  const e = NOMBRE_ESTADO[estado] ? estado : 'borrador';
  return el('span', { class: `estado estado--${e}`, text: NOMBRE_ESTADO[e] });
}

/** ¿La actividad es de quien está usando la plataforma? Lo local sin dueño, sí. */
const esMia = (a) => !a.propietario || a.propietario === perfil.id;

/** ¿Puede quien está usando la plataforma decidir sobre esta actividad? */
const decideSobre = (a) =>
  perfil.rol === 'control_gestion' ||
  (perfil.rol === 'jefatura' && a.departamento && a.departamento === perfil.departamento);

/**
 * Qué se puede hacer con una actividad según el perfil activo y su estado.
 * Con el circuito apagado, lo de siempre: editar y eliminar según el perfil.
 */
export function permisosSobre(a) {
  const p = perfil.permisos;
  if (!ajustes.circuitoActivo) {
    return { editar: p.puedeEditar, eliminar: p.puedeEliminar, enviar: false, aprobar: false, observar: false, reabrir: false };
  }
  const cg = perfil.rol === 'control_gestion';
  const propia = esMia(a) || cg;
  const bloqueada = a.estado === 'aprobada' && !cg;
  const decide = decideSobre(a);
  return {
    editar: p.puedeEditar && propia && !bloqueada,
    eliminar: p.puedeEliminar && propia && !bloqueada,
    enviar: p.puedeEditar && propia && (a.estado === 'borrador' || a.estado === 'observada'),
    aprobar: decide && a.estado === 'revision',
    observar: decide && a.estado === 'revision',
    reabrir: decide && a.estado === 'aprobada'
  };
}

/** Texto breve sobre la última decisión: «Aprobada por J. Pérez · 12-11-2026». */
export function lineaRevision(a) {
  const r = a.revision || {};
  if (a.estado === 'aprobada' && r.decididaPor) return `Aprobada por ${r.decididaPor}${r.decididaEn ? ` · ${fecha(r.decididaEn)}` : ''}`;
  if (a.estado === 'observada' && r.decididaPor) return `Observada por ${r.decididaPor}${r.decididaEn ? ` · ${fecha(r.decididaEn)}` : ''}`;
  if (a.estado === 'revision' && r.enviadaEn) return `Enviada a revisión · ${fecha(r.enviadaEn)}`;
  return '';
}

/**
 * Pide la observación para el equipo. Devuelve el texto, o null si se cancela.
 * @param {object[]} actividades  Las que se van a observar (para el título).
 */
export function pedirObservacion(actividades) {
  return new Promise((resolve) => {
    const area = el('textarea', {
      class: 'campo__control', id: 'textoObservacion',
      attrs: { rows: 4, maxlength: 1500, placeholder: 'Ej.: el medio de verificación es muy general; indica qué documento será.' }
    });
    const error = el('p', { class: 'campo__error', attrs: { hidden: true, role: 'alert' } });
    let resuelto = false;
    const terminar = (valor) => { if (!resuelto) { resuelto = true; resolve(valor); } };

    abrirModal({
      titulo: actividades.length === 1 ? 'Observar actividad' : `Observar ${actividades.length} actividades`,
      ancho: '540px',
      contenido: [
        actividades.length === 1 && el('p', { class: 'texto-cuerpo', text: actividades[0].nombreActividad }),
        el('div', { class: 'campo', style: { marginTop: '14px' } }, [
          el('label', { class: 'campo__etiqueta', attrs: { for: 'textoObservacion' }, text: 'Qué debe corregir el equipo' }),
          area,
          error,
          el('p', { class: 'campo__ayuda', text: 'La actividad vuelve al equipo como «Observada», con este comentario a la vista.' })
        ])
      ].filter(Boolean),
      alCerrar: () => terminar(null),
      acciones: [
        { texto: 'Cancelar', clase: 'btn--secundario', alHacerClic: (m) => { terminar(null); m.cerrar(); } },
        {
          texto: 'Devolver con observación', clase: 'btn--alerta',
          alHacerClic: (m) => {
            const texto = area.value.trim();
            if (!texto) {
              error.textContent = 'Escribe la observación para el equipo.';
              error.hidden = false;
              area.focus();
              return;
            }
            terminar(texto);
            m.cerrar();
          }
        }
      ]
    });
    setTimeout(() => area.focus(), 50);
  });
}

/* ------------------------------------------------------------------ */
/* Bloque sobre el listado: lo que a cada perfil le toca hacer          */
/* ------------------------------------------------------------------ */

/**
 * Se dibuja encima del listado y cambia según el perfil:
 *  - Equipo: recordatorio de lo que tiene en borrador u observado.
 *  - Jefatura: bandeja con lo que su departamento envió a revisión.
 *  - Control de Gestión y Observador: avance de toda la institución.
 * Abarca los dos planes: la revisión no se hace plan por plan.
 */
export class ZonaRevision {
  /**
   * @param {object} o
   * @param {HTMLElement} o.contenedor
   * @param {object} o.catalogos
   * @param {Function} o.alDecidir  (ids, decision) → Promise
   * @param {Function} o.alVer      (id, { origen, lista }) → abre la ficha en modo enfoque
   * @param {Function} o.nombrePlan (id) → nombre corto del plan
   */
  constructor({ contenedor, catalogos, alDecidir, alVer, nombrePlan }) {
    this.contenedor = contenedor;
    this.catalogos = catalogos;
    this.alDecidir = alDecidir;
    this.alVer = alVer;
    this.nombrePlan = nombrePlan;
    this.seleccion = new Set();
  }

  actualizar(actividades) {
    this.actividades = actividades;
    if (!ajustes.circuitoActivo) {
      vaciar(this.contenedor);
      this.contenedor.hidden = true;
      return;
    }
    const bloques = [];
    if (perfil.permisos.veTodo) bloques.push(this.#avance());
    else {
      if (perfil.rol === 'jefatura') bloques.push(this.#bandeja());
      const recordatorio = this.#recordatorio();
      if (recordatorio) bloques.push(recordatorio);
    }
    render(this.contenedor, ...bloques.filter(Boolean));
    this.contenedor.hidden = !this.contenedor.childElementCount;
  }

  #plazo() {
    const p = ajustes.aprobacion.plazo;
    return p ? el('span', { class: 'revision__plazo', text: `Plazo: ${fecha(p)}` }) : null;
  }

  /** Equipo: cuántas tiene sin enviar y cuántas le observaron. */
  #recordatorio() {
    const mias = this.actividades.filter((a) => esMia(a));
    const borradores = mias.filter((a) => a.estado === 'borrador').length;
    const observadas = mias.filter((a) => a.estado === 'observada').length;
    if (!borradores && !observadas) return null;

    const partes = [];
    if (observadas) partes.push(el('strong', { text: `${numero(observadas)} observada${observadas > 1 ? 's' : ''} por tu jefatura` }));
    if (observadas && borradores) partes.push(' y ');
    if (borradores) partes.push(el('strong', { text: `${numero(borradores)} en borrador` }));

    return el('div', { class: 'nota nota--info revision__recordatorio', attrs: { role: 'status' } }, [
      el('p', {}, [
        'Tienes ', ...partes, '. ',
        observadas
          ? 'Revisa las observaciones en el listado, corrige y vuelve a enviar.'
          : 'Cuando estén listas, envíalas a revisión de tu jefatura.',
        ajustes.aprobacion.plazo ? ` Plazo: ${fecha(ajustes.aprobacion.plazo)}.` : ''
      ])
    ]);
  }

  /** Jefatura: lo que su departamento envió a revisión, con aprobar y observar. */
  #bandeja() {
    const delDepto = this.actividades.filter((a) => a.departamento === perfil.departamento);
    const cuenta = (e) => delDepto.filter((a) => a.estado === e).length;
    const porRevisar = delDepto
      .filter((a) => a.estado === 'revision')
      .sort((a, b) => String(a.revision?.enviadaEn || '').localeCompare(String(b.revision?.enviadaEn || '')));

    // La selección sobrevive a los repintados, pero solo con lo que sigue por revisar.
    this.seleccion = new Set([...this.seleccion].filter((id) => porRevisar.some((a) => a.id === id)));

    const ficha = (titulo, n, clase = '') => el('div', { class: `revision__ficha ${clase}` }, [
      el('p', { class: 'revision__ficha-titulo', text: titulo }),
      el('p', { class: 'revision__ficha-valor', text: numero(n) })
    ]);

    const botonLote = el('button', {
      class: 'btn btn--exito', attrs: { type: 'button', disabled: !this.seleccion.size },
      text: this.seleccion.size ? `Aprobar las seleccionadas (${numero(this.seleccion.size)})` : 'Aprobar las seleccionadas',
      on: { click: () => this.alDecidir([...this.seleccion], 'aprobar') }
    });

    const marcarTodas = el('input', {
      attrs: { type: 'checkbox', 'aria-label': 'Seleccionar todas las actividades por revisar' },
      on: {
        change: (e) => {
          this.seleccion = e.target.checked ? new Set(porRevisar.map((a) => a.id)) : new Set();
          this.actualizar(this.actividades);
        }
      }
    });
    marcarTodas.checked = porRevisar.length > 0 && this.seleccion.size === porRevisar.length;

    const filas = porRevisar.map((a) => {
      const casilla = el('input', {
        attrs: { type: 'checkbox', 'aria-label': `Seleccionar «${a.nombreActividad}»` },
        on: {
          change: (e) => {
            if (e.target.checked) this.seleccion.add(a.id); else this.seleccion.delete(a.id);
            this.actualizar(this.actividades);
          }
        }
      });
      casilla.checked = this.seleccion.has(a.id);
      return el('div', { class: 'bandeja__fila', attrs: { role: 'row' } }, [
        el('span', { attrs: { role: 'cell' } }, [casilla]),
        el('span', { class: 'bandeja__actividad', attrs: { role: 'cell' } }, [
          el('button', {
            class: 'enlace-tabla', attrs: { type: 'button' }, text: a.nombreActividad || 'Actividad sin nombre',
            on: { click: (e) => this.alVer(a.id, { origen: e.currentTarget.closest('.bandeja__fila') || e.currentTarget, lista: porRevisar.map((x) => x.id) }) }
          }),
          el('span', {
            class: 'tabla__sub',
            text: [this.nombrePlan(a.plan), a.codigoActividad && `N° ${a.codigoActividad}`, a.responsable].filter(Boolean).join(' · ')
          })
        ]),
        el('span', { class: 'bandeja__fecha', attrs: { role: 'cell' }, text: a.revision?.enviadaEn ? fecha(a.revision.enviadaEn) : '' }),
        el('span', { class: 'bandeja__acciones', attrs: { role: 'cell' } }, [
          el('button', { class: 'btn btn--secundario btn--chico', attrs: { type: 'button' }, text: 'Observar', on: { click: () => this.alDecidir([a.id], 'observar') } }),
          el('button', { class: 'btn btn--exito btn--chico', attrs: { type: 'button' }, text: 'Aprobar', on: { click: () => this.alDecidir([a.id], 'aprobar') } })
        ])
      ]);
    });

    return el('section', { class: 'panel revision', attrs: { 'aria-labelledby': 'tituloRevision' } }, [
      el('div', { class: 'panel__cabecera' }, [
        el('div', {}, [
          el('h2', { class: 'panel__titulo', id: 'tituloRevision', text: 'Revisión del departamento' }),
          el('p', {
            class: 'panel__descripcion',
            text: `${etiquetaDe(this.catalogos.departamentos, perfil.departamento) || 'Tu departamento'} · ambos planes`
          })
        ]),
        this.#plazo()
      ].filter(Boolean)),
      el('div', { class: 'panel__cuerpo revision__cuerpo' }, [
        el('div', { class: 'revision__fichas' }, [
          ficha('Por revisar', porRevisar.length, porRevisar.length ? 'revision__ficha--destacada' : ''),
          ficha('Observadas', cuenta('observada')),
          ficha('Aprobadas', cuenta('aprobada')),
          ficha('En borrador', cuenta('borrador'))
        ]),
        porRevisar.length
          ? el('div', { class: 'bandeja', attrs: { role: 'table', 'aria-label': 'Actividades por revisar' } }, [
              el('div', { class: 'bandeja__fila bandeja__fila--cabecera', attrs: { role: 'row' } }, [
                el('span', { attrs: { role: 'columnheader' } }, [marcarTodas]),
                el('span', { attrs: { role: 'columnheader' }, text: 'Actividad por revisar' }),
                el('span', { attrs: { role: 'columnheader' }, text: 'Enviada' }),
                el('span', { attrs: { role: 'columnheader' }, text: 'Decisión' })
              ]),
              ...filas
            ])
          : el('p', { class: 'texto-cuerpo revision__vacio', text: 'No hay actividades esperando tu revisión.' }),
        porRevisar.length > 1 && el('div', { class: 'revision__lote' }, [botonLote])
      ].filter(Boolean))
    ]);
  }

  /** Control de Gestión: avance de la aprobación por departamento. */
  #avance() {
    const porDepto = new Map();
    for (const a of this.actividades) {
      const d = a.departamento || '';
      if (!porDepto.has(d)) porDepto.set(d, { borrador: 0, revision: 0, observada: 0, aprobada: 0, total: 0 });
      const c = porDepto.get(d);
      c[a.estado] += 1;
      c.total += 1;
    }
    const total = { borrador: 0, revision: 0, observada: 0, aprobada: 0, total: 0 };
    for (const c of porDepto.values()) for (const k of Object.keys(total)) total[k] += c[k];

    const filas = [...porDepto.entries()]
      .map(([d, c]) => ({ d, nombre: etiquetaDe(this.catalogos.departamentos, d) || 'Sin departamento', ...c }))
      .sort((x, y) => (x.aprobada / x.total) - (y.aprobada / y.total) || x.nombre.localeCompare(y.nombre, 'es'));

    const pct = (n, t) => (t ? Math.round((n / t) * 100) : 0);
    const barra = (c) => el('span', { class: 'avance__barra', attrs: { 'aria-hidden': 'true' } }, [
      el('span', { class: 'avance__tramo avance__tramo--aprobada', style: { width: `${pct(c.aprobada, c.total)}%` } }),
      el('span', { class: 'avance__tramo avance__tramo--revision', style: { width: `${pct(c.revision, c.total)}%` } }),
      el('span', { class: 'avance__tramo avance__tramo--observada', style: { width: `${pct(c.observada, c.total)}%` } })
    ]);

    const ficha = (titulo, n, clase) => el('div', { class: 'revision__ficha' }, [
      el('p', { class: 'revision__ficha-titulo', text: titulo }),
      el('p', { class: `revision__ficha-valor ${clase || ''}`, text: numero(n) })
    ]);

    return el('section', { class: 'panel revision', attrs: { 'aria-labelledby': 'tituloAvance' } }, [
      el('div', { class: 'panel__cabecera' }, [
        el('div', {}, [
          el('h2', { class: 'panel__titulo', id: 'tituloAvance', text: 'Avance de la aprobación' }),
          el('p', { class: 'panel__descripcion', text: 'Toda la institución · ambos planes' })
        ]),
        this.#plazo()
      ].filter(Boolean)),
      el('div', { class: 'panel__cuerpo revision__cuerpo' }, [
        el('div', { class: 'revision__fichas' }, [
          ficha(`Aprobadas · ${pct(total.aprobada, total.total)} %`, total.aprobada, 'texto--exito'),
          ficha('En revisión', total.revision),
          ficha('Observadas', total.observada),
          ficha('En borrador', total.borrador)
        ]),
        filas.length
          ? el('div', { class: 'tabla__contenedor' }, [
              el('table', { class: 'tabla avance' }, [
                el('caption', { class: 'visualmente-oculto', text: 'Avance de la aprobación por departamento' }),
                el('thead', {}, [el('tr', {}, [
                  el('th', { attrs: { scope: 'col' }, text: 'Departamento' }),
                  el('th', { class: 'col--num', attrs: { scope: 'col' }, text: 'Borrador' }),
                  el('th', { class: 'col--num', attrs: { scope: 'col' }, text: 'Revisión' }),
                  el('th', { class: 'col--num', attrs: { scope: 'col' }, text: 'Observadas' }),
                  el('th', { class: 'col--num', attrs: { scope: 'col' }, text: 'Aprobadas' }),
                  el('th', { attrs: { scope: 'col' }, text: 'Avance' })
                ])]),
                el('tbody', {}, filas.map((f) => el('tr', { class: f.aprobada === 0 ? 'avance__fila--sin' : '' }, [
                  el('td', { text: f.nombre }),
                  el('td', { class: 'col--num', text: numero(f.borrador) }),
                  el('td', { class: 'col--num', text: numero(f.revision) }),
                  el('td', { class: 'col--num', text: numero(f.observada) }),
                  el('td', { class: 'col--num', text: numero(f.aprobada) }),
                  el('td', {}, [el('span', { class: 'avance__celda' }, [barra(f), el('span', { class: 'avance__pct', text: `${pct(f.aprobada, f.total)} %` })])])
                ])))
              ])
            ])
          : el('p', { class: 'texto-cuerpo revision__vacio', text: 'Todavía no hay actividades registradas.' }),
        el('p', { class: 'avance__leyenda' }, [
          el('span', { class: 'avance__muestra avance__tramo--aprobada' }), 'Aprobadas',
          el('span', { class: 'avance__muestra avance__tramo--revision' }), 'En revisión',
          el('span', { class: 'avance__muestra avance__tramo--observada' }), 'Observadas',
          el('span', { class: 'avance__muestra avance__muestra--vacia' }), 'Borrador'
        ])
      ])
    ]);
  }
}
