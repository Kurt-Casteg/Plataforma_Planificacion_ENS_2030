/**
 * Análisis del Plan Anual de Compras (PAC).
 *
 * Reúne las compras declaradas en los dos planes y responde cuatro preguntas
 * que Adquisiciones y Control de Gestión se hacen antes de cerrar el PAC:
 *
 *  1. ¿Cuándo se concentran las compras?        → calendario mensual.
 *  2. ¿Qué compras llegan con poca holgura?     → solo si hay criterios de plazo.
 *  3. ¿Qué compras se repiten entre equipos?    → candidatas a consolidar.
 *  4. ¿Lo planificado cabe en el marco del ST22? → solo si hay marco cargado.
 *
 * Todo se puede apagar desde «Más» → «Configuración de la plataforma»: el
 * bloque entero (por ejemplo, mientras no haya información de presupuesto) y,
 * por separado, la holgura y el marco, que solo aparecen cuando Control de
 * Gestión carga sus datos. Sin datos no se muestra nada a medias.
 *
 * Cada quien ve lo que la base de datos le deja leer: un equipo, sus compras;
 * una jefatura, las de su departamento; Control de Gestión y Observador, todo.
 */

import { el, render } from './dom.js';
import { MESES } from './modelo.js';
import { monto, numero, fecha, recortar } from './formato.js';
import { etiquetaDe, buscarAsignacion } from './catalogos.js';
import { ajustes } from './ajustes.js';
import { perfil } from './perfil.js';
import { periodo } from './periodo.js';

const DIA = 24 * 60 * 60 * 1000;

/** Días entre dos fechas AAAA-MM-DD (b − a), o null si falta alguna. */
function diasEntre(a, b) {
  if (!a || !b) return null;
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / DIA);
}

/* ------------------------------------------------------------------ */
/* Parecido entre productos                                            */
/* ------------------------------------------------------------------ */

const VACIAS = new Set([
  'para', 'con', 'del', 'los', 'las', 'una', 'uno', 'unos', 'unas', 'por', 'que', 'sus',
  'servicio', 'servicios', 'compra', 'adquisicion', 'contratacion', 'insumos', 'materiales',
  'material', 'otros', 'otras', 'varios', 'varias', 'actividad', 'actividades'
]);

/** Palabras significativas de un producto, sin tildes, plurales ni terminaciones. */
function palabras(texto) {
  return new Set(String(texto || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9ñ]+/)
    .filter((p) => p.length > 2 && !VACIAS.has(p))
    // Raíz corta: «impresión» e «impresos», «educativo» y «educativas»
    // terminan en lo mismo. Basta para comparar nombres de productos.
    .map((p) => p.replace(/(es|s)$/, '').slice(0, 6)));
}

/**
 * ¿Dos productos son «parecidos»? Comparten al menos la mitad de las palabras
 * del más corto. Basta para juntar «Impresión de dípticos» con «Dípticos
 * impresos para campaña» sin juntar cosas que solo comparten el clasificador.
 */
function parecidos(a, b) {
  if (!a.size || !b.size) return false;
  let comunes = 0;
  for (const p of a) if (b.has(p)) comunes += 1;
  return comunes > 0 && comunes / Math.min(a.size, b.size) >= 0.5;
}

/* ------------------------------------------------------------------ */

export class AnalisisPac {
  constructor({ contenedor, catalogos, clasificador }) {
    this.contenedor = contenedor;
    this.catalogos = catalogos;
    this.clasificador = clasificador;
  }

  /** Recalcula y vuelve a dibujar con todas las actividades visibles. */
  actualizar(actividades = []) {
    const pac = ajustes.analisisPac;
    const compras = this.#compras(actividades);

    if (!pac.activo || !compras.length) {
      this.contenedor.hidden = true;
      render(this.contenedor);
      return;
    }

    const bloques = [
      this.#calendario(compras),
      this.#holgura(compras),
      perfil.permisos.veTodo ? this.#parecidas(compras) : null,
      this.#marco(actividades)
    ].filter(Boolean);

    const total = compras.reduce((s, c) => s + c.monto, 0);
    const deptos = new Set(compras.map((c) => c.departamento).filter(Boolean)).size;

    render(this.contenedor, el('section', { class: 'panel apac', attrs: { 'aria-labelledby': 'tituloPac' } }, [
      el('div', { class: 'panel__cabecera' }, [
        el('div', {}, [
          el('h2', { class: 'panel__titulo', id: 'tituloPac', text: 'Análisis del Plan Anual de Compras' }),
          el('p', {
            class: 'panel__descripcion',
            text: `${numero(compras.length)} ${compras.length === 1 ? 'compra' : 'compras'} · ${monto(total)}`
              + (deptos > 1 ? ` · ${numero(deptos)} departamentos` : '')
              + ' · incluye los dos planes y todas las actividades, aprobadas o no.'
          })
        ])
      ]),
      el('div', { class: 'panel__cuerpo apac__cuerpo' }, bloques)
    ]));
    this.contenedor.hidden = false;
  }

  /** Aplana las compras de todas las actividades, con su contexto. */
  #compras(actividades) {
    const lista = [];
    for (const a of actividades) {
      if (a.sinPresupuesto || !a.pac?.aplica) continue;
      for (const c of a.pac.compras ?? []) {
        lista.push({
          ...c,
          monto: Number(c.monto) || 0,
          actividad: a,
          departamento: a.departamento || '',
          palabras: palabras(c.producto)
        });
      }
    }
    return lista;
  }

  #depto(id) {
    return etiquetaDe(this.catalogos?.departamentos ?? [], id) || id || 'Sin departamento';
  }

  #nombreClasificador(codigo) {
    const r = buscarAsignacion(this.clasificador, codigo);
    return r ? `${r.asignacion.nombre}` : (codigo || 'Sin clasificador');
  }

  /* --------------------------- 1. Calendario ------------------------- */

  #calendario(compras) {
    const anio = periodo.anio;
    const meses = MESES.map((m) => ({ ...m, n: 0, total: 0, deptos: new Set() }));
    let sinFecha = 0;
    let fuera = 0;

    for (const c of compras) {
      if (!c.fechaCompra) { sinFecha += 1; continue; }
      const [y, m] = c.fechaCompra.split('-').map(Number);
      if (y !== anio) { fuera += 1; continue; }
      const mes = meses[m - 1];
      mes.n += 1;
      mes.total += c.monto;
      if (c.departamento) mes.deptos.add(c.departamento);
    }

    const maximo = Math.max(...meses.map((m) => m.total), 0);
    const peak = maximo > 0 ? meses.find((m) => m.total === maximo) : null;

    const columna = (m) => {
      const detalle = `${m.largo}: ${numero(m.n)} ${m.n === 1 ? 'compra' : 'compras'}, ${monto(m.total)}`
        + (m.deptos.size ? `, ${numero(m.deptos.size)} ${m.deptos.size === 1 ? 'departamento' : 'departamentos'}` : '');
      return el('div', { class: `apac-cal__mes${m === peak ? ' apac-cal__mes--peak' : ''}`, attrs: { title: detalle } }, [
        el('span', { class: 'apac-cal__valor', text: m.total ? numero(Math.round(m.total)) : '' }),
        el('span', { class: 'apac-cal__pista' }, [
          el('span', {
            class: 'apac-cal__barra',
            style: { height: maximo ? `${Math.max(m.total ? 3 : 0, (m.total / maximo) * 100)}%` : '0' }
          })
        ]),
        el('span', { class: 'apac-cal__etiqueta', text: m.corto })
      ]);
    };

    const avisos = [];
    if (sinFecha) avisos.push(`${numero(sinFecha)} sin fecha de compra`);
    if (fuera) avisos.push(`${numero(fuera)} con fecha fuera de ${anio}`);

    return el('div', { class: 'apac__bloque' }, [
      el('div', { class: 'apac__encabezado' }, [
        el('h3', { class: 'apac__titulo', text: 'Calendario de compras · según la fecha estimada de compra' }),
        peak && el('span', {
          class: 'apac__etiqueta',
          text: `Mes con más compras: ${peak.largo.toLowerCase()} · ${numero(peak.n)} ${peak.n === 1 ? 'compra' : 'compras'} · ${monto(peak.total)}`
        })
      ]),
      el('div', { class: 'apac-cal', attrs: { role: 'img', 'aria-label': `Monto de compras por mes de ${anio}, en miles de pesos.` } },
        meses.map(columna)),
      el('p', { class: 'apac__nota' }, [
        'Montos en M$. Pasa el cursor por un mes para ver cuántas compras y departamentos reúne.',
        avisos.length ? ` Quedan fuera del calendario: ${avisos.join(' y ')}.` : ''
      ]),
      // La misma información en una tabla, para lectores de pantalla y para
      // quien prefiere el número exacto.
      el('details', { class: 'apac__datos' }, [
        el('summary', { text: 'Ver la tabla del calendario' }),
        el('div', { class: 'tabla__contenedor' }, [
          el('table', { class: 'tabla' }, [
            el('thead', {}, [el('tr', {}, [
              el('th', { text: 'Mes', attrs: { scope: 'col' } }),
              el('th', { text: 'Compras', attrs: { scope: 'col' } }),
              el('th', { text: 'Monto', attrs: { scope: 'col' } }),
              el('th', { text: 'Departamentos', attrs: { scope: 'col' } })
            ])]),
            el('tbody', {}, meses.map((m) => el('tr', {}, [
              el('td', { text: m.largo }),
              el('td', { text: numero(m.n) }),
              el('td', { text: monto(m.total) }),
              el('td', { text: numero(m.deptos.size) })
            ])))
          ])
        ])
      ])
    ]);
  }

  /* --------------------------- 2. Holgura ---------------------------- */

  /**
   * Días entre la compra y la ejecución, contra el plazo mínimo que define
   * Adquisiciones según el monto. Sin criterios cargados, el bloque no existe:
   * inventar un plazo sería peor que no decir nada.
   */
  #holgura(compras) {
    const criterios = ajustes.criteriosHolgura;
    if (!criterios.length) return null;

    const exigido = (m) => (criterios.find((c) => c.hasta === null || m <= c.hasta) ?? criterios.at(-1)).dias;

    const ajustadas = [];
    let evaluadas = 0;
    for (const c of compras) {
      const dias = diasEntre(c.fechaCompra, c.fechaEjecucion);
      if (dias === null) continue;
      evaluadas += 1;
      const minimo = exigido(c.monto);
      if (dias < minimo) ajustadas.push({ ...c, dias, minimo });
    }
    ajustadas.sort((a, b) => (a.dias - a.minimo) - (b.dias - b.minimo));

    const criterioTexto = criterios.map((c, i) => {
      const desde = i === 0 ? null : criterios[i - 1].hasta;
      const tramo = c.hasta === null
        ? (desde === null ? 'cualquier monto' : `sobre ${monto(desde)}`)
        : (desde === null ? `hasta ${monto(c.hasta)}` : `de ${monto(desde)} a ${monto(c.hasta)}`);
      return `${tramo}: ${numero(c.dias)} días`;
    }).join(' · ');

    const fila = (c) => el('li', { class: 'apac-lista__item' }, [
      el('span', {
        class: `apac-chip ${c.dias < 0 ? 'apac-chip--peligro' : 'apac-chip--alerta'}`,
        text: c.dias < 0 ? 'Ejecución antes de la compra' : `${numero(c.dias)} de ${numero(c.minimo)} días`
      }),
      el('span', { class: 'apac-lista__texto' }, [
        el('strong', { text: recortar(c.producto || this.#nombreClasificador(c.clasificador), 70) }),
        ` · ${recortar(c.actividad.nombreActividad, 60)} · ${this.#depto(c.departamento)} · ${monto(c.monto)}`,
        el('span', { class: 'apac-lista__fechas', text: ` · compra ${fecha(c.fechaCompra)}, ejecución ${fecha(c.fechaEjecucion)}` })
      ])
    ]);

    const visibles = ajustadas.slice(0, 8);
    const resto = ajustadas.slice(8);

    return el('div', { class: 'apac__bloque' }, [
      el('div', { class: 'apac__encabezado' }, [
        el('h3', { class: 'apac__titulo', text: 'Compras con poca holgura' }),
        el('span', {
          class: `apac__etiqueta ${ajustadas.length ? 'apac__etiqueta--alerta' : 'apac__etiqueta--exito'}`,
          text: ajustadas.length
            ? `${numero(ajustadas.length)} de ${numero(evaluadas)} con fechas`
            : `Las ${numero(evaluadas)} compras con fechas tienen plazo suficiente`
        })
      ]),
      el('p', { class: 'apac__nota', text: `Días entre la fecha estimada de compra y la de ejecución, comparados con el plazo mínimo de Adquisiciones (${criterioTexto}).` }),
      ajustadas.length > 0 ? el('ul', { class: 'apac-lista' }, visibles.map(fila)) : null,
      resto.length > 0 ? el('details', { class: 'apac__datos' }, [
        el('summary', { text: `Ver ${numero(resto.length)} más` }),
        el('ul', { class: 'apac-lista' }, resto.map(fila))
      ]) : null
    ]);
  }

  /* ------------------------ 3. Compras parecidas --------------------- */

  /**
   * Mismo clasificador y producto parecido en dos o más departamentos:
   * candidatas a una sola compra, lo que además previene el fraccionamiento.
   */
  #parecidas(compras) {
    const porClasificador = new Map();
    for (const c of compras) {
      if (!c.clasificador || !c.departamento) continue;
      if (!porClasificador.has(c.clasificador)) porClasificador.set(c.clasificador, []);
      porClasificador.get(c.clasificador).push(c);
    }

    const grupos = [];
    for (const [codigo, lista] of porClasificador) {
      if (new Set(lista.map((c) => c.departamento)).size < 2) continue;
      // Agrupa por parecido (unión de vecinos): A~B y B~C quedan juntos.
      const padre = lista.map((_, i) => i);
      const raiz = (i) => (padre[i] === i ? i : (padre[i] = raiz(padre[i])));
      for (let i = 0; i < lista.length; i += 1) {
        for (let j = i + 1; j < lista.length; j += 1) {
          if (parecidos(lista[i].palabras, lista[j].palabras)) padre[raiz(i)] = raiz(j);
        }
      }
      const clusters = new Map();
      lista.forEach((c, i) => {
        const r = raiz(i);
        if (!clusters.has(r)) clusters.set(r, []);
        clusters.get(r).push(c);
      });
      for (const miembros of clusters.values()) {
        const deptos = new Set(miembros.map((c) => c.departamento));
        if (deptos.size < 2) continue;
        grupos.push({ codigo, miembros, deptos, total: miembros.reduce((s, c) => s + c.monto, 0) });
      }
    }
    grupos.sort((a, b) => b.deptos.size - a.deptos.size || b.total - a.total);

    const rangoMeses = (miembros) => {
      const ms = miembros.map((c) => c.fechaCompra).filter(Boolean).map((f) => Number(f.slice(5, 7))).sort((a, b) => a - b);
      if (!ms.length) return 'sin fechas';
      const n = (m) => MESES[m - 1].largo.toLowerCase();
      return ms[0] === ms.at(-1) ? n(ms[0]) : `${n(ms[0])} a ${n(ms.at(-1))}`;
    };

    const grupo = (g) => el('li', { class: 'apac-grupo' }, [
      el('details', {}, [
        el('summary', {}, [
          el('span', { class: 'apac-grupo__titulo', text: `${this.#nombreClasificador(g.codigo)} · ${recortar(g.miembros[0].producto, 60)}` }),
          el('span', {
            class: 'apac-grupo__detalle',
            text: `${numero(g.miembros.length)} compras · ${numero(g.deptos.size)} departamentos · ${monto(g.total)} · ${rangoMeses(g.miembros)}`
          })
        ]),
        el('ul', { class: 'apac-grupo__miembros' }, g.miembros.map((c) => el('li', {}, [
          el('strong', { text: this.#depto(c.departamento) }),
          ` · ${recortar(c.producto, 80)} · ${monto(c.monto)}`,
          c.fechaCompra ? ` · ${fecha(c.fechaCompra)}` : '',
          el('span', { class: 'apac-lista__fechas', text: ` · ${recortar(c.actividad.nombreActividad, 60)}` })
        ])))
      ])
    ]);

    return el('div', { class: 'apac__bloque' }, [
      el('div', { class: 'apac__encabezado' }, [
        el('h3', { class: 'apac__titulo', text: 'Compras parecidas en varios departamentos' }),
        el('span', {
          class: 'apac__etiqueta',
          text: grupos.length ? `${numero(grupos.length)} ${grupos.length === 1 ? 'grupo' : 'grupos'}` : 'Sin coincidencias'
        })
      ]),
      el('p', { class: 'apac__nota' }, [
        'Mismo clasificador y producto parecido. Son candidatas a ',
        el('strong', { text: 'consolidar en una sola compra' }),
        ', lo que además previene el fraccionamiento.'
      ]),
      grupos.length
        ? el('ul', { class: 'apac-grupos' }, grupos.slice(0, 12).map(grupo))
        : el('p', { class: 'texto-cuerpo', text: 'No se encontraron compras parecidas entre departamentos.' })
    ]);
  }

  /* ------------------------ 4. Marco presupuestario ------------------ */

  /**
   * Lo planificado en el subtítulo 22 frente al marco que carga Control de
   * Gestión por departamento. Una jefatura ve solo el suyo; un equipo, nada:
   * el marco es del departamento, no de una actividad.
   */
  #marco(actividades) {
    if (!perfil.permisos.veTodo && perfil.rol !== 'jefatura') return null;
    const marco = ajustes.marcoDe(periodo.anio);
    let deptos = Object.keys(marco);
    if (!perfil.permisos.veTodo) deptos = deptos.filter((d) => d === perfil.departamento);
    if (!deptos.length) return null;

    const planificado = new Map();
    for (const a of actividades) {
      if (a.sinPresupuesto) continue;
      const v = Number(a.totales?.presupuesto22) || 0;
      if (v) planificado.set(a.departamento, (planificado.get(a.departamento) || 0) + v);
    }

    const filas = deptos
      .map((d) => ({ d, marco: marco[d], plan: planificado.get(d) || 0 }))
      .map((f) => ({ ...f, pct: f.marco ? (f.plan / f.marco) * 100 : 0 }))
      .sort((a, b) => b.pct - a.pct);

    const nivel = (p) => (p > 100 ? 'exceso' : p >= 90 ? 'alerta' : 'ok');

    return el('div', { class: 'apac__bloque' }, [
      el('div', { class: 'apac__encabezado' }, [
        el('h3', { class: 'apac__titulo', text: `Planificado frente al marco presupuestario · subtítulo 22 · ${periodo.anio}` }),
        el('span', { class: 'apac__etiqueta', text: 'Marco cargado por Control de Gestión' })
      ]),
      el('ul', { class: 'apac-marco' }, filas.map((f) => el('li', { class: `apac-marco__fila apac-marco__fila--${nivel(f.pct)}` }, [
        el('span', { class: 'apac-marco__depto', text: this.#depto(f.d) }),
        el('span', { class: 'apac-marco__pista', attrs: { 'aria-hidden': 'true' } }, [
          el('span', { class: 'apac-marco__barra', style: { width: `${Math.min(100, f.pct)}%` } })
        ]),
        el('span', {
          class: 'apac-marco__cifra',
          text: `${monto(f.plan)} de ${monto(f.marco)} · ${numero(Math.round(f.pct))} %${f.pct > 100 ? ' · sobre el marco' : ''}`
        })
      ]))),
      el('p', { class: 'apac__nota', text: 'Verde: bajo 90 % · ámbar: entre 90 y 100 % · rojo: sobre el marco. Suma el subtítulo 22 de todas las actividades del departamento en los dos planes.' })
    ]);
  }
}
