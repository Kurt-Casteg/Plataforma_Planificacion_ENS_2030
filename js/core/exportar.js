/**
 * Exportación e importación.
 *
 *  - Excel (.xlsx) : entrega oficial, una hoja de datos y una de resumen.
 *  - CSV           : alternativa universal si no carga la librería de Excel.
 *  - JSON          : respaldo y consolidación entre equipos (formato propio).
 *
 * Seguridad: los valores de texto que empiezan con =, +, - o @ se neutralizan
 * al exportar, para evitar la inyección de fórmulas en Excel (CSV injection).
 */

import { MESES, IDS_MESES, SUBTITULOS, normalizarActividad } from './modelo.js';
import { nombreArchivo } from './formato.js';
import { etiquetaDe } from './catalogos.js';

/** Copia local primero; las CDN quedan como respaldo. */
const SHEETJS = [
  new URL('../../vendor/xlsx.full.min.js', import.meta.url).href,
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
];

let promesaXLSX = null;

/** Carga SheetJS bajo demanda, con una fuente alternativa si la primera falla. */
function cargarXLSX() {
  if (globalThis.XLSX) return Promise.resolve(globalThis.XLSX);
  if (promesaXLSX) return promesaXLSX;

  promesaXLSX = SHEETJS.reduce(
    (cadena, url) => cadena.catch(() => new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url;
      s.referrerPolicy = 'no-referrer';
      s.onload = () => (globalThis.XLSX ? resolve(globalThis.XLSX) : reject(new Error('XLSX no disponible')));
      s.onerror = () => reject(new Error(`No se pudo cargar ${url}`));
      document.head.append(s);
    })),
    Promise.reject(new Error('inicio'))
  ).catch((e) => { promesaXLSX = null; throw e; });

  return promesaXLSX;
}

/** Neutraliza fórmulas: un texto que abre con = + - @ deja de ser ejecutable. */
const seguro = (v) => {
  if (typeof v !== 'string') return v;
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
};

/* ------------------------------------------------------------------ */
/* Construcción de filas                                               */
/* ------------------------------------------------------------------ */

const COLUMNAS_BASE = [
  ['codigoActividad', 'Código'],
  ['departamento', 'Departamento', 'departamentos'],
  ['responsable', 'Responsable'],
  ['correoInstitucional', 'Correo institucional']
];

const COLUMNAS_PNS = [
  ['objetivoEstrategico', 'OE (código)'],
  ['_oeNombre', 'Objetivo estratégico'],
  ['tema', 'Tema'],
  ['objetivoImpacto', 'OI (código)'],
  ['_oiNombre', 'Objetivo de impacto'],
  ['resultadoEsperado', 'RE (código)'],
  ['_reNombre', 'Resultado esperado'],
  ['resultadoInmediato', 'RI (código)'],
  ['_riNombre', 'Resultado inmediato']
];

const COLUMNAS_PGI = [
  ['objetivoEstrategicoTexto', 'Objetivo estratégico'],
  ['objetivoOperacional', 'Objetivo operacional'],
  ['producto', 'Producto']
];

const COLUMNAS_DETALLE = [
  ['nombreActividad', 'Nombre de la actividad'],
  ['tipoActividad', 'Tipo de actividad', 'tiposActividad'],
  ['componentesTransversales', 'Componente transversal', 'componentesTransversales'],
  ['descripcionActividad', 'Descripción'],
  ['medioVerificacion', 'Medio de verificación']
];

/**
 * Convierte las actividades en filas planas listas para una planilla.
 * @param {object} ctx { plan, catalogos, ens }
 */
export function construirFilas(actividades, { plan, catalogos, ens }) {
  const columnas = [
    ...COLUMNAS_BASE,
    ...(plan.id === 'pns' ? COLUMNAS_PNS : COLUMNAS_PGI),
    ...COLUMNAS_DETALLE
  ];

  const encabezados = [
    ...columnas.map(([, etiqueta]) => etiqueta),
    ...MESES.map((m) => `Cronograma ${m.corto}`),
    'Total ejecuciones',
    'Requiere presupuesto',
    'ST21 categoría programática', 'ST21 programa',
    ...MESES.map((m) => `ST21 ${m.corto}`),
    'Total ST21 (M$)',
    'ST22 categoría programática', 'ST22 programa',
    ...MESES.map((m) => `ST22 ${m.corto}`),
    'Total ST22 (M$)',
    'Total presupuesto (M$)',
    'Fecha de registro'
  ];

  const filas = actividades.map((a) => {
    const ruta = ens && a.resultadoInmediato ? ens.rutaDeRI(a.resultadoInmediato) : null;
    const derivados = {
      _oeNombre: ruta?.oe.nombre ?? '',
      _oiNombre: ruta?.oi.nombre ?? '',
      _reNombre: ruta?.re.nombre ?? '',
      _riNombre: ruta?.ri.nombre ?? ''
    };

    const valor = ([campo, , catalogo]) => {
      const bruto = campo.startsWith('_') ? derivados[campo] : a[campo];
      return seguro(catalogo ? (etiquetaDe(catalogos[catalogo], bruto) || bruto || '') : (bruto ?? ''));
    };

    return [
      ...columnas.map(valor),
      ...IDS_MESES.map((m) => a.cronograma[m]),
      a.totales.cronograma,
      a.sinPresupuesto ? 'No' : 'Sí',
      seguro(a.presupuesto['21'].programatico), seguro(a.presupuesto['21'].programa),
      ...IDS_MESES.map((m) => a.presupuesto['21'].meses[m]),
      a.totales.presupuesto21,
      seguro(a.presupuesto['22'].programatico), seguro(a.presupuesto['22'].programa),
      ...IDS_MESES.map((m) => a.presupuesto['22'].meses[m]),
      a.totales.presupuesto22,
      a.totales.presupuesto,
      new Date(a.creadaEn).toLocaleDateString('es-CL')
    ];
  });

  return { encabezados, filas };
}

/* ------------------------------------------------------------------ */
/* Excel                                                               */
/* ------------------------------------------------------------------ */

export async function exportarExcel(actividades, ctx) {
  const XLSX = await cargarXLSX();
  const { plan, catalogos, institucion, anio } = ctx;
  const { encabezados, filas } = construirFilas(actividades, ctx);

  const libro = XLSX.utils.book_new();

  // Hoja 1: datos.
  const hoja = XLSX.utils.aoa_to_sheet([encabezados, ...filas]);
  hoja['!cols'] = encabezados.map((h, i) => ({ wch: i < 12 ? Math.min(Math.max(h.length + 4, 14), 46) : 12 }));
  hoja['!freeze'] = { xSplit: 0, ySplit: 1 };
  hoja['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: filas.length, c: encabezados.length - 1 } }) };
  XLSX.utils.book_append_sheet(libro, hoja, 'Actividades');

  // Hoja 2: resumen por departamento.
  const porDepto = new Map();
  for (const a of actividades) {
    const clave = etiquetaDe(catalogos.departamentos, a.departamento) || 'Sin departamento';
    const acumulado = porDepto.get(clave) || { actividades: 0, ejecuciones: 0, st21: 0, st22: 0 };
    acumulado.actividades += 1;
    acumulado.ejecuciones += a.totales.cronograma;
    acumulado.st21 += a.totales.presupuesto21;
    acumulado.st22 += a.totales.presupuesto22;
    porDepto.set(clave, acumulado);
  }

  const resumen = [
    [`${plan.nombre} ${anio}`],
    [institucion],
    [`Generado el ${new Date().toLocaleString('es-CL')}`],
    [],
    ['Departamento', 'Actividades', 'Ejecuciones', 'ST21 (M$)', 'ST22 (M$)', 'Total (M$)'],
    ...[...porDepto.entries()]
      .sort((a, b) => b[1].actividades - a[1].actividades)
      .map(([d, v]) => [d, v.actividades, v.ejecuciones, v.st21, v.st22, v.st21 + v.st22]),
    [],
    ['TOTAL',
      actividades.length,
      actividades.reduce((s, a) => s + a.totales.cronograma, 0),
      actividades.reduce((s, a) => s + a.totales.presupuesto21, 0),
      actividades.reduce((s, a) => s + a.totales.presupuesto22, 0),
      actividades.reduce((s, a) => s + a.totales.presupuesto, 0)
    ]
  ];
  const hojaResumen = XLSX.utils.aoa_to_sheet(resumen);
  hojaResumen['!cols'] = [{ wch: 44 }, { wch: 12 }, { wch: 13 }, { wch: 13 }, { wch: 13 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(libro, hojaResumen, 'Resumen');

  XLSX.writeFile(libro, nombreArchivo(`${plan.nombreCorto}-${anio}`, 'xlsx'), { compression: true });
  return filas.length;
}

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

export function exportarCSV(actividades, ctx) {
  const { encabezados, filas } = construirFilas(actividades, ctx);
  const escapar = (v) => {
    const s = String(v ?? '');
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // Punto y coma: es el separador que Excel en español espera.
  const texto = [encabezados, ...filas].map((f) => f.map(escapar).join(';')).join('\r\n');
  descargar(
    new Blob(['﻿' + texto], { type: 'text/csv;charset=utf-8' }),
    nombreArchivo(`${ctx.plan.nombreCorto}-${ctx.anio}`, 'csv')
  );
  return filas.length;
}

/* ------------------------------------------------------------------ */
/* Respaldo JSON                                                       */
/* ------------------------------------------------------------------ */

export function exportarJSON(actividades, { plan, anio, institucion }) {
  const respaldo = {
    formato: 'seremi-planificacion',
    version: 2,
    generado: new Date().toISOString(),
    institucion,
    anio,
    plan: plan.id,
    total: actividades.length,
    actividades
  };
  descargar(
    new Blob([JSON.stringify(respaldo, null, 2)], { type: 'application/json' }),
    nombreArchivo(`respaldo-${plan.nombreCorto}-${anio}`, 'json')
  );
  return actividades.length;
}

/**
 * Lee un archivo de respaldo y devuelve actividades normalizadas.
 * Acepta tanto el formato nuevo como los arreglos planos de la versión anterior.
 */
export async function leerRespaldo(archivo, { planPorDefecto } = {}) {
  const MAX = 20 * 1024 * 1024;
  if (archivo.size > MAX) throw new Error('El archivo supera los 20 MB permitidos.');

  let datos;
  try {
    datos = JSON.parse(await archivo.text());
  } catch {
    throw new Error('El archivo no es un JSON válido.');
  }

  const lista = Array.isArray(datos) ? datos : datos?.actividades;
  if (!Array.isArray(lista)) throw new Error('El archivo no contiene una lista de actividades.');
  if (lista.length > 5000) throw new Error('El archivo contiene demasiados registros (máximo 5.000).');

  const planArchivo = Array.isArray(datos) ? planPorDefecto : (datos.plan || planPorDefecto);
  return lista.map((a) => normalizarActividad(a, { planId: a.plan || planArchivo }));
}

/* ------------------------------------------------------------------ */

function descargar(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombre;
  document.body.append(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export { SUBTITULOS };
