/**
 * Carga de catálogos externos (JSON) con caché en memoria.
 *
 * Antes estos datos vivían dentro de app.js (492 KB de código). Ahora son datos:
 * se actualizan editando un archivo JSON, sin tocar una línea de programación,
 * y el navegador solo descarga el catálogo cuando realmente se necesita.
 */

const cache = new Map();
const BASE = new URL('../../data/', import.meta.url);

async function cargar(archivo) {
  if (cache.has(archivo)) return cache.get(archivo);
  const promesa = fetch(new URL(archivo, BASE), { cache: 'no-cache' })
    .then((r) => {
      if (!r.ok) throw new Error(`No se pudo cargar ${archivo} (HTTP ${r.status})`);
      return r.json();
    })
    .catch((e) => {
      cache.delete(archivo);
      throw e;
    });
  cache.set(archivo, promesa);
  return promesa;
}

export const cargarCatalogos = () => cargar('catalogos.json');
export const cargarENS = () => cargar('ens-2026.json');
export const cargarIndicadores = () => cargar('indicadores-re-2026.json');
export const cargarClasificador = () => cargar('clasificador-presupuestario.json');

/**
 * Opciones agrupadas para el desplegable del clasificador presupuestario.
 * El usuario ve solo texto limpio; el valor que viaja es el código.
 */
export function opcionesClasificador(clasificador) {
  return (clasificador?.items ?? []).map((item) => ({
    grupo: item.nombre,
    opciones: item.asignaciones.map((a) => ({ value: a.codigo, label: a.nombre }))
  }));
}

/** Busca una asignación por su código y devuelve también su ítem. */
export function buscarAsignacion(clasificador, codigo) {
  for (const item of clasificador?.items ?? []) {
    const a = item.asignaciones.find((x) => x.codigo === codigo);
    if (a) return { item, asignacion: a };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Consultas sobre la cadena de resultados ENS                         */
/* ------------------------------------------------------------------ */

/**
 * Envuelve el árbol ENS con métodos de consulta.
 * La estructura es jerárquica: OE → Tema → OI → RE → RI.
 */
export function indexarENS(ens) {
  const oes = ens.objetivosEstrategicos;
  const buscarOE = (cod) => oes.find((o) => o.codigo === cod) || null;
  const buscarTema = (codOE, tema) => buscarOE(codOE)?.temas.find((t) => t.nombre === tema) || null;
  const buscarOI = (codOE, tema, codOI) =>
    buscarTema(codOE, tema)?.objetivosImpacto.find((o) => o.codigo === codOI) || null;
  const buscarRE = (codOE, tema, codOI, codRE) =>
    buscarOI(codOE, tema, codOI)?.resultadosEsperados.find((r) => r.codigo === codRE) || null;

  /** Devuelve el nombre asociado a un código en cualquier nivel. */
  const nombreDe = (nivel, valores) => {
    const { oe, tema, oi, re, ri } = valores;
    switch (nivel) {
      case 'objetivoEstrategico': return buscarOE(oe)?.nombre ?? '';
      case 'tema': return tema ?? '';
      case 'objetivoImpacto': return buscarOI(oe, tema, oi)?.nombre ?? '';
      case 'resultadoEsperado': return buscarRE(oe, tema, oi, re)?.nombre ?? '';
      case 'resultadoInmediato':
        return buscarRE(oe, tema, oi, re)?.resultadosInmediatos.find((x) => x.codigo === ri)?.nombre ?? '';
      default: return '';
    }
  };

  /** Busca un RI por su código recorriendo todo el árbol (para reconstruir textos). */
  const rutaDeRI = (codigoRI) => {
    for (const o of oes) for (const t of o.temas) for (const oi of t.objetivosImpacto)
      for (const re of oi.resultadosEsperados) {
        const ri = re.resultadosInmediatos.find((x) => x.codigo === codigoRI);
        if (ri) return { oe: o, tema: t, oi, re, ri };
      }
    return null;
  };

  return {
    datos: ens,
    objetivosEstrategicos: oes,
    buscarOE, buscarTema, buscarOI, buscarRE, nombreDe, rutaDeRI,
    temasDe: (codOE) => buscarOE(codOE)?.temas ?? [],
    objetivosImpactoDe: (codOE, tema) => buscarTema(codOE, tema)?.objetivosImpacto ?? [],
    resultadosEsperadosDe: (codOE, tema, codOI) => buscarOI(codOE, tema, codOI)?.resultadosEsperados ?? [],
    resultadosInmediatosDe: (codOE, tema, codOI, codRE) =>
      buscarRE(codOE, tema, codOI, codRE)?.resultadosInmediatos ?? []
  };
}

/** Convierte una lista de {id, nombre} en opciones para <select>. */
export const aOpciones = (lista, { valor = 'id', etiqueta = 'nombre' } = {}) =>
  lista.map((x) => ({ value: x[valor], label: x[etiqueta] }));

/** Busca el nombre legible de un id dentro de un catálogo. */
export const etiquetaDe = (lista, id) => lista.find((x) => x.id === id)?.nombre ?? id ?? '';
