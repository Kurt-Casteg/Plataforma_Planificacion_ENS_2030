/**
 * Panel de análisis: indicadores clave y gráficos.
 *
 * Reglas de visualización aplicadas:
 *  - Los números individuales van como fichas, no como gráficos de una barra.
 *  - Magnitud comparada → barras con una sola rampa azul (secuencial).
 *  - Dos series identificables (subtítulo 21 / 22) → paleta categórica validada
 *    para daltonismo, con leyenda siempre presente.
 *  - Cada gráfico ofrece su tabla de datos, para lectores de pantalla y para
 *    quien prefiere el número exacto.
 */

import { el, render, vaciar } from './dom.js';
import { MESES, IDS_MESES, SUBTITULOS } from './modelo.js';
import { monto, numero, recortar } from './formato.js';
import { etiquetaDe } from './catalogos.js';
import { abrirEnfoque, navegacionEnfoque } from './enfoque.js';

/**
 * Chart.js se sirve desde el propio sitio (carpeta vendor/): la plataforma
 * funciona en redes institucionales que bloquean CDN externas y sin internet.
 * La CDN queda solo como respaldo.
 */
const CHART_JS = [
  new URL('../../vendor/chart.umd.js', import.meta.url).href,
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js'
];

/**
 * Copia profunda de una configuración de Chart.js que conserva las funciones
 * (formatos, tooltips). El gráfico ampliado no puede compartir los arreglos de
 * datos con el chico: Chart.js los vigila y los dos se pisarían.
 */
function clonar(v) {
  if (Array.isArray(v)) return v.map(clonar);
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clonar(x)]));
  }
  return v;
}

/** Lee un token CSS del tema activo (se recalcula al cambiar de tema). */
const token = (nombre) => getComputedStyle(document.documentElement).getPropertyValue(nombre).trim();

let promesaChart = null;
/** Carga Chart.js una sola vez y solo cuando hay algo que graficar. */
function cargarChartJs() {
  if (globalThis.Chart) return Promise.resolve(globalThis.Chart);
  if (promesaChart) return promesaChart;
  promesaChart = CHART_JS.reduce(
    (cadena, url) => cadena.catch(() => new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url;
      s.referrerPolicy = 'no-referrer';
      s.onload = () => (globalThis.Chart ? resolve(globalThis.Chart) : reject(new Error('Chart no disponible')));
      s.onerror = () => reject(new Error(`No se pudo cargar ${url}`));
      document.head.append(s);
    })),
    Promise.reject(new Error('inicio'))
  ).catch((e) => { promesaChart = null; throw e; });

  return promesaChart;
}

export class Panel {
  constructor({ contenedor, plan, catalogos, nombresOE = new Map() }) {
    this.contenedor = contenedor;
    this.plan = plan;
    this.catalogos = catalogos;
    this.nombresOE = nombresOE;
    this.graficos = new Map();
    this.actividades = [];   // todo lo registrado en el plan
    this.datos = [];         // lo que se está graficando (tras el filtro)
    this.filtro = { departamento: '' };
    this.lienzos = new Map();
    // Lo necesario para ampliar un gráfico: su configuración y su tabla.
    this.configs = new Map();
    this.tablas = new Map();
    // Algunos gráficos muestran en la tarjeta solo las categorías principales;
    // al ampliarlos se ven todas, con su propia configuración.
    this.configsAmpliados = new Map();
    this.ampliado = null;             // { enfoque, id, grafico }
    this.#dibujarEsqueleto();

    // Redibuja los gráficos cuando cambia el tema (los colores vienen de tokens).
    this.observadorTema = new MutationObserver(() => this.#pintarGraficos());
    this.observadorTema.observe(document.documentElement, { attributes: true, attributeFilter: ['data-tema'] });
  }

  #dibujarEsqueleto() {
    // El filtro va en una sola fila sobre el contenido: alcanza a las fichas,
    // a todos los gráficos y a sus tablas de datos, para que las cifras siempre
    // hablen del mismo conjunto.
    this.selectorDepto = el('select', {
      class: 'campo__control', id: 'filtroPanelDepartamento',
      attrs: { 'aria-label': 'Filtrar el panel por departamento' }
    });
    this.selectorDepto.addEventListener('change', () => {
      this.filtro.departamento = this.selectorDepto.value;
      this.#refrescar();
    });

    this.botonLimpiar = el('button', {
      class: 'btn btn--fantasma', attrs: { type: 'button' }, text: 'Ver todos',
      on: { click: () => { this.selectorDepto.value = ''; this.filtro.departamento = ''; this.#refrescar(); } }
    });

    this.resumenFiltro = el('p', { class: 'panel-filtros__resumen', attrs: { role: 'status' } });

    this.barraFiltros = el('div', { class: 'panel-filtros' }, [
      el('label', { class: 'panel-filtros__etiqueta', text: 'Departamento', attrs: { for: 'filtroPanelDepartamento' } }),
      this.selectorDepto,
      this.botonLimpiar,
      this.resumenFiltro
    ]);

    this.kpis = el('div', { class: 'kpis' });
    this.zonaGraficos = el('div', { class: 'graficos' });
    this.vacio = el('div', { class: 'vacio' }, [
      el('p', { class: 'vacio__titulo', text: 'El panel se activa con tu primera actividad' }),
      el('p', { class: 'vacio__texto', text: 'Cuando guardes actividades verás aquí el resumen de ejecuciones y presupuesto.' })
    ]);
    render(this.contenedor, this.barraFiltros, this.vacio, this.kpis, this.zonaGraficos);
    this.barraFiltros.hidden = true;
    this.kpis.hidden = true;
    this.zonaGraficos.hidden = true;
  }

  actualizar(actividades) {
    this.actividades = actividades;
    this.#poblarFiltro();
    this.#refrescar();
  }

  /**
   * Ofrece solo los departamentos que tienen actividades: un desplegable con
   * opciones que no filtran nada solo hace perder tiempo. Conserva la selección
   * vigente aunque la lista cambie.
   */
  #poblarFiltro() {
    const presentes = [...new Set(this.actividades.map((a) => a.departamento).filter(Boolean))]
      .map((id) => ({ id, nombre: etiquetaDe(this.catalogos.departamentos, id) || id }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

    // Si el departamento filtrado se quedó sin actividades, se vuelve a "todos".
    if (this.filtro.departamento && !presentes.some((d) => d.id === this.filtro.departamento)) {
      this.filtro.departamento = '';
    }

    vaciar(this.selectorDepto);
    this.selectorDepto.append(
      el('option', { text: `Todos los departamentos (${numero(presentes.length)})`, attrs: { value: '' } }),
      ...presentes.map((d) => el('option', { text: d.nombre, attrs: { value: d.id } }))
    );
    this.selectorDepto.value = this.filtro.departamento;
    // Con un solo departamento el filtro no aporta nada.
    this.barraFiltros.hidden = presentes.length < 2;
    this.botonLimpiar.hidden = !this.filtro.departamento;
  }

  #refrescar() {
    const { departamento } = this.filtro;
    this.datos = departamento
      ? this.actividades.filter((a) => a.departamento === departamento)
      : this.actividades.slice();

    this.botonLimpiar.hidden = !departamento;
    vaciar(this.resumenFiltro);
    if (departamento) {
      this.resumenFiltro.append(`Mostrando ${numero(this.datos.length)} de ${numero(this.actividades.length)} actividades.`);
    }

    const hay = this.datos.length > 0;
    this.vacio.hidden = hay;
    this.kpis.hidden = !hay;
    this.zonaGraficos.hidden = !hay;

    if (!hay) {
      this.#destruirGraficos();
      const [titulo, texto] = this.actividades.length
        ? ['Sin actividades en este departamento', 'Cambia el filtro o elige «Todos los departamentos».']
        : ['El panel se activa con tu primera actividad', 'Cuando guardes actividades verás aquí el resumen de ejecuciones y presupuesto.'];
      this.vacio.firstElementChild.textContent = titulo;
      this.vacio.lastElementChild.textContent = texto;
      return;
    }

    this.#pintarKpis();
    this.#pintarGraficos();
  }

  /* ---------------------------------------------------------------- */
  /* Indicadores clave                                                 */
  /* ---------------------------------------------------------------- */

  #pintarKpis() {
    const a = this.datos;
    const totalPres = a.reduce((s, x) => s + x.totales.presupuesto, 0);
    const totalEjec = a.reduce((s, x) => s + x.totales.cronograma, 0);
    const sinPres = a.filter((x) => x.sinPresupuesto).length;
    const deptos = new Set(a.map((x) => x.departamento).filter(Boolean)).size;
    const porSt = Object.fromEntries(
      SUBTITULOS.map((st) => [st, a.reduce((s, x) => s + (x.totales[`presupuesto${st}`] || 0), 0)])
    );

    const ficha = (etiqueta, valor, detalle, { acento = false, titulo = '' } = {}) =>
      el('article', {
        class: acento ? 'kpi kpi--presupuesto' : 'kpi',
        attrs: titulo ? { title: titulo } : {}
      }, [
        el('p', { class: 'kpi__etiqueta', text: etiqueta }),
        el('p', { class: 'kpi__valor', text: valor }),
        // El pie se dibuja siempre, aunque venga vacío: las tres franjas de
        // cada ficha se alinean entre sí, y para eso todas deben tener las
        // mismas tres piezas.
        el('p', { class: 'kpi__detalle', text: detalle || '' })
      ]);

    /** «M$ 750 · 34 % del total» — la parte sirve de poco sin el todo. */
    const detalleSt = (st) => {
      const con = a.filter((x) => !x.sinPresupuesto && (x.totales[`presupuesto${st}`] || 0) > 0).length;
      const parte = totalPres > 0 ? `${Math.round((porSt[st] / totalPres) * 100)} % del total` : 'Sin montos cargados';
      return `${parte} · ${numero(con)} actividad${con === 1 ? '' : 'es'}`;
    };
    // El nombre oficial completo («Subtítulo 22 - Bienes y Servicios de Consumo»)
    // ocupa tres líneas en la ficha: en la etiqueta va la versión corta y el
    // nombre completo queda como título accesible al pasar el cursor.
    const CORTO = { 21: 'Personal', 22: 'Bienes y servicios' };
    const nombreSt = (st) => this.catalogos.subtitulos?.find((s) => s.id === st)?.nombre || `Subtítulo ${st}`;

    render(this.kpis,
      ficha('Actividades', numero(a.length), `${numero(sinPres)} sin presupuesto asociado`),
      ficha('Ejecuciones programadas', numero(totalEjec), 'Suma del cronograma anual'),
      ficha('Departamentos', numero(deptos), 'Unidades con actividades registradas'),
      ficha('Presupuesto total', monto(totalPres), `Equivale a $${new Intl.NumberFormat('es-CL').format(totalPres * 1000)}`),
      ficha(`Subtítulo 21 · ${CORTO[21]}`, monto(porSt['21']), detalleSt('21'), { acento: true, titulo: nombreSt('21') }),
      ficha(`Subtítulo 22 · ${CORTO[22]}`, monto(porSt['22']), detalleSt('22'), { acento: true, titulo: nombreSt('22') })
    );
  }

  /* ---------------------------------------------------------------- */
  /* Gráficos                                                          */
  /* ---------------------------------------------------------------- */

  #tarjeta(id, titulo, subtitulo, { ancho = false, alto = false } = {}) {
    const lienzo = el('canvas', { id: `lienzo-${id}`, attrs: { role: 'img', 'aria-label': `${titulo}. ${subtitulo}` } });
    const detalle = el('details', { class: 'tabla-datos' }, [
      el('summary', { text: 'Ver los datos en tabla' })
    ]);
    // «Ampliar» abre el gráfico en modo enfoque, con su tabla al lado.
    const ampliar = el('button', {
      class: 'grafico__ampliar',
      attrs: { type: 'button', 'aria-label': `Ampliar el gráfico «${titulo}»`, title: 'Ampliar' },
      // Ícono fijo del propio código (no lleva datos de nadie).
      html: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg><span>Ampliar</span>',
      on: { click: (e) => this.#ampliar(id, { origen: tarjeta, boton: e.currentTarget }) }
    });
    const tarjeta = el('article', {
      class: `grafico${ancho ? ' grafico--ancho' : ''}${alto ? ' grafico--alto' : ''}`
    }, [
      el('div', { class: 'grafico__cabecera' }, [
        el('div', { class: 'grafico__textos' }, [
          el('h3', { class: 'grafico__titulo', text: titulo }),
          el('p', { class: 'grafico__subtitulo', text: subtitulo })
        ]),
        ampliar
      ]),
      el('div', { class: 'grafico__lienzo' }, [lienzo]),
      detalle
    ]);
    this.lienzos.set(id, { lienzo, detalle, tarjeta, titulo, subtitulo });
    return tarjeta;
  }

  async #pintarGraficos() {
    if (!this.datos.length) return;

    // Reconstruye las tarjetas (el conjunto depende del plan).
    vaciar(this.zonaGraficos);
    this.lienzos.clear();
    this.configs.clear();
    this.tablas.clear();
    this.configsAmpliados.clear();
    this.#destruirGraficos();

    // Todas las tarjetas son compactas (para el detalle está «Ampliar») y van
    // en parejas que se leen juntas: quién planifica y contra qué; después,
    // mes a mes, cuánto trabajo y cuánto dinero (mismo eje, se comparan de un
    // vistazo). En el PNS, los temas cierran a todo el ancho: son los nombres
    // más largos y es el quinto gráfico, sin pareja.
    const tarjetas = [
      this.#tarjeta('departamento', 'Actividades por departamento', 'Volumen de actividades registradas por unidad'),
      this.plan.id === 'pns'
        ? this.#tarjeta('objetivo', 'Actividades por objetivo estratégico', 'Cobertura de la Estrategia Nacional de Salud')
        : this.#tarjeta('tipo', 'Actividades por tipo', 'Naturaleza de las actividades planificadas'),
      this.#tarjeta('cronograma', 'Ejecuciones por mes', 'Carga de trabajo programada a lo largo del año'),
      this.#tarjeta('presupuestoMes', 'Presupuesto por mes', 'Distribución mensual según subtítulo, en miles de pesos')
    ];
    if (this.plan.id === 'pns') {
      tarjetas.push(this.#tarjeta('tema', 'Actividades por tema', 'Cada tema lleva delante el objetivo estratégico del que depende', { ancho: true }));
    }

    this.zonaGraficos.append(...tarjetas);

    let Chart;
    try {
      Chart = await cargarChartJs();
    } catch {
      render(this.zonaGraficos, el('div', { class: 'nota nota--info' }, [
        el('p', { text: 'No se pudieron cargar los gráficos (sin conexión a internet). Los datos siguen disponibles en la tabla y en la exportación a Excel.' })
      ]));
      return;
    }

    this.#configurarChart(Chart);
    this.#graficoDepartamento(Chart);
    this.#graficoCronograma(Chart);
    if (this.plan.id === 'pns') { this.#graficoObjetivo(Chart); this.#graficoTema(Chart); }
    else this.#graficoTipo(Chart);
    this.#graficoPresupuestoMes(Chart);

    // Si hay un gráfico ampliado, se pone al día con los datos nuevos.
    if (this.ampliado?.enfoque.abierto) {
      if (this.configs.has(this.ampliado.id)) this.#pintarAmpliado(0);
      else this.ampliado.enfoque.cerrar();
    }
  }

  #configurarChart(Chart) {
    Chart.defaults.font.family = token('--fuente') || 'system-ui, sans-serif';
    Chart.defaults.font.size = 12;
    Chart.defaults.color = token('--grafico-texto');
    Chart.defaults.animation.duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 400;
    Chart.defaults.maintainAspectRatio = false;
  }

  #opcionesBase({ horizontal = false, formatoValor = numero, leyenda = false, entero = false } = {}) {
    const rejilla = token('--grafico-rejilla');
    const eje = token('--grafico-eje');
    const ejeValor = {
      beginAtZero: true,
      border: { display: false },
      grid: { color: rejilla, drawTicks: false },
      // Un conteo de actividades no admite decimales: 1,5 actividades no existe.
      ticks: { padding: 8, precision: 0, stepSize: entero ? 1 : undefined, callback: (v) => formatoValor(v) }
    };
    const ejeCategoria = {
      border: { color: eje },
      grid: { display: false },
      ticks: { padding: 6, autoSkip: false, maxRotation: horizontal ? 0 : 0, minRotation: 0 }
    };
    return {
      responsive: true,
      indexAxis: horizontal ? 'y' : 'x',
      layout: { padding: { top: 8, right: 8 } },
      scales: horizontal ? { x: ejeValor, y: ejeCategoria } : { x: ejeCategoria, y: ejeValor },
      plugins: {
        legend: leyenda
          ? {
              display: true, position: 'top', align: 'end',
              labels: { usePointStyle: true, pointStyle: 'rectRounded', boxWidth: 10, boxHeight: 10, padding: 16, color: token('--ink-2') }
            }
          : { display: false },
        tooltip: {
          backgroundColor: token('--superficie-inv'),
          titleColor: token('--ink-inv'),
          bodyColor: token('--ink-inv'),
          padding: 10,
          cornerRadius: 8,
          displayColors: true,
          usePointStyle: true,
          callbacks: {
            label: (ctx) => {
              const etiqueta = ctx.dataset.label ? `${ctx.dataset.label}: ` : '';
              const valor = horizontal ? ctx.parsed.x : ctx.parsed.y;
              return `${etiqueta}${formatoValor(valor)}`;
            }
          }
        }
      }
    };
  }

  #crear(id, config) {
    const ref = this.lienzos.get(id);
    if (!ref) return;
    const Chart = globalThis.Chart;
    this.graficos.get(id)?.destroy();
    this.configs.set(id, clonar(config));
    this.graficos.set(id, new Chart(ref.lienzo.getContext('2d'), config));
  }

  #tablaDatos(id, encabezados, filas) {
    const ref = this.lienzos.get(id);
    if (!ref) return;
    this.tablas.set(id, { encabezados, filas });
    // Deja el <summary> y reemplaza el resto.
    const resumen = ref.detalle.firstElementChild;
    vaciar(ref.detalle);
    ref.detalle.append(resumen, el('table', {}, [
      el('thead', {}, [el('tr', {}, encabezados.map((h) => el('th', { text: h, attrs: { scope: 'col' } })))]),
      el('tbody', {}, filas.map((f) => el('tr', {}, f.map((c, i) =>
        i === 0 ? el('th', { text: String(c), attrs: { scope: 'row' } }) : el('td', { text: String(c) })
      ))))
    ]));
  }

  /* --- Presupuesto por mes: dos series, barras apiladas ------------- */

  #graficoPresupuestoMes(Chart) {
    const datos = SUBTITULOS.map((st) =>
      IDS_MESES.map((m) => this.datos.reduce((s, a) => s + (a.presupuesto[st]?.meses[m] || 0), 0))
    );
    const colores = [token('--serie-1'), token('--serie-2')];

    this.#crear('presupuestoMes', {
      type: 'bar',
      data: {
        labels: MESES.map((m) => m.corto),
        datasets: SUBTITULOS.map((st, i) => ({
          label: `Subtítulo ${st}`,
          data: datos[i],
          backgroundColor: colores[i],
          borderRadius: { topLeft: 4, topRight: 4, bottomLeft: 0, bottomRight: 0 },
          borderSkipped: false,
          // 2 px de superficie entre segmentos apilados.
          borderWidth: { top: 2 },
          borderColor: token('--superficie'),
          maxBarThickness: 46
        }))
      },
      options: {
        ...this.#opcionesBase({ formatoValor: monto, leyenda: true }),
        scales: {
          x: { stacked: true, border: { color: token('--grafico-eje') }, grid: { display: false }, ticks: { padding: 6 } },
          y: {
            stacked: true, beginAtZero: true, border: { display: false },
            grid: { color: token('--grafico-rejilla'), drawTicks: false },
            ticks: { padding: 8, callback: (v) => monto(v) }
          }
        }
      }
    });

    this.#tablaDatos('presupuestoMes',
      ['Mes', 'Subtítulo 21', 'Subtítulo 22', 'Total'],
      MESES.map((m, i) => [m.largo, monto(datos[0][i]), monto(datos[1][i]), monto(datos[0][i] + datos[1][i])])
    );
  }

  /* --- Ejecuciones por mes: una serie, rampa secuencial ------------- */

  #graficoCronograma() {
    const valores = IDS_MESES.map((m) => this.datos.reduce((s, a) => s + (a.cronograma[m] || 0), 0));
    const max = Math.max(...valores, 1);
    const rampa = ['--seq-200', '--seq-300', '--seq-400', '--seq-500', '--seq-600'].map(token);
    const color = (v) => rampa[Math.min(rampa.length - 1, Math.floor((v / max) * rampa.length * 0.999))];

    this.#crear('cronograma', {
      type: 'bar',
      data: {
        labels: MESES.map((m) => m.corto),
        datasets: [{
          label: 'Ejecuciones',
          data: valores,
          backgroundColor: valores.map(color),
          borderRadius: { topLeft: 4, topRight: 4 },
          borderSkipped: false,
          maxBarThickness: 40
        }]
      },
      options: this.#opcionesBase({ formatoValor: numero, entero: true })
    });

    this.#tablaDatos('cronograma', ['Mes', 'Ejecuciones'], MESES.map((m, i) => [m.largo, numero(valores[i])]));
  }

  /* --- Conteos por dimensión: barras horizontales secuenciales ------ */

  #conteoPor(campo, catalogo) {
    const mapa = new Map();
    for (const a of this.datos) {
      const clave = a[campo] || '(sin especificar)';
      mapa.set(clave, (mapa.get(clave) || 0) + 1);
    }
    const lista = catalogo ? this.catalogos[catalogo] : null;
    return [...mapa.entries()]
      .map(([clave, total]) => {
        const item = lista?.find((x) => x.id === clave);
        return {
          clave,
          // El eje usa el nombre corto (cabe sin recortes); el tooltip y la
          // tabla de datos muestran el nombre completo.
          etiqueta: item?.nombre ?? clave,
          etiquetaCorta: item?.nombreCorto ?? item?.nombre ?? clave,
          total
        };
      })
      .sort((a, b) => b.total - a.total);
  }

  /**
   * @param {object} [opciones]
   * @param {boolean} [opciones.ancho] La tarjeta ocupa el ancho completo, así que
   *   el eje puede permitirse etiquetas más largas antes de recortarlas.
   */
  #graficoBarrasHorizontales(id, filas, etiquetaSerie, { ancho = false, tope = 0, topeAmpliado = 0, nombreResto = 'categorías' } = {}) {
    // En la tarjeta caben las principales y una nota dice cuántas quedan
    // fuera; al ampliar se ven más (o todas) y la tabla de datos las trae todas.
    // No se suma el resto en una barra «Otros»: sería casi siempre la más
    // larga y estiraría la escala, aplastando justo las que se quieren comparar.
    const enTarjeta = this.#conTope(filas, tope);
    const ref = this.lienzos.get(id);
    // Al repintar con datos nuevos la tarjeta es la misma: fuera la nota anterior.
    ref?.tarjeta.querySelector('.grafico__nota')?.remove();
    this.configsAmpliados.delete(id);
    if (enTarjeta.length < filas.length) {
      const enAmpliado = this.#conTope(filas, topeAmpliado);
      this.configsAmpliados.set(id, {
        config: this.#configBarras(enAmpliado, etiquetaSerie, { maxCaracteres: 72, anchoEje: 440, completas: true }),
        nota: enAmpliado.length < filas.length
          ? `Se muestran los ${numero(enAmpliado.length)} ${nombreResto} con más actividades, de ${numero(filas.length)}. La tabla los trae todos.`
          : ''
      });
      ref?.detalle.before(el('p', {
        class: 'grafico__nota',
        text: `Se muestran los ${numero(enTarjeta.length)} ${nombreResto} con más actividades. Los otros ${numero(filas.length - enTarjeta.length)} están en «Ampliar» y en la tabla de datos.`
      }));
    }

    // La altura sigue al número de categorías, con un techo para que ninguna
    // tarjeta crezca más que su pareja de fila.
    if (ref) {
      const alto = Math.max(200, Math.min(380, enTarjeta.length * 30 + 48));
      ref.lienzo.parentElement.style.height = `${alto}px`;
    }

    this.#crear(id, this.#configBarras(enTarjeta, etiquetaSerie, { maxCaracteres: ancho ? 46 : 30, anchoEje: ancho ? 320 : 210 }));
    this.#tablaDatos(id, ['Categoría', 'Actividades'], filas.map((f) => [f.etiqueta, numero(f.total)]));
  }

  /** Las `tope` primeras (vienen ordenadas de mayor a menor). Sin tope, todas. */
  #conTope(filas, tope) {
    return tope && filas.length > tope ? filas.slice(0, tope) : filas;
  }

  /** Configuración de un gráfico de barras horizontales (tarjeta o ampliado). */
  #configBarras(filas, etiquetaSerie, { maxCaracteres, anchoEje, completas = false }) {
    const max = Math.max(...filas.map((f) => f.total), 1);
    const rampa = ['--seq-200', '--seq-300', '--seq-400', '--seq-500', '--seq-600'].map(token);
    const color = (v) => rampa[Math.min(rampa.length - 1, Math.floor((v / max) * rampa.length * 0.999))];
    const base = this.#opcionesBase({ horizontal: true, formatoValor: numero, entero: true });

    return {
      type: 'bar',
      data: {
        labels: filas.map((f) => recortar((completas ? f.etiqueta : f.etiquetaCorta) ?? f.etiqueta, maxCaracteres)),
        datasets: [{
          label: etiquetaSerie,
          data: filas.map((f) => f.total),
          backgroundColor: filas.map((f) => color(f.total)),
          borderRadius: { topRight: 4, bottomRight: 4 },
          borderSkipped: false,
          maxBarThickness: 26
        }]
      },
      options: {
        ...base,
        // Etiqueta directa al final de cada barra: la identidad no depende del color.
        layout: { padding: { right: 28, top: 4 } },
        scales: {
          ...base.scales,
          // Con conteos altos, una marca por unidad no cabe a media columna.
          x: { ...base.scales.x, ticks: { ...base.scales.x.ticks, stepSize: max > 8 ? undefined : 1, maxRotation: 0 } },
          y: { ...base.scales.y, ticks: { ...base.scales.y.ticks, crossAlign: 'far', font: { size: 11 } }, afterFit: (e) => { e.width = Math.min(e.width, anchoEje); } }
        },
        plugins: {
          ...base.plugins,
          tooltip: {
            ...base.plugins.tooltip,
            callbacks: {
              title: (items) => filas[items[0].dataIndex].etiqueta,
              label: (ctx) => `${numero(ctx.parsed.x)} actividad${ctx.parsed.x === 1 ? '' : 'es'}`
            }
          }
        }
      }
    };
  }

  #graficoDepartamento() {
    this.#graficoBarrasHorizontales('departamento', this.#conteoPor('departamento', 'departamentos'), 'Actividades');
  }

  #graficoTipo() {
    this.#graficoBarrasHorizontales('tipo', this.#conteoPor('tipoActividad', 'tiposActividad'), 'Actividades', { tope: 9, nombreResto: 'tipos' });
  }

  #graficoObjetivo() {
    const filas = this.#conteoPor('objetivoEstrategico');
    for (const f of filas) {
      const nombre = this.nombresOE.get(f.clave);
      f.etiqueta = nombre ? `${f.clave}. ${nombre}` : f.clave;
      f.etiquetaCorta = nombre ? `OE ${f.clave} · ${nombre}` : `OE ${f.clave}`;
    }
    this.#graficoBarrasHorizontales('objetivo', filas, 'Actividades');
  }

  /**
   * Temas, con su objetivo estratégico al frente.
   *
   * El tema es el nivel donde de verdad se decide qué se hace, y el objetivo
   * estratégico solo agrupa: por eso van juntos en un mismo gráfico en vez de
   * pintarse con colores distintos. El color sigue siendo la magnitud (rampa
   * secuencial), y la pertenencia al objetivo se lee en el propio texto, que
   * es lo único que no depende de distinguir tonos.
   */
  #graficoTema() {
    // Cada actividad trae su tema y su objetivo: no hace falta consultar la ENS.
    const mapa = new Map();
    for (const a of this.datos) {
      const tema = a.tema || '(sin tema)';
      const registro = mapa.get(tema) || { total: 0, oes: new Map() };
      registro.total += 1;
      if (a.objetivoEstrategico) {
        registro.oes.set(a.objetivoEstrategico, (registro.oes.get(a.objetivoEstrategico) || 0) + 1);
      }
      mapa.set(tema, registro);
    }

    const todas = [...mapa.entries()]
      .map(([tema, r]) => {
        // El objetivo más frecuente del tema (en la ENS siempre es uno solo,
        // pero un dato antiguo o importado podría no cumplirlo).
        const oe = [...r.oes.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] || '';
        const nombreOE = this.nombresOE.get(oe);
        return {
          clave: tema,
          total: r.total,
          etiqueta: oe ? `${tema}  (OE ${oe}${nombreOE ? `. ${nombreOE}` : ''})` : tema,
          etiquetaCorta: oe ? `${oe} · ${tema}` : tema
        };
      })
      .sort((a, b) => b.total - a.total || a.clave.localeCompare(b.clave, 'es'));

    // Con muchos temas las barras se aplastan: la tarjeta muestra los 8
    // principales y el gráfico ampliado los 14. La tabla los trae todos.
    this.#graficoBarrasHorizontales('tema', todas, 'Actividades', { ancho: true, tope: 8, topeAmpliado: 14, nombreResto: 'temas' });
    // La tabla reemplaza la del gráfico: muestra el detalle completo, sin tope.
    this.#tablaDatos('tema', ['Tema', 'Actividades'], todas.map((f) => [f.etiqueta, numero(f.total)]));
  }

  #destruirGraficos() {
    for (const g of this.graficos.values()) g.destroy();
    this.graficos.clear();
  }

  destruir() {
    this.#destruirGraficos();
    this.ampliado?.enfoque.cerrar();
    this.observadorTema?.disconnect();
  }

  /* ---------------------------------------------------------------- */
  /* Gráfico ampliado (modo enfoque)                                   */
  /* ---------------------------------------------------------------- */

  #ampliar(id, { origen } = {}) {
    if (!this.configs.has(id) || !globalThis.Chart) return;
    if (this.ampliado?.enfoque.abierto) this.ampliado.enfoque.cerrar();
    const enfoque = abrirEnfoque({
      etiqueta: 'Gráfico ampliado',
      origen,
      ancho: '1160px',
      clase: 'enfoque--grafico',
      alNavegar: (paso) => this.#moverAmpliado(paso),
      alCerrar: () => {
        if (this.ampliado?.enfoque !== enfoque) return;
        this.ampliado.grafico?.destroy();
        this.ampliado = null;
      }
    });
    this.ampliado = { enfoque, id, grafico: null };
    this.#pintarAmpliado(0);
    enfoque.entrar();
  }

  #moverAmpliado(paso) {
    const ids = [...this.lienzos.keys()].filter((x) => this.configs.has(x));
    if (!this.ampliado || ids.length < 2) return;
    const i = ids.indexOf(this.ampliado.id);
    this.ampliado.id = ids[(i + paso + ids.length) % ids.length];
    this.#pintarAmpliado(paso);
  }

  #pintarAmpliado(direccion) {
    const am = this.ampliado;
    if (!am) return;
    const ids = [...this.lienzos.keys()].filter((x) => this.configs.has(x));
    const ref = this.lienzos.get(am.id);
    const propia = this.configsAmpliados.get(am.id);
    const config = clonar(propia?.config || this.configs.get(am.id));
    const tabla = this.tablas.get(am.id);
    if (!ref || !config) { am.enfoque.cerrar(); return; }

    const horizontal = config.options?.indexAxis === 'y';
    const etiquetas = config.data.labels || [];
    // En grande caben los nombres completos que el gráfico chico recorta
    // (la configuración propia del ampliado ya los trae).
    if (!propia && horizontal && tabla && tabla.filas.length === etiquetas.length) {
      config.data.labels = tabla.filas.map((f) => recortar(String(f[0]), 72));
      const y = config.options.scales?.y;
      if (y) y.afterFit = (e) => { e.width = Math.min(e.width, 440); };
    }
    if (config.options) config.options.animation = { duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 520 };

    const alto = horizontal ? Math.max(320, Math.min(640, etiquetas.length * 40 + 60)) : 420;
    const lienzo = el('canvas', { attrs: { role: 'img', 'aria-label': `${ref.titulo}. ${ref.subtitulo}. ${this.#lectura(am.id)}` } });
    const idTitulo = `ampliado-${am.id}`;
    const filtrado = this.filtro.departamento
      ? ` · ${etiquetaDe(this.catalogos.departamentos, this.filtro.departamento)}`
      : '';

    am.grafico?.destroy();
    am.enfoque.mostrar({
      etiqueta: `Gráfico ampliado: ${ref.titulo}`,
      direccion,
      cabecera: el('header', { class: 'enfoque__cabecera' }, [
        el('div', { class: 'foco__encabezado' }, [
          el('h2', { class: 'foco__titulo', id: idTitulo, text: ref.titulo }),
          el('p', { class: 'foco__meta', text: `${ref.subtitulo}${filtrado}` })
        ]),
        el('button', {
          class: 'enfoque__cerrar', attrs: { type: 'button', 'aria-label': 'Cerrar el gráfico ampliado' }, text: '×',
          on: { click: () => am.enfoque.cerrar() }
        })
      ]),
      cuerpo: el('div', { class: 'ampliado' }, [
        el('div', { class: 'ampliado__grafico', style: { height: `${alto}px` } }, [lienzo]),
        el('aside', { class: 'ampliado__datos' }, [
          el('h3', { class: 'ampliado__subtitulo', text: 'Tabla de datos' }),
          tabla && el('div', { class: 'ampliado__tabla' }, [
            el('table', {}, [
              el('thead', {}, [el('tr', {}, tabla.encabezados.map((h) => el('th', { text: h, attrs: { scope: 'col' } })))]),
              el('tbody', {}, tabla.filas.map((f) => el('tr', {}, f.map((c, i) =>
                i === 0 ? el('th', { text: String(c), attrs: { scope: 'row' } }) : el('td', { text: String(c) })
              ))))
            ])
          ]),
          el('p', { class: 'ampliado__lectura', text: this.#lectura(am.id) }),
          propia?.nota && el('p', { class: 'ampliado__lectura', text: propia.nota })
        ].filter(Boolean))
      ]),
      pie: el('footer', { class: 'enfoque__pie' }, [
        navegacionEnfoque({ indice: ids.indexOf(am.id), total: ids.length, alMover: (p) => this.#moverAmpliado(p), nombre: 'Gráfico' }) || el('span'),
        el('div', { class: 'enfoque__acciones' }, [
          el('button', { class: 'btn btn--secundario', attrs: { type: 'button' }, text: 'Volver al panel', on: { click: () => am.enfoque.cerrar() } })
        ])
      ])
    });
    am.grafico = new globalThis.Chart(lienzo.getContext('2d'), config);
  }

  /** Una frase que dice lo principal del gráfico, para quien no lo ve. */
  #lectura(id) {
    const config = this.configs.get(id);
    if (!config) return '';
    const series = config.data.datasets || [];
    const tabla = this.tablas.get(id);
    if (config.options?.indexAxis === 'y') {
      // La tabla trae todas las categorías, también las que el gráfico deja fuera.
      const filas = tabla?.filas || [];
      const cifra = (f) => Number(String(f[1]).replace(/\./g, '')) || 0;
      const total = filas.reduce((s, f) => s + cifra(f), 0);
      const primero = filas[0];
      if (!primero || !total) return '';
      const n = cifra(primero);
      return `«${primero[0]}» concentra ${numero(n)} de ${numero(total)} actividades (${Math.round((n / total) * 100)} %).`;
    }
    const totales = MESES.map((_, i) => series.reduce((s, d) => s + (Number(d.data?.[i]) || 0), 0));
    const max = Math.max(...totales);
    if (!max) return 'Todavía no hay montos ni ejecuciones registrados por mes.';
    const iMax = totales.indexOf(max);
    const conDatos = totales.map((v, i) => [v, i]).filter(([v]) => v > 0);
    const [vMin, iMin] = conDatos.reduce((a, b) => (b[0] < a[0] ? b : a));
    const formato = id === 'presupuestoMes' ? monto : numero;
    let texto = `${MESES[iMax].largo} es el mes más alto (${formato(max)})`;
    texto += conDatos.length > 1 && iMin !== iMax ? `; ${MESES[iMin].largo.toLowerCase()}, el más bajo con registros (${formato(vMin)}).` : '.';
    if (series.length > 1) {
      const mayor = series.reduce((a, d) => ((Number(d.data?.[iMax]) || 0) > (Number(a.data?.[iMax]) || 0) ? d : a));
      texto += ` En ${MESES[iMax].largo.toLowerCase()} predomina el ${mayor.label.toLowerCase()}.`;
    }
    return texto;
  }
}
