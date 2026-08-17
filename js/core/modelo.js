/**
 * Modelo de datos de una actividad y su validación.
 *
 * Toda actividad — venga del formulario, de un archivo importado o de la nube —
 * pasa por `normalizarActividad()` antes de entrar al almacén. Eso garantiza
 * que el resto de la aplicación siempre trabaje con la misma forma de objeto.
 */

export const MESES = [
  { id: 'ene', corto: 'ENE', largo: 'Enero' },
  { id: 'feb', corto: 'FEB', largo: 'Febrero' },
  { id: 'mar', corto: 'MAR', largo: 'Marzo' },
  { id: 'abr', corto: 'ABR', largo: 'Abril' },
  { id: 'may', corto: 'MAY', largo: 'Mayo' },
  { id: 'jun', corto: 'JUN', largo: 'Junio' },
  { id: 'jul', corto: 'JUL', largo: 'Julio' },
  { id: 'ago', corto: 'AGO', largo: 'Agosto' },
  { id: 'sep', corto: 'SEP', largo: 'Septiembre' },
  { id: 'oct', corto: 'OCT', largo: 'Octubre' },
  { id: 'nov', corto: 'NOV', largo: 'Noviembre' },
  { id: 'dic', corto: 'DIC', largo: 'Diciembre' }
];

export const IDS_MESES = MESES.map((m) => m.id);
export const SUBTITULOS = ['21', '22'];

const LIMITES = {
  texto: 300,
  textoLargo: 3000,
  mesCantidad: 100000,
  mesMonto: 100000000
};

/** Identificador único estable, sin depender de Date.now() (que colisiona). */
export function nuevoId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return 'act-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

const texto = (v, max = LIMITES.texto) => (v == null ? '' : String(v).trim().slice(0, max));

/** Convierte a número finito no negativo, tolerando "1.234,5", " 12 " y vacíos. */
export function aNumero(v, max = Infinity) {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.min(Math.max(v, 0), max) : 0;
  if (v == null) return 0;
  let s = String(v).trim();
  if (!s) return 0;
  s = s.replace(/\s/g, '');
  // "1.234,56" (formato chileno) -> "1234.56"; "1234.56" se conserva.
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = parseFloat(s);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, max);
}

/**
 * Lee los doce meses de una fuente.
 *
 * Hay dos formas de origen posibles y no deben mezclarse:
 *  - objeto propio de meses (formato actual): las claves son `ene`…`dic`.
 *  - actividad plana (formato antiguo): el cronograma son `ene`…`dic` y el
 *    presupuesto son `presupuesto_21_ene`…
 *
 * Por eso, cuando la fuente es la actividad plana y se buscan montos, SOLO se
 * aceptan las claves con prefijo. Sin esa restricción el presupuesto del
 * subtítulo 22 —que no existe en el registro antiguo— heredaría por error los
 * valores del cronograma.
 */
const mapaMeses = (fuente, { prefijo = '', soloPrefijo = false, max = Infinity } = {}) =>
  Object.fromEntries(IDS_MESES.map((m) => {
    const clave = prefijo ? `${prefijo}${m}` : m;
    const valor = fuente?.[clave];
    return [m, aNumero(valor !== undefined || soloPrefijo ? valor : fuente?.[m], max)];
  }));

/**
 * Normaliza un identificador de catálogo quitando tildes.
 * Los catálogos antiguos usaban ids con tilde (`dpto_salud_pública`,
 * `capacitación`); los nuevos no. Esto reconcilia ambos sin perder datos.
 */
const idCatalogo = (v) => {
  const s = texto(v, 80);
  if (!s || /\s/.test(s)) return s;
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
};

const sumar = (obj) => Object.values(obj).reduce((a, b) => a + b, 0);

/**
 * Devuelve una actividad normalizada y con todos los totales recalculados.
 * Los totales NUNCA se confían al origen: siempre se derivan de los meses.
 */
export function normalizarActividad(entrada = {}, { planId } = {}) {
  const cronograma = mapaMeses(entrada.cronograma ?? entrada, { max: LIMITES.mesCantidad });

  const presupuesto = {};
  for (const st of SUBTITULOS) {
    presupuesto[st] = {
      programatico: texto(entrada.presupuesto?.[st]?.programatico ?? entrada[`programatico${st}`], 60),
      programa: texto(entrada.presupuesto?.[st]?.programa ?? entrada[`programa${st}`], 200),
      meses: entrada.presupuesto?.[st]?.meses
        // Formato actual: objeto con claves ene…dic.
        ? mapaMeses(entrada.presupuesto[st].meses, { max: LIMITES.mesMonto })
        // Formato antiguo: claves presupuesto_21_ene… dentro de la actividad plana.
        : mapaMeses(entrada, { prefijo: `presupuesto_${st}_`, soloPrefijo: true, max: LIMITES.mesMonto })
    };
  }

  const sinPresupuesto = Boolean(entrada.sinPresupuesto);
  if (sinPresupuesto) {
    for (const st of SUBTITULOS) {
      presupuesto[st].meses = Object.fromEntries(IDS_MESES.map((m) => [m, 0]));
      presupuesto[st].programatico = '';
      presupuesto[st].programa = '';
    }
  }

  const totales = {
    cronograma: sumar(cronograma),
    presupuesto21: sumar(presupuesto['21'].meses),
    presupuesto22: sumar(presupuesto['22'].meses)
  };
  totales.presupuesto = totales.presupuesto21 + totales.presupuesto22;

  const ahora = new Date().toISOString();
  return {
    id: entrada.id ? String(entrada.id) : nuevoId(),
    plan: texto(entrada.plan ?? planId, 30) || 'pns',
    codigoActividad: texto(entrada.codigoActividad, 20),
    departamento: idCatalogo(entrada.departamento),
    responsable: texto(entrada.responsable, 120),
    correoInstitucional: texto(entrada.correoInstitucional, 120),

    // Cadena de resultados (Plan Nacional de Salud)
    objetivoEstrategico: texto(entrada.objetivoEstrategico, 20),
    tema: texto(entrada.tema, 200),
    objetivoImpacto: texto(entrada.objetivoImpacto, 20),
    resultadoEsperado: texto(entrada.resultadoEsperado, 20),
    resultadoInmediato: texto(entrada.resultadoInmediato, 20),

    // Objetivos libres (Plan de Gestión Institucional)
    objetivoEstrategicoTexto: texto(entrada.objetivoEstrategicoTexto, LIMITES.textoLargo),
    objetivoOperacional: texto(entrada.objetivoOperacional, LIMITES.textoLargo),
    producto: texto(entrada.producto, LIMITES.textoLargo),

    // Detalle
    nombreActividad: texto(entrada.nombreActividad, 300),
    tipoActividad: idCatalogo(entrada.tipoActividad),
    componentesTransversales: idCatalogo(entrada.componentesTransversales),
    descripcionActividad: texto(entrada.descripcionActividad, LIMITES.textoLargo),
    medioVerificacion: texto(entrada.medioVerificacion, LIMITES.textoLargo),

    cronograma,
    sinPresupuesto,
    presupuesto,
    totales,

    creadaEn: entrada.creadaEn || ahora,
    // Se conserva la marca de tiempo de origen: es la que decide qué versión
    // gana al fusionar cambios entre el navegador y la nube.
    actualizadaEn: entrada.actualizadaEn || ahora
  };
}

/**
 * Valida una actividad ya normalizada según las reglas del plan.
 * @returns {{valido: boolean, errores: Object<string,string>}}
 */
export function validarActividad(actividad, plan) {
  const errores = {};
  const requerido = (campo, mensaje) => {
    if (!actividad[campo]) errores[campo] = mensaje;
  };

  requerido('nombreActividad', 'Indica el nombre de la actividad.');
  requerido('departamento', 'Selecciona el departamento o unidad responsable.');

  if (actividad.correoInstitucional && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(actividad.correoInstitucional)) {
    errores.correoInstitucional = 'El correo no tiene un formato válido.';
  }

  for (const campo of plan?.camposObligatorios ?? []) {
    if (!actividad[campo]) {
      errores[campo] = plan.etiquetasError?.[campo] || 'Este campo es obligatorio.';
    }
  }

  if (actividad.totales.cronograma <= 0) {
    errores.cronograma = 'Registra al menos un mes de ejecución en el cronograma.';
  }

  if (!actividad.sinPresupuesto && actividad.totales.presupuesto <= 0) {
    errores.presupuesto = 'Ingresa el presupuesto o marca "Esta actividad no requiere presupuesto".';
  }

  for (const st of SUBTITULOS) {
    const p = actividad.presupuesto[st];
    const total = actividad.totales[`presupuesto${st}`];
    if (total > 0 && !p.programatico) {
      errores[`programatico${st}`] = `Selecciona la categoría programática del subtítulo ${st}.`;
    }
    if (total > 0 && !p.programa) {
      errores[`programa${st}`] = `Selecciona el programa del subtítulo ${st}.`;
    }
  }

  return { valido: Object.keys(errores).length === 0, errores };
}

/** Aplana una actividad a un objeto de una sola capa (para exportar). */
export function aplanar(actividad) {
  const fila = { ...actividad };
  delete fila.cronograma;
  delete fila.presupuesto;
  delete fila.totales;
  for (const m of IDS_MESES) fila[m] = actividad.cronograma[m];
  fila.totalAnual = actividad.totales.cronograma;
  for (const st of SUBTITULOS) {
    fila[`programatico${st}`] = actividad.presupuesto[st].programatico;
    fila[`programa${st}`] = actividad.presupuesto[st].programa;
    for (const m of IDS_MESES) fila[`presupuesto_${st}_${m}`] = actividad.presupuesto[st].meses[m];
    fila[`totalPresupuesto${st}`] = actividad.totales[`presupuesto${st}`];
  }
  fila.totalPresupuesto = actividad.totales.presupuesto;
  return fila;
}
