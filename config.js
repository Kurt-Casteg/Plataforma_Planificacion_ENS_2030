/**
 * Configuración de la plataforma.
 * Este es el ÚNICO archivo que se edita para cambiar el comportamiento del despliegue.
 * No contiene lógica: solo valores. Puede editarse sin conocimientos de programación.
 */
export const CONFIG = {
  /** Nombre de la institución que aparece en encabezado y exportaciones. */
  institucion: 'SEREMI de Salud de Ñuble',

  /** Año del ciclo de planificación en curso. */
  anio: 2026,

  /** Versión de la plataforma (se muestra en el pie de página). */
  version: '2.0.0',

  /**
   * Sincronización con la nube (Supabase).
   * Con `habilitada: false` la plataforma funciona 100 % en el navegador,
   * sin cuentas ni internet. Al activarla, cada equipo inicia sesión con su
   * correo institucional y sus actividades se consolidan automáticamente.
   *
   * Cómo activarla: ver docs/GUIA-SUPABASE.md
   */
  nube: {
    habilitada: false,
    url: '',        // Ej: https://xxxxxxxxxxxx.supabase.co
    anonKey: '',    // Clave pública "anon" del proyecto (no es secreta)
    /** Dominios de correo autorizados para registrarse. Vacío = sin restricción. */
    dominiosPermitidos: ['redsalud.gob.cl', 'minsal.cl']
  },

  /** Correo del equipo que da soporte a la plataforma. */
  soporte: 'controldegestion.nuble@redsalud.gob.cl',

  /** Enlaces de referencia mostrados en la cabecera de cada plan. */
  enlaces: {
    lineamientos: 'https://simpo.minsal.cl/lineamientos_tematicos_publicados/2026'
  }
};
