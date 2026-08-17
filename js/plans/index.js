/**
 * Definición declarativa de los planes.
 *
 * Cada plan describe QUÉ campos tiene; el núcleo se encarga de CÓMO se dibujan,
 * validan, guardan, grafican y exportan. Agregar un tercer plan (por ejemplo,
 * "Metas Sanitarias") es agregar un objeto a esta lista: cero código nuevo.
 *
 * Tipos de campo disponibles:
 *   texto | correo | textoLargo | select | cadenaENS | cronograma | presupuesto
 */

const SECCION_IDENTIFICACION = {
  titulo: 'Identificación',
  descripcion: 'Datos básicos para identificar la actividad y a su equipo responsable.',
  campos: [
    {
      id: 'codigoActividad', tipo: 'texto', etiqueta: 'Código de actividad',
      ayuda: 'Número correlativo para ordenar tus actividades (1, 2, 3…).',
      placeholder: 'Ej: 01', ancho: 'chico', inputMode: 'numeric'
    },
    { id: 'departamento', tipo: 'select', etiqueta: 'Departamento o unidad', catalogo: 'departamentos', requerido: true },
    { id: 'responsable', tipo: 'texto', etiqueta: 'Responsable', placeholder: 'Nombre de quien coordina la actividad' },
    { id: 'correoInstitucional', tipo: 'correo', etiqueta: 'Correo institucional', placeholder: 'nombre@redsalud.gob.cl' }
  ]
};

const SECCION_DETALLE = {
  titulo: 'Descripción de la actividad',
  descripcion: 'Detalla qué harás, con qué enfoque y cómo lo comprobarás.',
  campos: [
    {
      id: 'nombreActividad', tipo: 'texto', etiqueta: 'Nombre de la actividad', requerido: true,
      placeholder: 'Nombre descriptivo y específico', ancho: 'completo'
    },
    { id: 'tipoActividad', tipo: 'select', etiqueta: 'Tipo de actividad', catalogo: 'tiposActividad' },
    { id: 'componentesTransversales', tipo: 'select', etiqueta: 'Componente transversal', catalogo: 'componentesTransversales' },
    {
      id: 'descripcionActividad', tipo: 'textoLargo', etiqueta: 'Descripción detallada', ancho: 'completo',
      placeholder: 'Describe el alcance, la población objetivo y la metodología de la actividad…', filas: 4
    },
    {
      id: 'medioVerificacion', tipo: 'textoLargo', etiqueta: 'Medio de verificación', ancho: 'completo', filas: 2,
      placeholder: 'Ej: Informe trimestral, acta de reunión, planilla de asistencia…',
      ayudaExtendida: 'mediosVerificacion'
    }
  ]
};

const SECCION_CRONOGRAMA = {
  titulo: 'Cronograma de ejecución',
  descripcion: 'Indica cuántas veces realizarás la actividad en cada mes. El total anual se calcula solo.',
  campos: [{ id: 'cronograma', tipo: 'cronograma', etiqueta: 'Ejecución mensual' }]
};

const SECCION_PRESUPUESTO = {
  titulo: 'Presupuesto',
  descripcion: 'Distribuye los recursos estimados por mes y subtítulo, o indica que no requiere presupuesto.',
  campos: [{ id: 'presupuesto', tipo: 'presupuesto', etiqueta: 'Presupuesto anual' }]
};

export const PLANES = [
  {
    id: 'pns',
    nombre: 'Plan Nacional de Salud',
    nombreCorto: 'PNS',
    icono: '◈',
    descripcion: 'Planificación alineada a la cadena de resultados de la Estrategia Nacional de Salud 2021-2030.',
    enlace: { texto: 'Lineamientos Temáticos ENS 2026', url: 'enlaces.lineamientos' },
    camposObligatorios: ['resultadoInmediato'],
    etiquetasError: {
      resultadoInmediato: 'Selecciona el Resultado Inmediato al que aporta la actividad.'
    },
    secciones: [
      SECCION_IDENTIFICACION,
      {
        titulo: 'Cadena de resultados ENS',
        descripcion: 'Avanza paso a paso desde el Objetivo Estratégico hasta el Resultado Inmediato. Cada selección filtra la siguiente.',
        campos: [{ id: 'cadenaENS', tipo: 'cadenaENS', etiqueta: 'Cadena de resultados' }]
      },
      SECCION_DETALLE,
      SECCION_CRONOGRAMA,
      SECCION_PRESUPUESTO
    ],
    /** Agrupaciones que alimentan el panel de análisis. */
    dimensiones: [
      { id: 'objetivoEstrategico', etiqueta: 'Objetivo estratégico' },
      { id: 'tema', etiqueta: 'Tema' },
      { id: 'departamento', etiqueta: 'Departamento', catalogo: 'departamentos' },
      { id: 'tipoActividad', etiqueta: 'Tipo de actividad', catalogo: 'tiposActividad' }
    ]
  },
  {
    id: 'pgi',
    nombre: 'Plan de Gestión Institucional',
    nombreCorto: 'PGI',
    icono: '◆',
    descripcion: 'Planificación de objetivos y productos institucionales definidos por cada departamento.',
    camposObligatorios: ['objetivoEstrategicoTexto', 'objetivoOperacional'],
    etiquetasError: {
      objetivoEstrategicoTexto: 'Describe el objetivo estratégico institucional.',
      objetivoOperacional: 'Describe el objetivo operacional.'
    },
    secciones: [
      SECCION_IDENTIFICACION,
      {
        titulo: 'Objetivos y producto',
        descripcion: 'Describe la línea institucional a la que responde la actividad.',
        campos: [
          {
            id: 'objetivoEstrategicoTexto', tipo: 'textoLargo', etiqueta: 'Objetivo estratégico',
            ancho: 'completo', filas: 2, requerido: true,
            placeholder: 'Objetivo estratégico institucional al que aporta la actividad'
          },
          {
            id: 'objetivoOperacional', tipo: 'textoLargo', etiqueta: 'Objetivo operacional',
            ancho: 'completo', filas: 2, requerido: true,
            placeholder: 'Objetivo operacional concreto y medible'
          },
          {
            id: 'producto', tipo: 'textoLargo', etiqueta: 'Producto', ancho: 'completo', filas: 2,
            placeholder: 'Producto o resultado tangible que genera la actividad'
          }
        ]
      },
      SECCION_DETALLE,
      SECCION_CRONOGRAMA,
      SECCION_PRESUPUESTO
    ],
    dimensiones: [
      { id: 'departamento', etiqueta: 'Departamento', catalogo: 'departamentos' },
      { id: 'tipoActividad', etiqueta: 'Tipo de actividad', catalogo: 'tiposActividad' },
      { id: 'componentesTransversales', etiqueta: 'Componente transversal', catalogo: 'componentesTransversales' }
    ]
  }
];

export const planPorId = (id) => PLANES.find((p) => p.id === id) || PLANES[0];

/** Todos los campos de un plan, en una sola lista plana. */
export const camposDe = (plan) => plan.secciones.flatMap((s) => s.campos);
