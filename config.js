/**
 * Configuración de la plataforma.
 * Este es el ÚNICO archivo que se edita para cambiar el comportamiento del despliegue.
 * No contiene lógica: solo valores. Puede editarse sin conocimientos de programación.
 */
export const CONFIG = {
  /** Nombre de la institución que aparece en encabezado y exportaciones. */
  institucion: 'SEREMI de Salud de Ñuble',

  /** Año del ciclo de planificación en curso. */
  anio: 2027,

  /**
   * Otros períodos que Control de Gestión puede abrir con el selector
   * «Período» de la cabecera, además del vigente (`anio`). Sirve para revisar
   * un ciclo anterior o para hacer pruebas sin mezclarlas con el vigente.
   *
   * Los equipos no ven el selector: trabajan siempre en `anio`.
   * Para quitar el selector, deja la lista vacía: `otrosPeriodos: []`.
   */
  otrosPeriodos: [2026],

  /**
   * Versión de la plataforma. Aparece en el pie de página y sirve para
   * comprobar de un vistazo si el navegador está mostrando la última versión
   * publicada o una copia guardada en caché. Súbela con cada despliegue.
   */
  version: '3.19.0',

  /**
   * Cómo se ve el formulario de registro:
   *  - 'lateral': las secciones como tarjetas que se cambian hacia los lados,
   *    con una barra de etapas arriba que marca dónde estás y una última
   *    tarjeta «Revisar y guardar» (versión 3.17). La página no sube ni baja.
   *  - 'clasico': todas las secciones abiertas, una bajo otra, con el índice
   *    lateral (versión 3.15).
   * Es solo la apariencia: las actividades se guardan igual en ambos.
   */
  formulario: 'clasico',

  /**
   * Sincronización con la nube (Supabase).
   * Con `habilitada: false` la plataforma funciona 100 % en el navegador,
   * sin cuentas ni internet. Al activarla, cada equipo inicia sesión con su
   * correo institucional y sus actividades se consolidan automáticamente.
   *
   * Cómo activarla: ver docs/GUIA-SUPABASE.md
   */
  nube: {
    habilitada: true,
    url: 'https://slaizgcqzagzxunrkumy.supabase.co',        // Solo el dominio del proyecto, SIN /rest/v1 ni barra final
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNsYWl6Z2NxemFnenh1bnJrdW15Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcwMzg0MzQsImV4cCI6MjEwMjYxNDQzNH0.YaGeBsnO7Kk42cAKBwJET0yO_nkto-_RlNTLqM7I4Gk',    // Clave pública "anon" del proyecto (no es secreta)
    /**
     * Dominios institucionales que se muestran como ayuda en la pantalla de
     * ingreso («Usa tu correo @redsalud.gob.cl o @minsal.cl»).
     *
     * OJO: esto es TEXTO, no la restricción. Quién puede registrarse lo decide
     * la base de datos —hoy, solo la nómina `usuarios_autorizados` en
     * Supabase—, porque cualquier control escrito en
     * este archivo viaja al navegador y se puede saltar desde la consola.
     * Para autorizar un correo externo, ver docs/GUIA-ADMINISTRACION.md.
     */
    dominiosPermitidos: ['redsalud.gob.cl', 'minsal.cl']
  },

  /**
   * Créditos que aparecen en el pie de página, bajo «Desarrollo».
   * Una línea por elemento, de lo más específico a lo más general. El nombre
   * de la institución se agrega solo al final: no hace falta repetirlo aquí.
   */
  desarrollo: [
    'Unidad de Gestión de Datos y Control Interno',
    'Departamento de Control de Gestión y Calidad Institucional'
  ],

  /**
   * Autoría. El nombre aparece en el pie de página («Diseño y desarrollo») y en
   * Ayuda → «Acerca de la plataforma». La plataforma es de la institución
   * (`institucion`); esto reconoce a quien la diseñó y desarrolló.
   * `desde` es el año en que se creó: el rango de años del aviso de derechos
   * se completa solo.
   */
  autoria: {
    autor: 'Kurt Castro Ortega',
    desde: 2026
  },

  /** Correo del equipo que da soporte a la plataforma. */
  soporte: 'kurt.castro@redsalud.gob.cl',

  /**
   * Enlaces de referencia mostrados en la cabecera de cada plan.
   * «{anio}» se reemplaza por el período con que se está trabajando.
   */
  enlaces: {
    lineamientos: 'https://simpo.minsal.cl/lineamientos_tematicos_publicados/{anio}'
  }
};
