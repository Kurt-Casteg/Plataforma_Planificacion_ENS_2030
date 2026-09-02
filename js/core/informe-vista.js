/**
 * Vista imprimible del informe consolidado.
 *
 * Toma exactamente el mismo objeto que produce `reunirInforme()` —el que
 * alimenta el Excel— y lo presenta como un documento para leer o guardar como
 * PDF desde el navegador. No recalcula nada: si el Excel y el PDF dijeran
 * cifras distintas sería un error de formato, no de datos.
 *
 * Decisiones de forma que importan para imprimir:
 *  - Los gráficos son barras hechas con CSS, no lienzos de Chart.js. Un canvas
 *    depende de que el navegador acepte imprimir mapas de bits y de que el
 *    usuario active «gráficos de fondo»; una barra con borde y trama se ve
 *    igual en pantalla, en PDF y en una impresora en blanco y negro.
 *  - Cada bloque lleva `break-inside: avoid`: una tabla partida a la mitad
 *    entre dos páginas es la forma más rápida de que un informe parezca
 *    improvisado.
 *  - El anexo con el detalle de cada actividad es opcional. Con 300 fichas son
 *    cien páginas, y no siempre se quieren.
 */

import { el, render } from './dom.js';
import { monto, numero, fecha, fechaHora } from './formato.js';
import { MESES } from './modelo.js';
import { etiquetaDe, buscarAsignacion } from './catalogos.js';

/* ------------------------------------------------------------------ */
/* Piezas reutilizables                                                */
/* ------------------------------------------------------------------ */

function bloque(titulo, ...contenido) {
  return el('section', { class: 'inf-bloque' }, [
    el('h2', { class: 'inf-bloque__titulo', text: titulo }),
    ...contenido.flat().filter(Boolean)
  ]);
}

function nota(texto) {
  return el('p', { class: 'inf-nota', text: texto });
}

/**
 * Tabla de datos. Las columnas numéricas se alinean a la derecha porque es la
 * única forma de comparar cifras de un vistazo recorriendo la columna.
 */
function tabla(encabezados, filas, { numericas = new Set(), pie = null, compacta = false } = {}) {
  const celda = (v, i, etiqueta) => el(etiqueta, {
    class: numericas.has(i) ? 'inf-tabla__num' : '',
    text: v == null ? '' : String(v),
    attrs: etiqueta === 'th' ? { scope: 'col' } : {}
  });

  return el('div', { class: 'inf-tabla-envoltura' }, [
    el('table', { class: compacta ? 'inf-tabla inf-tabla--compacta' : 'inf-tabla' }, [
      el('thead', {}, [el('tr', {}, encabezados.map((h, i) => celda(h, i, 'th')))]),
      el('tbody', {}, filas.map((f) => el('tr', {}, f.map((v, i) => celda(v, i, 'td'))))),
      pie && el('tfoot', {}, [el('tr', {}, pie.map((v, i) => celda(v, i, 'td')))])
    ].filter(Boolean))
  ]);
}

/** Barras horizontales. `items` es [{ nombre, valor, detalle? }]. */
function barras(items, { formato = numero, tono = 'marca' } = {}) {
  const max = Math.max(1, ...items.map((i) => i.valor));
  return el('div', { class: 'inf-barras', dataset: { tono } }, items.map((i) =>
    el('div', { class: 'inf-barra' }, [
      el('span', { class: 'inf-barra__etiqueta', text: i.nombre, attrs: { title: i.nombre } }),
      el('span', { class: 'inf-barra__pista' }, [
        el('span', { class: 'inf-barra__relleno', style: { width: `${Math.max((i.valor / max) * 100, i.valor > 0 ? 1.5 : 0)}%` } })
      ]),
      el('span', { class: 'inf-barra__valor', text: formato(i.valor) })
    ])
  ));
}

function fichaKpi(etiqueta, valor, detalle) {
  return el('div', { class: 'inf-kpi' }, [
    el('p', { class: 'inf-kpi__etiqueta', text: etiqueta }),
    el('p', { class: 'inf-kpi__valor', text: valor }),
    el('p', { class: 'inf-kpi__detalle', text: detalle || '' })
  ]);
}

const chip = (texto, tono) => el('span', { class: 'inf-chip', dataset: tono ? { tono } : {}, text: texto });

/* ------------------------------------------------------------------ */
/* Secciones del informe                                               */
/* ------------------------------------------------------------------ */

function portada(informe) {
  const t = informe.totales;
  return el('section', { class: 'inf-portada' }, [
    el('p', { class: 'inf-portada__institucion', text: informe.institucion }),
    el('h1', { class: 'inf-portada__titulo', text: `Informe consolidado de planificación ${informe.anio}` }),
    el('p', { class: 'inf-portada__sub', text: informe.porPlan.map((b) => b.plan.nombre).join(' · ') }),
    el('p', { class: 'inf-portada__fecha', text: `Generado el ${fechaHora(informe.generado)}` }),
    el('div', { class: 'inf-kpis' }, [
      fichaKpi('Actividades', numero(t.actividades), `${numero(informe.porDepartamento.length)} departamentos`),
      fichaKpi('Ejecuciones programadas', numero(t.ejecuciones), 'en los doce meses'),
      fichaKpi('Presupuesto total', monto(t.presupuesto), `ST21 ${monto(t.st21)} · ST22 ${monto(t.st22)}`),
      fichaKpi('Plan Anual de Compras', monto(informe.pac.totales.monto), `${numero(informe.pac.totales.compras)} compras`),
      fichaKpi('Fichas completas', numero(t.completas), `${numero(t.parciales + t.incompletas)} con pendientes`),
      fichaKpi('Cobertura ENS', informe.cobertura
        ? `${informe.cobertura.resumen.temasCubiertos} de ${informe.cobertura.resumen.temas}`
        : '—', 'temas con actividades')
    ])
  ]);
}

function resumenInstitucional(informe) {
  const t = informe.totales;
  return bloque('Resumen institucional',
    tabla(
      ['Plan', 'Actividades', 'Ejecuciones', 'ST21 (M$)', 'ST22 (M$)', 'Total (M$)', 'PAC (M$)'],
      informe.porPlan.map((b) => [
        b.plan.nombre, numero(b.totales.actividades), numero(b.totales.ejecuciones),
        numero(b.totales.st21), numero(b.totales.st22), numero(b.totales.presupuesto), numero(b.totales.pac)
      ]),
      {
        numericas: new Set([1, 2, 3, 4, 5, 6]),
        pie: ['Total', numero(t.actividades), numero(t.ejecuciones), numero(t.st21), numero(t.st22), numero(t.presupuesto), numero(t.pac)]
      }
    ),
    el('h3', { class: 'inf-sub', text: 'Actividades por departamento' }),
    barras(informe.porDepartamento.map((d) => ({ nombre: d.nombre, valor: d.actividades }))),
    tabla(
      ['Departamento', 'Actividades', 'Ejecuciones', 'ST21 (M$)', 'ST22 (M$)', 'Total (M$)', 'PAC (M$)', 'Con pendientes'],
      informe.porDepartamento.map((d) => [
        d.nombre, numero(d.actividades), numero(d.ejecuciones), numero(d.st21), numero(d.st22),
        numero(d.presupuesto), numero(d.pac), numero(d.parciales + d.incompletas)
      ]),
      {
        numericas: new Set([1, 2, 3, 4, 5, 6, 7]),
        pie: ['Total', numero(t.actividades), numero(t.ejecuciones), numero(t.st21), numero(t.st22),
          numero(t.presupuesto), numero(t.pac), numero(t.parciales + t.incompletas)]
      }
    ),
    informe.porTipo.length > 1 && el('h3', { class: 'inf-sub', text: 'Actividades por tipo' }),
    informe.porTipo.length > 1 && barras(informe.porTipo.map((x) => ({ nombre: x.nombre, valor: x.actividades })))
  );
}

function cronograma(informe) {
  return bloque('Cronograma de ejecución',
    nota('Cantidad de ejecuciones programadas en cada mes, sumando ambos planes.'),
    barras(informe.porMes.map((m) => ({ nombre: m.mes, valor: m.ejecuciones }))),
    tabla(
      ['Mes', ...informe.porPlan.map((b) => b.plan.nombreCorto), 'Total'],
      MESES.map((mes, i) => [
        mes.largo,
        ...informe.porPlan.map((b) => numero(b.porMes[i].ejecuciones)),
        numero(informe.porMes[i].ejecuciones)
      ]),
      {
        numericas: new Set(informe.porPlan.map((_, i) => i + 1).concat([informe.porPlan.length + 1])),
        pie: ['Total',
          ...informe.porPlan.map((b) => numero(b.totales.ejecuciones)),
          numero(informe.totales.ejecuciones)]
      }
    )
  );
}

function presupuesto(informe) {
  const t = informe.totales;
  return bloque('Presupuesto',
    nota('Montos en miles de pesos (M$), distribuidos según el mes en que se planifica el gasto.'),
    barras(informe.porMes.map((m) => ({ nombre: m.mes, valor: m.presupuesto })), { formato: monto, tono: 'presupuesto' }),
    tabla(
      ['Mes', 'Subtítulo 21', 'Subtítulo 22', 'Total'],
      informe.porMes.map((m) => [m.mes, monto(m.st21), monto(m.st22), monto(m.presupuesto)]),
      {
        numericas: new Set([1, 2, 3]),
        pie: ['Total', monto(t.st21), monto(t.st22), monto(t.presupuesto)]
      }
    ),
    el('h3', { class: 'inf-sub', text: 'Presupuesto por departamento' }),
    tabla(
      ['Departamento', 'Subtítulo 21', 'Subtítulo 22', 'Total', 'PAC'],
      informe.porDepartamento
        .slice()
        .sort((a, b) => b.presupuesto - a.presupuesto)
        .map((d) => [d.nombre, monto(d.st21), monto(d.st22), monto(d.presupuesto), monto(d.pac)]),
      {
        numericas: new Set([1, 2, 3, 4]),
        pie: ['Total', monto(t.st21), monto(t.st22), monto(t.presupuesto), monto(t.pac)]
      }
    )
  );
}

function coberturaENS(informe) {
  const c = informe.cobertura;
  if (!c) return null;
  const r = c.resumen;

  return bloque('Cobertura de la Estrategia Nacional de Salud',
    nota('Solo considera las actividades del Plan Nacional de Salud. Lo relevante no es únicamente dónde hay actividades, sino dónde no las hay.'),
    el('div', { class: 'inf-kpis inf-kpis--tres' }, [
      fichaKpi('Objetivos estratégicos', `${r.objetivosCubiertos} de ${r.objetivos}`, 'con al menos una actividad'),
      fichaKpi('Temas', `${r.temasCubiertos} de ${r.temas}`, `${r.temas - r.temasCubiertos} sin actividades`),
      fichaKpi('Resultados esperados', `${r.resultadosCubiertos} de ${r.resultadosEsperados}`, `${r.resultadosEsperados - r.resultadosCubiertos} sin actividades`)
    ]),
    barras(c.objetivos.map((o) => ({ nombre: `OE ${o.codigo} · ${o.nombre}`, valor: o.actividades }))),
    tabla(
      ['OE', 'Objetivo estratégico', 'Actividades', 'Temas cubiertos'],
      c.objetivos.map((o) => [o.codigo, o.nombre, numero(o.actividades), `${o.temasCubiertos} de ${o.temas}`]),
      { numericas: new Set([2, 3]) }
    ),
    c.temasSinActividades.length > 0 && el('h3', { class: 'inf-sub', text: `Temas sin actividades registradas (${c.temasSinActividades.length})` }),
    c.temasSinActividades.length > 0 && tabla(
      ['OE', 'Tema'],
      c.temasSinActividades.map((t) => [t.oe, t.nombre]),
      { compacta: true }
    )
  );
}

function planAnualCompras(informe) {
  const p = informe.pac;
  if (!p.totales.compras) {
    return bloque('Plan Anual de Compras', nota('No hay compras registradas en el Plan Anual de Compras.'));
  }

  const descuadres = p.conciliacion.filter((c) => !c.cuadra);

  return bloque('Plan Anual de Compras',
    el('div', { class: 'inf-kpis inf-kpis--tres' }, [
      fichaKpi('Compras registradas', numero(p.totales.compras), `en ${numero(p.totales.actividades)} actividades`),
      fichaKpi('Monto estimado', monto(p.totales.monto), 'suma de todas las compras'),
      fichaKpi('Compras incompletas', numero(p.totales.incompletas), 'sin cantidad o sin fechas')
    ]),

    el('h3', { class: 'inf-sub', text: 'Compras por ítem del clasificador presupuestario' }),
    barras(p.porItem.map((i) => ({ nombre: i.nombre, valor: i.monto })), { formato: monto, tono: 'presupuesto' }),
    tabla(
      ['Ítem', 'Compras', 'Monto'],
      p.porItem.map((i) => [i.nombre, numero(i.compras), monto(i.monto)]),
      { numericas: new Set([1, 2]), pie: ['Total', numero(p.totales.compras), monto(p.totales.monto)] }
    ),

    el('h3', { class: 'inf-sub', text: 'Calendario estimado de compras' }),
    tabla(
      ['Mes de compra', 'Compras', 'Monto'],
      [
        ...p.porMesCompra.map((m) => [m.mes, numero(m.compras), monto(m.monto)]),
        ...(p.sinFecha.compras ? [[p.sinFecha.mes, numero(p.sinFecha.compras), monto(p.sinFecha.monto)]] : [])
      ],
      { numericas: new Set([1, 2]), compacta: true }
    ),

    el('h3', { class: 'inf-sub', text: 'Conciliación con el subtítulo 22' }),
    nota(descuadres.length
      ? `El PAC y el subtítulo 22 describen el mismo gasto. ${descuadres.length} actividad${descuadres.length > 1 ? 'es no cuadran' : ' no cuadra'}.`
      : 'El PAC y el subtítulo 22 describen el mismo gasto. Todas las actividades cuadran.'),
    tabla(
      ['Código', 'Actividad', 'Departamento', 'PAC', 'Subtítulo 22', 'Diferencia', 'Estado'],
      p.conciliacion.map((c) => [
        c.actividad.codigoActividad || '—',
        c.actividad.nombreActividad,
        c.departamento,
        monto(c.totalPac),
        monto(c.st22),
        monto(c.diferencia),
        c.cuadra ? 'Cuadra' : 'Descuadrada'
      ]),
      { numericas: new Set([3, 4, 5]), compacta: true }
    )
  );
}

function calidadDeDatos(informe) {
  const t = informe.totales;
  const pendientes = informe.calidad;

  return bloque('Calidad de los datos',
    el('div', { class: 'inf-kpis inf-kpis--tres' }, [
      fichaKpi('Fichas completas', numero(t.completas), `de ${numero(t.actividades)}`),
      fichaKpi('Faltan datos recomendados', numero(t.parciales), 'no impiden la entrega'),
      fichaKpi('Faltan datos obligatorios', numero(t.incompletas), 'hay que corregirlas')
    ]),
    pendientes.length === 0
      ? nota('Todas las fichas registradas están completas.')
      : tabla(
        ['Plan', 'Código', 'Actividad', 'Departamento', 'Responsable', 'Estado', 'Qué falta'],
        pendientes.map(({ actividad: a, plan, estado }) => [
          plan.nombreCorto,
          a.codigoActividad || '—',
          a.nombreActividad || 'Sin nombre',
          etiquetaDe(informe.catalogos.departamentos, a.departamento),
          a.responsable || '—',
          estado.etiqueta,
          [...estado.obligatorios, ...estado.recomendados, ...estado.avisos].join(' · ')
        ]),
        { compacta: true }
      )
  );
}

/* ------------------------------------------------------------------ */
/* Anexo: detalle de cada actividad                                    */
/* ------------------------------------------------------------------ */

function detalleActividad({ actividad: a, plan, estado }, informe) {
  const { catalogos, ens, clasificador } = informe;
  const dato = (etiqueta, valor) => valor
    ? el('div', { class: 'inf-dato' }, [
        el('dt', { text: etiqueta }),
        el('dd', { text: String(valor) })
      ])
    : null;

  // Cadena de resultados con el texto completo, no solo los códigos.
  let cadena = [];
  if (plan.id === 'pns' && ens) {
    const v = {
      oe: a.objetivoEstrategico, tema: a.tema, oi: a.objetivoImpacto,
      re: a.resultadoEsperado, ri: a.resultadoInmediato
    };
    const texto = (n) => { try { return ens.nombreDe(n, v) || ''; } catch { return ''; } };
    cadena = [
      dato('Objetivo estratégico', [v.oe, texto('objetivoEstrategico')].filter(Boolean).join(' · ')),
      dato('Tema', v.tema),
      dato('Objetivo de impacto', [v.oi, texto('objetivoImpacto')].filter(Boolean).join(' · ')),
      dato('Resultado esperado', [v.re, texto('resultadoEsperado')].filter(Boolean).join(' · ')),
      dato('Resultado inmediato', [v.ri, texto('resultadoInmediato')].filter(Boolean).join(' · '))
    ];
  } else {
    cadena = [
      dato('Objetivo estratégico', a.objetivoEstrategicoTexto),
      dato('Objetivo operacional', a.objetivoOperacional),
      dato('Producto', a.producto)
    ];
  }

  const meses = MESES.filter((m) => a.cronograma[m.id] > 0);

  return el('article', { class: 'inf-ficha' }, [
    el('header', { class: 'inf-ficha__cabecera' }, [
      el('h3', { class: 'inf-ficha__titulo', text: a.nombreActividad || 'Actividad sin nombre' }),
      el('div', { class: 'inf-ficha__chips' }, [
        chip(plan.nombreCorto),
        a.codigoActividad && chip(`N° ${a.codigoActividad}`),
        chip(etiquetaDe(catalogos.departamentos, a.departamento) || 'Sin departamento'),
        chip(estado.etiqueta, estado.nivel)
      ].filter(Boolean))
    ]),

    el('dl', { class: 'inf-datos' }, [
      dato('Responsable', a.responsable),
      dato('Correo institucional', a.correoInstitucional),
      ...cadena,
      dato('Tipo de actividad', etiquetaDe(catalogos.tiposActividad, a.tipoActividad)),
      dato('Componente transversal', etiquetaDe(catalogos.componentesTransversales, a.componentesTransversales)),
      dato('Descripción', a.descripcionActividad),
      dato('Medio de verificación', a.medioVerificacion)
    ].filter(Boolean)),

    el('p', { class: 'inf-ficha__linea', text: `Cronograma · ${numero(a.totales.cronograma)} ejecución${a.totales.cronograma === 1 ? '' : 'es'}` }),
    meses.length
      ? el('div', { class: 'inf-chips' }, meses.map((m) => chip(`${m.corto}: ${numero(a.cronograma[m.id])}`)))
      : nota('Sin meses de ejecución registrados.'),

    el('p', { class: 'inf-ficha__linea', text: `Presupuesto · ${a.sinPresupuesto ? 'no requiere' : monto(a.totales.presupuesto)}` }),
    !a.sinPresupuesto && el('div', {}, ['21', '22'].map((st) => {
      const total = a.totales[`presupuesto${st}`];
      if (!total) return null;
      const b = a.presupuesto[st];
      return el('div', { class: 'inf-ficha__sub' }, [
        el('p', { class: 'inf-ficha__linea', text: `Subtítulo ${st} · ${monto(total)}` }),
        (b.programatico || b.programa) && nota([b.programatico, b.programa].filter(Boolean).join(' · ')),
        el('div', { class: 'inf-chips' }, MESES.filter((m) => b.meses[m.id] > 0)
          .map((m) => chip(`${m.corto}: ${monto(b.meses[m.id])}`)))
      ].filter(Boolean));
    }).filter(Boolean)),

    a.pac.aplica && a.pac.compras.length > 0 && el('div', {}, [
      el('p', { class: 'inf-ficha__linea', text: `Plan Anual de Compras · ${a.pac.compras.length} compra${a.pac.compras.length > 1 ? 's' : ''} · ${monto(a.totales.pac)}` }),
      ...a.pac.compras.map((c, i) => {
        const ref = buscarAsignacion(clasificador, c.clasificador);
        return el('div', { class: 'inf-ficha__sub' }, [
          el('p', { class: 'inf-ficha__linea', text: `${i + 1}. ${c.producto || 'Sin producto indicado'}` }),
          ref && nota(`${ref.item.codigo} · ${ref.item.nombre} · ${ref.asignacion.nombre}`),
          el('div', { class: 'inf-chips' }, [
            c.cantidad ? chip(`Cantidad: ${numero(c.cantidad)}`) : null,
            c.fechaCompra ? chip(`Compra: ${fecha(c.fechaCompra)}`) : null,
            c.fechaEjecucion ? chip(`Ejecuta: ${fecha(c.fechaEjecucion)}`) : null,
            chip(monto(c.monto))
          ].filter(Boolean))
        ].filter(Boolean));
      })
    ]),

    estado.nivel !== 'completa' && el('div', { class: 'inf-ficha__pendientes' }, [
      el('p', { class: 'inf-ficha__linea', text: 'Pendientes de esta ficha' }),
      el('ul', {}, [...estado.obligatorios, ...estado.recomendados, ...estado.avisos]
        .map((x) => el('li', { text: x })))
    ])
  ].filter(Boolean));
}

function anexo(informe) {
  return el('section', { class: 'inf-bloque inf-anexo' }, [
    el('h2', { class: 'inf-bloque__titulo', text: 'Anexo · Detalle de cada actividad' }),
    nota(`${numero(informe.totales.actividades)} fichas, agrupadas por plan y ordenadas por departamento y código.`),
    ...informe.porPlan.flatMap((b) => {
      if (!b.fichas.length) return [];
      const ordenadas = b.fichas.slice().sort((x, y) => {
        const dx = etiquetaDe(informe.catalogos.departamentos, x.actividad.departamento);
        const dy = etiquetaDe(informe.catalogos.departamentos, y.actividad.departamento);
        if (dx !== dy) return dx.localeCompare(dy, 'es');
        return String(x.actividad.codigoActividad).localeCompare(String(y.actividad.codigoActividad), 'es', { numeric: true });
      });
      return [
        el('h3', { class: 'inf-anexo__plan', text: `${b.plan.nombre} · ${numero(ordenadas.length)} actividades` }),
        ...ordenadas.map((f) => detalleActividad(f, informe))
      ];
    })
  ]);
}

/* ------------------------------------------------------------------ */
/* Montaje                                                             */
/* ------------------------------------------------------------------ */

/**
 * Abre el informe a pantalla completa, con la barra de acciones arriba.
 * @param {object} informe Resultado de `reunirInforme()`.
 * @param {object} [opciones]
 * @param {Function} [opciones.alExportarExcel] Si se entrega, aparece el botón de Excel.
 */
export function abrirVistaInforme(informe, { alExportarExcel = null } = {}) {
  document.querySelector('.informe')?.remove();

  const cuerpo = el('div', { class: 'informe__cuerpo' });
  const conAnexo = el('input', { class: 'informe__casilla', attrs: { type: 'checkbox', id: 'informeConAnexo' } });
  conAnexo.checked = informe.totales.actividades <= 150;

  const pintar = () => {
    render(cuerpo,
      portada(informe),
      resumenInstitucional(informe),
      cronograma(informe),
      presupuesto(informe),
      coberturaENS(informe),
      planAnualCompras(informe),
      calidadDeDatos(informe),
      conAnexo.checked ? anexo(informe) : null
    );
  };
  conAnexo.addEventListener('change', pintar);

  const cerrar = () => {
    vista.remove();
    document.body.classList.remove('con-informe', 'sin-scroll');
    document.removeEventListener('keydown', alPulsarTecla);
  };
  const alPulsarTecla = (e) => { if (e.key === 'Escape') cerrar(); };

  const barra = el('div', { class: 'informe__barra' }, [
    el('div', { class: 'informe__barra-texto' }, [
      el('p', { class: 'informe__barra-titulo', text: `Informe consolidado ${informe.anio}` }),
      el('p', { class: 'informe__barra-sub', text: `${numero(informe.totales.actividades)} actividades · ${informe.porPlan.map((b) => b.plan.nombreCorto).join(' + ')} · PAC` })
    ]),
    el('label', { class: 'informe__opcion' }, [
      conAnexo,
      el('span', { text: 'Incluir el anexo con el detalle de cada actividad' })
    ]),
    el('div', { class: 'informe__acciones' }, [
      alExportarExcel && el('button', {
        class: 'btn btn--secundario', attrs: { type: 'button' }, text: 'Descargar Excel',
        on: { click: () => alExportarExcel() }
      }),
      el('button', {
        class: 'btn btn--primario', attrs: { type: 'button' }, text: 'Imprimir o guardar como PDF',
        on: { click: () => print() }
      }),
      el('button', {
        class: 'btn btn--fantasma', attrs: { type: 'button' }, text: 'Cerrar',
        on: { click: cerrar }
      })
    ].filter(Boolean))
  ]);

  const vista = el('div', {
    class: 'informe',
    attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': `Informe consolidado ${informe.anio}` }
  }, [barra, cuerpo]);

  pintar();
  document.body.append(vista);
  document.body.classList.add('con-informe', 'sin-scroll');
  document.addEventListener('keydown', alPulsarTecla);
  vista.focus?.();
  return { cerrar, elemento: vista };
}
