/**
 * Informe institucional consolidado.
 *
 * «Exportar a Excel» entrega el plan que se está viendo, tal como lo trabaja
 * cada equipo. Este informe es otra cosa: reúne TODA la planificación —los dos
 * planes, el Plan Anual de Compras y el estado de completitud de cada ficha—
 * en una sola entrega. Es lo que Control de Gestión necesita para consolidar.
 *
 * El módulo está partido en dos mitades a propósito:
 *
 *   - `reunirInforme()` calcula y no toca nada más: ni el DOM, ni descargas, ni
 *     librerías externas. Por eso se puede probar sin navegador y por eso la
 *     vista imprimible consume exactamente los mismos números que el Excel. Si
 *     alguna vez las dos salidas discreparan, sería un error de formato, nunca
 *     de cálculo.
 *   - `exportarInformeExcel()` solo da formato a lo ya calculado.
 *
 * Los montos van siempre en miles de pesos (M$), igual que en el resto de la
 * plataforma.
 */

import {
  MESES, IDS_MESES, validarActividad, revisarActividad, camposPendientes
} from './modelo.js';
import { etiquetaDe, buscarAsignacion } from './catalogos.js';
import { construirFilas, construirFilasPac, cargarXLSX, seguro } from './exportar.js';
import { nombreArchivo, monto } from './formato.js';

/**
 * Campos que no impiden guardar pero que una ficha entregable debería traer.
 * Se listan aparte de los obligatorios porque el informe distingue «falta algo
 * exigido» de «falta algo esperable»: son dos conversaciones distintas con el
 * equipo que la registró.
 */
const RECOMENDADOS = [
  ['codigoActividad', 'Código de actividad'],
  ['responsable', 'Responsable'],
  ['correoInstitucional', 'Correo institucional'],
  ['tipoActividad', 'Tipo de actividad'],
  ['componentesTransversales', 'Componente transversal']
  // Descripción y medio de verificación salieron de aquí en la versión 3.6:
  // pasaron a ser obligatorios y los informa `validarActividad`. Dejarlos en
  // las dos listas los contaría dos veces.
];

const ETIQUETA_NIVEL = {
  completa: 'Completa',
  parcial: 'Faltan datos recomendados',
  incompleta: 'Faltan datos obligatorios'
};

/**
 * Estado de una ficha según las MISMAS reglas que usan el formulario y el
 * asistente. No se inventa un criterio nuevo para el informe: si el asistente
 * marca una actividad, el informe la marca igual.
 */
export function estadoDeFicha(actividad, plan) {
  const { errores } = validarActividad(actividad, plan);
  const obligatorios = Object.values(errores);
  const recomendados = RECOMENDADOS.filter(([campo]) => !actividad[campo]).map(([, etiqueta]) => etiqueta);
  const avisos = revisarActividad(actividad).map(describirAviso);

  const nivel = obligatorios.length ? 'incompleta'
    : (recomendados.length || avisos.length) ? 'parcial'
      : 'completa';

  return {
    nivel,
    etiqueta: ETIQUETA_NIVEL[nivel],
    obligatorios,
    recomendados,
    avisos,
    pendientes: obligatorios.length + recomendados.length + avisos.length
  };
}

function describirAviso(aviso) {
  if (aviso.tipo === 'descuadre') {
    const signo = aviso.diferencia > 0 ? 'más' : 'menos';
    return `El Plan Anual de Compras suma ${monto(aviso.pac)} y el subtítulo 22 ${monto(aviso.st22)}: `
      + `${monto(Math.abs(aviso.diferencia))} de ${signo} en las compras.`;
  }
  return aviso.mensaje;
}

/* ------------------------------------------------------------------ */
/* Agregaciones                                                        */
/* ------------------------------------------------------------------ */

const ceros = () => ({
  actividades: 0, ejecuciones: 0, st21: 0, st22: 0, presupuesto: 0, pac: 0, compras: 0,
  completas: 0, parciales: 0, incompletas: 0
});

function acumular(acc, ficha) {
  const { actividad: a, estado } = ficha;
  acc.actividades += 1;
  acc.ejecuciones += a.totales.cronograma;
  acc.st21 += a.totales.presupuesto21;
  acc.st22 += a.totales.presupuesto22;
  acc.presupuesto += a.totales.presupuesto;
  acc.pac += a.totales.pac;
  acc.compras += a.pac.compras.length;
  acc[estado.nivel === 'completa' ? 'completas' : estado.nivel === 'parcial' ? 'parciales' : 'incompletas'] += 1;
  return acc;
}

/** Agrupa fichas por una clave y devuelve una lista ordenada de mayor a menor. */
function agrupar(fichas, clave) {
  const mapa = new Map();
  for (const f of fichas) {
    const k = clave(f) || 'Sin especificar';
    if (!mapa.has(k)) mapa.set(k, { nombre: k, ...ceros() });
    acumular(mapa.get(k), f);
  }
  return [...mapa.values()].sort((a, b) => b.actividades - a.actividades || a.nombre.localeCompare(b.nombre, 'es'));
}

function totalizar(fichas) {
  return fichas.reduce((acc, f) => acumular(acc, f), ceros());
}

function mensualizar(fichas) {
  return MESES.map((m) => {
    const fila = { id: m.id, mes: m.largo, corto: m.corto, ejecuciones: 0, st21: 0, st22: 0, presupuesto: 0 };
    for (const { actividad: a } of fichas) {
      fila.ejecuciones += a.cronograma[m.id];
      fila.st21 += a.presupuesto['21'].meses[m.id];
      fila.st22 += a.presupuesto['22'].meses[m.id];
    }
    fila.presupuesto = fila.st21 + fila.st22;
    return fila;
  });
}

/* ------------------------------------------------------------------ */
/* Cobertura de la cadena de resultados ENS                            */
/* ------------------------------------------------------------------ */

/**
 * Recorre el árbol ENS completo y cuenta cuántas actividades cuelgan de cada
 * nivel. Lo que interesa aquí no es solo dónde hay actividades, sino dónde NO
 * las hay: un tema sin ninguna actividad es una decisión que alguien debería
 * tomar a conciencia, no un olvido que se descubre en diciembre.
 */
function analizarCobertura(fichasPNS, ens) {
  if (!ens?.objetivosEstrategicos?.length) return null;

  // RE y RI se cuentan junto con su tema: un mismo código puede repetirse en
  // dos temas (el RE 1.4.2 está en «Enfermedades Transmisibles en Eliminación» y
  // en «Infecciones Respiratorias Agudas», con RI distintos), y sin el tema las
  // actividades de uno se contarían también en el otro.
  const contar = (campo, conTema = false) => {
    const m = new Map();
    for (const { actividad: a } of fichasPNS) {
      if (!a[campo]) continue;
      const k = conTema ? `${a.tema}\u0000${a[campo]}` : a[campo];
      m.set(k, (m.get(k) || 0) + 1);
    }
    return m;
  };

  const porOE = contar('objetivoEstrategico');
  const porRE = contar('resultadoEsperado', true);
  const porRI = contar('resultadoInmediato', true);

  const porTema = new Map();
  for (const { actividad: a } of fichasPNS) {
    if (!a.tema) continue;
    const k = `${a.objetivoEstrategico}\u0000${a.tema}`;
    porTema.set(k, (porTema.get(k) || 0) + 1);
  }

  const objetivos = [];
  const temas = [];
  const resultadosEsperados = [];

  for (const oe of ens.objetivosEstrategicos) {
    let temasCubiertos = 0;
    for (const t of oe.temas) {
      const n = porTema.get(`${oe.codigo}\u0000${t.nombre}`) || 0;
      if (n) temasCubiertos += 1;
      temas.push({ oe: oe.codigo, oeNombre: oe.nombre, nombre: t.nombre, actividades: n });

      for (const oi of t.objetivosImpacto) {
        for (const re of oi.resultadosEsperados) {
          resultadosEsperados.push({
            oe: oe.codigo, tema: t.nombre, oi: oi.codigo,
            codigo: re.codigo, nombre: re.nombre,
            actividades: porRE.get(`${t.nombre}\u0000${re.codigo}`) || 0,
            resultadosInmediatos: re.resultadosInmediatos.length,
            riCubiertos: re.resultadosInmediatos.filter((ri) => porRI.has(`${t.nombre}\u0000${ri.codigo}`)).length
          });
        }
      }
    }
    objetivos.push({
      codigo: oe.codigo, nombre: oe.nombre,
      actividades: porOE.get(oe.codigo) || 0,
      temas: oe.temas.length, temasCubiertos
    });
  }

  return {
    objetivos,
    temas,
    resultadosEsperados,
    temasSinActividades: temas.filter((t) => !t.actividades),
    resultadosSinActividades: resultadosEsperados.filter((r) => !r.actividades),
    resumen: {
      objetivos: objetivos.length,
      objetivosCubiertos: objetivos.filter((o) => o.actividades).length,
      temas: temas.length,
      temasCubiertos: temas.filter((t) => t.actividades).length,
      resultadosEsperados: resultadosEsperados.length,
      resultadosCubiertos: resultadosEsperados.filter((r) => r.actividades).length
    }
  };
}

/* ------------------------------------------------------------------ */
/* Plan Anual de Compras                                               */
/* ------------------------------------------------------------------ */

function analizarPac(fichas, { clasificador, catalogos }) {
  const compras = [];
  const conciliacion = [];

  for (const { actividad: a, plan } of fichas) {
    if (!a.pac.aplica) continue;

    for (const c of a.pac.compras) {
      compras.push({
        actividad: a, plan, compra: c,
        ref: buscarAsignacion(clasificador, c.clasificador),
        faltan: camposPendientes(c),
        // El programa de la compra es el del subtítulo 22 de su actividad: el
        // PAC vive dentro de ese subtítulo y se carga a ese programa.
        programa: a.presupuesto?.['22']?.programa || '',
        departamento: etiquetaDe(catalogos.departamentos, a.departamento)
      });
    }

    const diferencia = a.totales.pac - a.totales.presupuesto22;
    conciliacion.push({
      actividad: a, plan,
      departamento: etiquetaDe(catalogos.departamentos, a.departamento),
      totalPac: a.totales.pac,
      st22: a.totales.presupuesto22,
      diferencia,
      cuadra: Math.abs(diferencia) <= 0.5,
      comprasIncompletas: a.pac.compras.filter((c) => camposPendientes(c).length).length
    });
  }

  // Por ítem del clasificador: es la vista que pide Adquisiciones.
  const porItem = new Map();
  for (const c of compras) {
    const clave = c.ref ? `${c.ref.item.codigo} · ${c.ref.item.nombre}` : 'Sin clasificador asignado';
    if (!porItem.has(clave)) porItem.set(clave, { nombre: clave, compras: 0, monto: 0 });
    const acc = porItem.get(clave);
    acc.compras += 1;
    acc.monto += c.compra.monto;
  }

  // Por mes de compra estimado: sirve para ver la carga del calendario anual.
  const porMesCompra = MESES.map((m, i) => ({
    id: m.id, mes: m.largo, corto: m.corto, compras: 0, monto: 0, indice: i + 1
  }));
  const sinFecha = { mes: 'Sin fecha estimada', compras: 0, monto: 0 };
  for (const c of compras) {
    const mes = Number(String(c.compra.fechaCompra || '').slice(5, 7));
    const destino = mes >= 1 && mes <= 12 ? porMesCompra[mes - 1] : sinFecha;
    destino.compras += 1;
    destino.monto += c.compra.monto;
  }

  // Por programa del subtítulo 22: con cargo a qué se compra.
  const porPrograma = new Map();
  for (const c of compras) {
    const clave = c.programa || 'Sin programa asignado';
    if (!porPrograma.has(clave)) porPrograma.set(clave, { nombre: clave, compras: 0, monto: 0, criticas: 0 });
    const acc = porPrograma.get(clave);
    acc.compras += 1;
    acc.monto += c.compra.monto;
    if (c.compra.criticaSGC) acc.criticas += 1;
  }

  // Compras críticas para el SGC, en el orden en que hay que gestionarlas: por
  // fecha estimada de compra, y las que no tienen fecha al final (son las que
  // más urge completar).
  const criticas = compras
    .filter((c) => c.compra.criticaSGC)
    .sort((x, y) => (x.compra.fechaCompra || '9999').localeCompare(y.compra.fechaCompra || '9999'));

  return {
    compras,
    conciliacion,
    porItem: [...porItem.values()].sort((a, b) => b.monto - a.monto),
    porPrograma: [...porPrograma.values()].sort((a, b) => b.monto - a.monto),
    porMesCompra,
    sinFecha,
    criticas,
    totales: {
      compras: compras.length,
      actividades: conciliacion.length,
      monto: compras.reduce((s, c) => s + c.compra.monto, 0),
      incompletas: compras.filter((c) => c.faltan.length).length,
      descuadres: conciliacion.filter((c) => !c.cuadra).length,
      criticasSGC: criticas.length,
      montoSGC: criticas.reduce((s, c) => s + c.compra.monto, 0)
    }
  };
}

/* ------------------------------------------------------------------ */
/* Reunión de datos                                                    */
/* ------------------------------------------------------------------ */

/**
 * Calcula el informe completo a partir de todas las actividades registradas.
 *
 * @param {object} ctx
 * @param {Array}  ctx.actividades Todas las actividades, de cualquier plan.
 * @param {Array}  ctx.planes      Definiciones de plan (PLANES).
 * @param {object} ctx.catalogos   Catálogos institucionales.
 * @param {object} [ctx.ens]       Índice de la cadena de resultados ENS.
 * @param {object} [ctx.clasificador] Clasificador presupuestario.
 */
export function reunirInforme({
  actividades, planes, catalogos, ens = null, clasificador = { items: [] },
  institucion = '', anio = new Date().getFullYear(), alcance = ''
}) {
  const porId = new Map(planes.map((p) => [p.id, p]));

  // Cada actividad se envuelve una sola vez con su plan y su estado: todo lo
  // que sigue trabaja sobre esta lista y no vuelve a validar nada.
  const fichas = actividades.map((actividad) => {
    const plan = porId.get(actividad.plan) || planes[0];
    return { actividad, plan, estado: estadoDeFicha(actividad, plan) };
  });

  const porPlan = planes.map((plan) => {
    const propias = fichas.filter((f) => f.plan.id === plan.id);
    return {
      plan,
      fichas: propias,
      actividades: propias.map((f) => f.actividad),
      totales: totalizar(propias),
      porDepartamento: agrupar(propias, (f) => etiquetaDe(catalogos.departamentos, f.actividad.departamento)),
      porTipo: agrupar(propias, (f) => etiquetaDe(catalogos.tiposActividad, f.actividad.tipoActividad)),
      porComponente: agrupar(propias, (f) => etiquetaDe(catalogos.componentesTransversales, f.actividad.componentesTransversales)),
      porMes: mensualizar(propias)
    };
  });

  const pns = porPlan.find((p) => p.plan.id === 'pns');

  return {
    generado: new Date(),
    institucion,
    anio,
    // «Solo actividades aprobadas…» cuando el circuito de aprobación rige y se
    // pidió el informe para el traspaso; vacío si incluye todo.
    alcance,
    catalogos,
    ens,
    clasificador,
    fichas,
    totales: totalizar(fichas),
    porPlan,
    porDepartamento: agrupar(fichas, (f) => etiquetaDe(catalogos.departamentos, f.actividad.departamento)),
    porTipo: agrupar(fichas, (f) => etiquetaDe(catalogos.tiposActividad, f.actividad.tipoActividad)),
    porComponente: agrupar(fichas, (f) => etiquetaDe(catalogos.componentesTransversales, f.actividad.componentesTransversales)),
    porMes: mensualizar(fichas),
    cobertura: pns ? analizarCobertura(pns.fichas, ens) : null,
    pac: analizarPac(fichas, { clasificador, catalogos }),
    // Solo lo que pide acción: es la lista con la que se persigue a los equipos.
    calidad: fichas
      .filter((f) => f.estado.nivel !== 'completa')
      .sort((a, b) => b.estado.pendientes - a.estado.pendientes)
  };
}

/* ------------------------------------------------------------------ */
/* Excel                                                               */
/* ------------------------------------------------------------------ */

const anchos = (...ns) => ns.map((wch) => ({ wch }));

/** Agrega una hoja y le pone anchos y fila de encabezado congelada. */
function agregarHoja(XLSX, libro, nombre, aoa, { cols, congelar = 0, filtro = null } = {}) {
  const hoja = XLSX.utils.aoa_to_sheet(aoa);
  if (cols) hoja['!cols'] = cols;
  if (congelar) hoja['!freeze'] = { xSplit: 0, ySplit: congelar };
  if (filtro && filtro.filas > 0) {
    hoja['!autofilter'] = {
      ref: XLSX.utils.encode_range({
        s: { r: filtro.desde, c: 0 },
        e: { r: filtro.desde + filtro.filas, c: filtro.columnas - 1 }
      })
    };
  }
  XLSX.utils.book_append_sheet(libro, hoja, nombre);
  return hoja;
}

/**
 * Filas de detalle de un plan, reutilizando el mismo constructor que usa la
 * exportación normal y agregándole las tres columnas de estado. Así el informe
 * nunca se desalinea con lo que exporta cada equipo.
 */
function detalleConEstado(bloque, { catalogos, ens }) {
  const { encabezados, filas } = construirFilas(bloque.actividades, { plan: bloque.plan, catalogos, ens });
  return {
    encabezados: [...encabezados, 'Estado de la ficha', 'Datos obligatorios que faltan', 'Datos recomendados que faltan', 'Observaciones del PAC'],
    filas: filas.map((fila, i) => {
      const { estado } = bloque.fichas[i];
      return [
        ...fila,
        estado.etiqueta,
        seguro(estado.obligatorios.join(' | ')),
        seguro(estado.recomendados.join(' | ')),
        seguro(estado.avisos.join(' | '))
      ];
    })
  };
}

/**
 * Genera y descarga el informe consolidado en Excel.
 * @returns {Promise<{hojas: string[], actividades: number}>}
 */
export async function exportarInformeExcel(informe) {
  const XLSX = await cargarXLSX();
  const { catalogos, ens, clasificador, anio, institucion, totales } = informe;
  const libro = XLSX.utils.book_new();
  const fechaTexto = informe.generado.toLocaleString('es-CL');

  /* --- Portada -------------------------------------------------------- */
  const portada = [
    [`Informe consolidado de planificación ${anio}`],
    [institucion],
    [`Generado el ${fechaTexto}`],
    ...(informe.alcance ? [[informe.alcance]] : []),
    [],
    ['Resumen general'],
    ['Actividades registradas', totales.actividades],
    ['Departamentos con actividades', informe.porDepartamento.length],
    ['Ejecuciones programadas en el año', totales.ejecuciones],
    ['Presupuesto subtítulo 21 (M$)', totales.st21],
    ['Presupuesto subtítulo 22 (M$)', totales.st22],
    ['Presupuesto total (M$)', totales.presupuesto],
    ['Compras del Plan Anual de Compras', informe.pac.totales.compras],
    ['Monto del Plan Anual de Compras (M$)', informe.pac.totales.monto],
    ['Compras críticas para el SGC', informe.pac.totales.criticasSGC],
    ['Monto de las compras críticas para el SGC (M$)', informe.pac.totales.montoSGC],
    [],
    ['Estado de las fichas'],
    ['Completas', totales.completas],
    ['Con datos recomendados pendientes', totales.parciales],
    ['Con datos obligatorios pendientes', totales.incompletas],
    [],
    ['Por plan', 'Actividades', 'Ejecuciones', 'ST21 (M$)', 'ST22 (M$)', 'Total (M$)', 'PAC (M$)'],
    ...informe.porPlan.map((b) => [
      b.plan.nombre, b.totales.actividades, b.totales.ejecuciones,
      b.totales.st21, b.totales.st22, b.totales.presupuesto, b.totales.pac
    ]),
    [],
    ['Contenido de este libro'],
    ['Resumen', 'Totales por departamento, considerando ambos planes.'],
    ...informe.porPlan.map((b) => [b.plan.nombreCorto, `Detalle completo de cada actividad del ${b.plan.nombre}.`]),
    ['PAC', 'Todas las compras del Plan Anual de Compras, una fila por compra.'],
    ['Conciliación PAC', 'Comparación entre el PAC y el subtítulo 22 de cada actividad.'],
    ['Presupuesto', 'Distribución mensual del presupuesto por subtítulo.'],
    ['Cronograma', 'Ejecuciones mensuales por departamento.'],
    ['Cobertura ENS', 'Actividades por objetivo, tema y resultado esperado de la ENS.'],
    ['Calidad de datos', 'Fichas con datos pendientes y qué les falta a cada una.']
  ];
  agregarHoja(XLSX, libro, 'Portada', portada, { cols: anchos(46, 16, 14, 14, 14, 14, 14) });

  /* --- Resumen por departamento --------------------------------------- */
  const resumen = [
    [`Resumen institucional ${anio}`],
    [institucion],
    [],
    ['Departamento', 'Actividades', 'Ejecuciones', 'ST21 (M$)', 'ST22 (M$)', 'Total (M$)',
      'PAC (M$)', 'Compras', 'Completas', 'Con pendientes recomendados', 'Con pendientes obligatorios'],
    ...informe.porDepartamento.map((d) => [
      seguro(d.nombre), d.actividades, d.ejecuciones, d.st21, d.st22, d.presupuesto,
      d.pac, d.compras, d.completas, d.parciales, d.incompletas
    ]),
    ['TOTAL', totales.actividades, totales.ejecuciones, totales.st21, totales.st22,
      totales.presupuesto, totales.pac, totales.compras, totales.completas, totales.parciales, totales.incompletas],
    [],
    ['Tipo de actividad', 'Actividades', 'Ejecuciones', 'Presupuesto (M$)'],
    ...informe.porTipo.map((t) => [seguro(t.nombre), t.actividades, t.ejecuciones, t.presupuesto]),
    [],
    ['Componente transversal', 'Actividades', 'Ejecuciones', 'Presupuesto (M$)'],
    ...informe.porComponente.map((t) => [seguro(t.nombre), t.actividades, t.ejecuciones, t.presupuesto])
  ];
  agregarHoja(XLSX, libro, 'Resumen', resumen, { cols: anchos(44, 12, 13, 13, 13, 13, 13, 10, 12, 26, 26) });

  /* --- Detalle por plan ------------------------------------------------ */
  for (const bloque of informe.porPlan) {
    if (!bloque.actividades.length) continue;
    const { encabezados, filas } = detalleConEstado(bloque, { catalogos, ens });
    agregarHoja(XLSX, libro, bloque.plan.nombreCorto, [encabezados, ...filas], {
      cols: encabezados.map((h, i) => ({ wch: i < 12 ? Math.min(Math.max(h.length + 4, 14), 46) : 14 })),
      congelar: 1,
      filtro: { desde: 0, filas: filas.length, columnas: encabezados.length }
    });
  }

  /* --- Plan Anual de Compras ------------------------------------------- */
  const encPac = ['Plan', ...construirFilasPac([], { catalogos, clasificador }).encabezados];
  const filasPac = [];
  for (const bloque of informe.porPlan) {
    const { filas } = construirFilasPac(bloque.actividades, { catalogos, clasificador, plan: bloque.plan });
    for (const fila of filas) filasPac.push([bloque.plan.nombreCorto, ...fila]);
  }
  agregarHoja(XLSX, libro, 'PAC', [encPac, ...filasPac], {
    cols: anchos(8, 10, 40, 30, 22, 14, 8, 32, 40, 34, 40, 10, 18, 20, 16, 12, 26),
    congelar: 1,
    filtro: { desde: 0, filas: filasPac.length, columnas: encPac.length }
  });

  /* --- Conciliación PAC ------------------------------------------------ */
  const conciliacion = [
    ['Conciliación entre el Plan Anual de Compras y el subtítulo 22'],
    ['Ambos describen el mismo gasto: si no cuadran, alguno de los dos está mal.'],
    [],
    ['Plan', 'Código', 'Actividad', 'Departamento', 'Responsable',
      'Total PAC (M$)', 'Subtítulo 22 (M$)', 'Diferencia (M$)', 'Estado', 'Compras', 'Compras incompletas'],
    ...informe.pac.conciliacion.map((c) => [
      c.plan.nombreCorto,
      seguro(c.actividad.codigoActividad),
      seguro(c.actividad.nombreActividad),
      seguro(c.departamento),
      seguro(c.actividad.responsable),
      c.totalPac, c.st22, c.diferencia,
      c.cuadra ? 'Cuadra' : 'Descuadrada',
      c.actividad.pac.compras.length,
      c.comprasIncompletas
    ]),
    [],
    ['TOTAL', '', '', '', '', informe.pac.totales.monto,
      informe.pac.conciliacion.reduce((s, c) => s + c.st22, 0),
      informe.pac.conciliacion.reduce((s, c) => s + c.diferencia, 0)],
    [],
    ['Compras por ítem del clasificador'],
    ['Ítem', 'Compras', 'Monto (M$)'],
    ...informe.pac.porItem.map((i) => [seguro(i.nombre), i.compras, i.monto]),
    [],
    ['Compras por programa (subtítulo 22)'],
    ['Programa', 'Compras', 'Monto (M$)', 'Críticas para el SGC'],
    ...informe.pac.porPrograma.map((p) => [seguro(p.nombre), p.compras, p.monto, p.criticas]),
    [],
    ['Compras por mes estimado de compra'],
    ['Mes', 'Compras', 'Monto (M$)'],
    ...informe.pac.porMesCompra.map((m) => [m.mes, m.compras, m.monto]),
    [informe.pac.sinFecha.mes, informe.pac.sinFecha.compras, informe.pac.sinFecha.monto],
    [],
    ['Compras críticas para el Sistema de Gestión de Calidad (SGC)'],
    [informe.pac.totales.criticasSGC
      ? 'Ordenadas por fecha estimada de compra: es el orden en que hay que gestionarlas.'
      : 'No hay compras marcadas como críticas para el SGC.'],
    ...(informe.pac.totales.criticasSGC ? [
      ['Plan', 'Código', 'Actividad', 'Departamento', 'Producto o servicio', 'Programa (subtítulo 22)',
        'Fecha estimada de compra', 'Fecha estimada de ejecución', 'Monto (M$)'],
      ...informe.pac.criticas.map((c) => [
        c.plan.nombreCorto,
        seguro(c.actividad.codigoActividad),
        seguro(c.actividad.nombreActividad),
        seguro(c.departamento),
        seguro(c.compra.producto),
        seguro(c.programa),
        c.compra.fechaCompra || 'Sin fecha',
        c.compra.fechaEjecucion || 'Sin fecha',
        c.compra.monto
      ]),
      ['TOTAL', '', '', '', '', '', '', '', informe.pac.totales.montoSGC]
    ] : [])
  ];
  agregarHoja(XLSX, libro, 'Conciliación PAC', conciliacion, {
    cols: anchos(8, 10, 44, 30, 34, 26, 17, 17, 14, 10, 19)
  });

  /* --- Presupuesto ----------------------------------------------------- */
  const presupuesto = [
    [`Presupuesto ${anio} · distribución mensual (M$)`],
    [],
    ['Mes', 'Subtítulo 21', 'Subtítulo 22', 'Total'],
    ...informe.porMes.map((m) => [m.mes, m.st21, m.st22, m.presupuesto]),
    ['TOTAL', totales.st21, totales.st22, totales.presupuesto],
    [],
    ['Presupuesto por departamento y plan (M$)'],
    ['Departamento', ...informe.porPlan.flatMap((b) => [`${b.plan.nombreCorto} ST21`, `${b.plan.nombreCorto} ST22`]), 'Total', 'PAC'],
    ...informe.porDepartamento.map((d) => {
      const nombre = d.nombre;
      const celdas = informe.porPlan.flatMap((b) => {
        const propias = b.fichas.filter((f) => etiquetaDe(catalogos.departamentos, f.actividad.departamento) === nombre);
        return [
          propias.reduce((s, f) => s + f.actividad.totales.presupuesto21, 0),
          propias.reduce((s, f) => s + f.actividad.totales.presupuesto22, 0)
        ];
      });
      return [seguro(nombre), ...celdas, d.presupuesto, d.pac];
    })
  ];
  agregarHoja(XLSX, libro, 'Presupuesto', presupuesto, { cols: anchos(44, 15, 15, 15, 15, 15, 15) });

  /* --- Cronograma ------------------------------------------------------ */
  const cronograma = [
    [`Cronograma ${anio} · ejecuciones programadas`],
    [],
    ['Departamento', ...MESES.map((m) => m.corto), 'Total'],
    ...informe.porDepartamento.map((d) => {
      const propias = informe.fichas.filter((f) => etiquetaDe(catalogos.departamentos, f.actividad.departamento) === d.nombre);
      const meses = IDS_MESES.map((m) => propias.reduce((s, f) => s + f.actividad.cronograma[m], 0));
      return [seguro(d.nombre), ...meses, d.ejecuciones];
    }),
    ['TOTAL', ...informe.porMes.map((m) => m.ejecuciones), totales.ejecuciones]
  ];
  agregarHoja(XLSX, libro, 'Cronograma', cronograma, { cols: anchos(44, ...Array(13).fill(8)) });

  /* --- Cobertura ENS --------------------------------------------------- */
  if (informe.cobertura) {
    const c = informe.cobertura;
    const hoja = [
      ['Cobertura de la Estrategia Nacional de Salud'],
      ['Solo considera las actividades del Plan Nacional de Salud.'],
      [],
      ['Objetivos estratégicos con actividades', `${c.resumen.objetivosCubiertos} de ${c.resumen.objetivos}`],
      ['Temas con actividades', `${c.resumen.temasCubiertos} de ${c.resumen.temas}`],
      ['Resultados esperados con actividades', `${c.resumen.resultadosCubiertos} de ${c.resumen.resultadosEsperados}`],
      [],
      ['Objetivo estratégico', 'Nombre', 'Actividades', 'Temas cubiertos', 'Temas del objetivo'],
      ...c.objetivos.map((o) => [o.codigo, seguro(o.nombre), o.actividades, o.temasCubiertos, o.temas]),
      [],
      ['Tema', 'Objetivo estratégico', 'Actividades'],
      ...c.temas.map((t) => [seguro(t.nombre), t.oe, t.actividades]),
      [],
      ['Resultado esperado', 'Nombre', 'OE', 'Tema', 'Actividades', 'RI con actividades', 'RI del resultado'],
      ...c.resultadosEsperados.map((r) => [
        r.codigo, seguro(r.nombre), r.oe, seguro(r.tema), r.actividades, r.riCubiertos, r.resultadosInmediatos
      ])
    ];
    agregarHoja(XLSX, libro, 'Cobertura ENS', hoja, { cols: anchos(20, 60, 12, 16, 18, 18, 16) });
  }

  /* --- Calidad de datos ------------------------------------------------ */
  const calidad = [
    ['Fichas con datos pendientes'],
    ['Se listan de mayor a menor cantidad de pendientes. Las fichas completas no aparecen.'],
    [],
    ['Plan', 'Código', 'Actividad', 'Departamento', 'Responsable', 'Correo', 'Estado',
      'Datos obligatorios que faltan', 'Datos recomendados que faltan', 'Observaciones del PAC'],
    ...informe.calidad.map(({ actividad: a, plan, estado }) => [
      plan.nombreCorto,
      seguro(a.codigoActividad),
      seguro(a.nombreActividad),
      seguro(etiquetaDe(catalogos.departamentos, a.departamento)),
      seguro(a.responsable),
      seguro(a.correoInstitucional),
      estado.etiqueta,
      seguro(estado.obligatorios.join(' | ')),
      seguro(estado.recomendados.join(' | ')),
      seguro(estado.avisos.join(' | '))
    ])
  ];
  agregarHoja(XLSX, libro, 'Calidad de datos', calidad, {
    cols: anchos(8, 10, 44, 30, 22, 28, 26, 50, 50, 50),
    congelar: 4,
    filtro: { desde: 3, filas: informe.calidad.length, columnas: 10 }
  });

  XLSX.writeFile(libro, nombreArchivo(`informe-planificacion-${anio}`, 'xlsx'), { compression: true });

  return {
    hojas: libro.SheetNames.slice(),
    actividades: totales.actividades
  };
}
