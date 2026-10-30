/**
 * Adaptador opcional de sincronización con Supabase.
 *
 * Se activa solo si `CONFIG.nube.habilitada` es true. Mientras esté apagado,
 * este archivo nunca se descarga ni se ejecuta: la plataforma funciona igual
 * sin internet ni cuentas.
 *
 * Seguridad: la clave "anon" es pública por diseño. La protección real está en
 * las políticas de Row Level Security definidas en docs/esquema.sql, que se
 * aplican en el servidor y no pueden saltarse desde el navegador.
 */

import { CONFIG } from '../../config.js';
import { periodo } from './periodo.js';
import { normalizarActividad } from './modelo.js';

const CDN = 'https://esm.sh/@supabase/supabase-js@2';

/** Intentos de WebSocket antes de renunciar al tiempo real. */
const MAX_REINTENTOS_TIEMPO_REAL = 3;

/**
 * Mensaje para cuando el servidor no rechaza la operación pero tampoco la
 * aplica. Pasa cuando el perfil activo no tiene permiso de escritura, o cuando
 * la actividad pertenece a otra persona.
 */
const SIN_PERMISO =
  'El servidor no aceptó el cambio: tu perfil actual no tiene permiso para modificar esta actividad. ' +
  'Si cambiaste de perfil en otra pestaña, vuelve a cargar la página.';

let cliente = null;

/**
 * Deja la URL del proyecto en la forma que espera la librería: solo el origen.
 *
 * Es un error frecuente copiar desde el panel de Supabase la URL de la API REST
 * (`https://xxx.supabase.co/rest/v1/`) en lugar de la del proyecto. La librería
 * agrega ella misma `/auth/v1`, `/rest/v1`, etc., así que cualquier ruta o barra
 * final produce peticiones a rutas dobles y el servidor responde
 * «Invalid path specified in request URL».
 */
export function normalizarUrlProyecto(url) {
  const crudo = String(url || '').trim();
  if (!crudo) return '';
  try {
    return new URL(crudo).origin;
  } catch {
    // Sin protocolo: se asume https y se descarta cualquier ruta.
    return `https://${crudo.replace(/^\/+/, '').split('/')[0]}`;
  }
}

/** Crea (una sola vez) el cliente de Supabase. */
async function obtenerCliente() {
  if (cliente) return cliente;
  const url = normalizarUrlProyecto(CONFIG.nube.url);
  if (!url) throw new Error('Falta la URL del proyecto de Supabase en config.js');
  if (url !== CONFIG.nube.url) {
    console.warn(
      `La URL de Supabase en config.js incluye una ruta o barra final. ` +
      `Se usará "${url}". Corrígela en config.js para evitar confusiones.`
    );
  }
  const { createClient } = await import(/* @vite-ignore */ CDN);
  cliente = createClient(url, CONFIG.nube.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    realtime: {
      // Espaciado creciente entre reintentos: sin esto, un WebSocket bloqueado
      // se reintenta cada pocos milisegundos.
      reconnectAfterMs: (intento) => [1000, 3000, 8000][intento - 1] ?? 15000
    }
  });
  return cliente;
}

/** Convierte una fila de la base de datos a una actividad del modelo. */
const desdeFila = (fila) => normalizarActividad({
  ...fila.datos,
  id: fila.id,
  plan: fila.plan,
  creadaEn: fila.creada_en,
  actualizadaEn: fila.actualizada_en
});

/** Convierte una actividad del modelo a una fila de la base de datos. */
const aFila = (a, usuarioId) => ({
  id: a.id,
  plan: a.plan,
  departamento: a.departamento || null,
  anio: periodo.anio,
  propietario: usuarioId,
  datos: a,
  creada_en: a.creadaEn,
  actualizada_en: a.actualizadaEn
});

/**
 * Convierte los errores de Supabase Auth en mensajes para quien está entrando.
 *
 * Se reconocen por el código o por palabras clave, no por el texto exacto,
 * que cambia entre versiones de la API. Lo que no se reconoce se devuelve tal
 * cual: mejor un mensaje en inglés que esconder un problema nuevo.
 */
function traducirErrorDeAcceso(error) {
  const texto = `${error?.code || ''} ${error?.message || ''}`;
  const esperar = texto.match(/after (\d+) seconds?/i);

  // El trigger de la base aborta el alta de quien no está en la nómina, y
  // Supabase lo informa como un fallo genérico al registrar.
  if (/database error|saving new user|no est[áa] autorizado|unexpected_failure|insufficient/i.test(texto)) {
    return new Error(
      'Ese correo no está autorizado para acceder a la plataforma. Solo pueden ingresar las ' +
      'personas registradas en la nómina de planificación: si debes registrar actividades, ' +
      'pide al Departamento de Control de Gestión que te incorpore.'
    );
  }
  // Límite por persona: un código cada 60 segundos.
  if (esperar || /over_request_rate_limit|for security purposes/i.test(texto)) {
    const s = esperar ? Number(esperar[1]) : 60;
    const e = new Error(`Por seguridad, espera ${s} segundos antes de pedir otro código.`);
    e.esperar = s;
    return e;
  }
  // Límite de envíos de todo el proyecto por hora.
  if (/over_email_send_rate_limit|email rate limit/i.test(texto)) {
    return new Error(
      'La plataforma alcanzó el máximo de correos que puede enviar por hora. Espera unos minutos e ' +
      'inténtalo de nuevo; si persiste, avisa al Departamento de Control de Gestión.'
    );
  }
  // Servicio de correo de prueba de Supabase: solo envía al equipo del proyecto.
  if (/email_address_not_authorized|address not authorized/i.test(texto)) {
    return new Error(
      'El servicio de correo de la plataforma todavía no está habilitado para tu dirección. ' +
      'Avisa al Departamento de Control de Gestión.'
    );
  }
  // Código equivocado, vencido o reemplazado por uno más nuevo.
  if (/otp_expired|token has expired|invalid|expired/i.test(texto)) {
    return new Error(
      'El código no es válido o ya venció. Revisa que sea el del último correo que te llegó, ' +
      'o pide uno nuevo.'
    );
  }
  if (/failed to fetch|network/i.test(texto)) {
    return new Error('No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.');
  }
  return new Error(error?.message || 'No se pudo completar el ingreso.');
}

export const nube = {
  /** ¿Está configurada la sincronización? */
  get configurada() {
    return Boolean(CONFIG.nube.habilitada && CONFIG.nube.url && CONFIG.nube.anonKey);
  },

  async sesion() {
    const sb = await obtenerCliente();
    const { data } = await sb.auth.getSession();
    return data.session;
  },

  /**
   * Envía un CÓDIGO de acceso de un solo uso al correo (sin contraseñas).
   *
   * Hasta la versión 3.10 se enviaba un enlace. Se cambió a código por dos
   * problemas reales observados en los registros de Supabase:
   *   - Los filtros de seguridad del correo institucional (Microsoft 365)
   *     abren los enlaces para revisarlos antes de entregarlos, y como cada
   *     enlace sirve una sola vez, llegaba ya gastado: «Email link is invalid
   *     or has expired».
   *   - El enlace tenía que abrirse en el mismo navegador donde se pidió.
   * Un código no lo puede «usar» ningún filtro y se escribe donde uno está.
   *
   * Qué llega en el correo —enlace o código— lo decide la PLANTILLA del correo
   * en Supabase (Authentication → Email Templates), no este archivo: ver
   * docs/GUIA-CORREO-CODIGO.md.
   *
   * Quién puede registrarse lo decide el SERVIDOR: un trigger de la base
   * (`privado.exigir_correo_autorizado`) solo deja crear la cuenta a quien está
   * en la nómina. Por eso la solicitud se envía siempre y aquí solo se traduce
   * el rechazo a un mensaje que se entienda.
   */
  async enviarCodigo(correo) {
    const limpio = String(correo || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(limpio)) {
      throw new Error('Escribe un correo electrónico válido.');
    }

    const sb = await obtenerCliente();
    const { error } = await sb.auth.signInWithOtp({
      email: limpio,
      // Se mantiene por compatibilidad con plantillas que todavía traigan enlace.
      options: { emailRedirectTo: location.origin + location.pathname }
    });
    if (!error) return;
    throw traducirErrorDeAcceso(error);
  },

  /** Nombre anterior, por si algún módulo antiguo lo sigue llamando. */
  async enviarEnlace(correo) {
    return this.enviarCodigo(correo);
  },

  /**
   * Comprueba el código recibido y abre la sesión.
   * `type: 'email'` sirve tanto para quien entra por primera vez como para
   * quien ya tenía cuenta.
   */
  async verificarCodigo(correo, codigo) {
    const limpio = String(codigo || '').replace(/\D/g, '');
    if (limpio.length < 6) throw new Error('Escribe el código completo que te llegó por correo.');

    const sb = await obtenerCliente();
    const { data, error } = await sb.auth.verifyOtp({
      email: String(correo || '').trim(),
      token: limpio,
      type: 'email'
    });
    if (error) throw traducirErrorDeAcceso(error);
    if (!data?.session) throw new Error('No se pudo abrir la sesión. Pide un código nuevo e inténtalo otra vez.');
    return data.session;
  },

  async cerrarSesion() {
    const sb = await obtenerCliente();
    await sb.auth.signOut();
  },

  /**
   * Perfil institucional de la persona conectada.
   * Row Level Security garantiza que solo pueda leer el suyo (salvo Control de
   * Gestión). Devuelve null si todavía no existe.
   */
  async perfil() {
    const sb = await obtenerCliente();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return null;
    const { data, error } = await sb
      .from('perfiles')
      .select('correo, nombre, departamento, roles, rol_activo')
      .eq('id', user.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  },

  /**
   * Cambia el perfil activo de la cuenta.
   *
   * Devuelve lo que quedó guardado, no lo que se pidió. El servidor acepta el
   * cambio solo hacia un perfil de la lista asignada y, si no, deja el anterior
   * sin lanzar error: leer la respuesta es la única forma de saber qué pasó de
   * verdad.
   */
  async cambiarPerfil(rol) {
    const sb = await obtenerCliente();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) throw new Error('Sesión no iniciada.');
    const { data, error } = await sb
      .from('perfiles')
      .update({ rol_activo: rol })
      .eq('id', user.id)
      .select('correo, nombre, departamento, roles, rol_activo')
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  },

  /** Guarda el departamento elegido por quien no venía en la nómina. */
  async actualizarDepartamento(departamento) {
    const sb = await obtenerCliente();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) throw new Error('Sesión no iniciada.');
    const { error } = await sb
      .from('perfiles')
      .update({ departamento })
      .eq('id', user.id);
    if (error) throw new Error(error.message);
  },

  /**
   * Reserva el siguiente código correlativo del departamento.
   * El departamento no se envía: lo determina el servidor a partir del perfil,
   * para que nadie pueda consumir la numeración de otra unidad.
   */
  async reservarCodigo(plan, anio) {
    const sb = await obtenerCliente();
    const { data, error } = await sb.rpc('reservar_codigo', { p_plan: plan, p_anio: anio });
    if (error) throw new Error(error.message);
    return Number(data);
  },

  /**
   * Lista las actividades visibles para el usuario.
   * Row Level Security decide qué devuelve: un equipo ve lo suyo,
   * Control de Gestión ve todo.
   */
  async listar() {
    const sb = await obtenerCliente();
    const { data, error } = await sb
      .from('actividades')
      .select('id, plan, datos, creada_en, actualizada_en')
      .eq('anio', periodo.anio);
    if (error) throw new Error(error.message);
    return (data || []).map(desdeFila);
  },

  /**
   * Guarda una actividad.
   *
   * Se pide de vuelta la fila escrita a propósito. Row Level Security no lanza
   * error cuando una actualización no alcanza ninguna fila: simplemente no
   * modifica nada. Sin esta comprobación, alguien en modo Observador —o con una
   * pestaña abierta desde antes de cambiar de perfil— vería «guardada» sobre
   * una escritura que nunca ocurrió.
   */
  async guardar(actividad) {
    const sb = await obtenerCliente();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) throw new Error('Sesión no iniciada.');
    const { data, error } = await sb
      .from('actividades')
      .upsert(aFila(actividad, user.id), { onConflict: 'id' })
      .select('id');
    if (error) throw new Error(error.message);
    if (!data || !data.length) throw new Error(SIN_PERMISO);
  },

  async eliminar({ id }) {
    const sb = await obtenerCliente();
    const { data, error } = await sb.from('actividades').delete().eq('id', id).select('id');
    if (error) throw new Error(error.message);
    if (!data || !data.length) throw new Error(SIN_PERMISO);
  },

  /**
   * Notifica los cambios que hagan otros equipos, en tiempo real.
   *
   * Es una comodidad, no un requisito: si el WebSocket no puede establecerse
   * (política de seguridad, antivirus, red institucional que bloquea wss),
   * la plataforma sigue funcionando y sincroniza al recargar. Por eso se
   * abandona tras unos intentos en vez de reintentar sin fin: de otro modo la
   * librería reconecta indefinidamente y llena la consola de errores.
   */
  async escuchar(alCambiar) {
    const sb = await obtenerCliente();
    let fallos = 0;

    const canal = sb.channel('actividades')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'actividades' }, alCambiar)
      .subscribe((estado) => {
        if (estado === 'SUBSCRIBED') { fallos = 0; return; }
        if (estado !== 'CHANNEL_ERROR' && estado !== 'TIMED_OUT') return;

        fallos += 1;
        if (fallos < MAX_REINTENTOS_TIEMPO_REAL) return;

        sb.removeChannel(canal);
        console.info(
          'Sincronización en tiempo real no disponible; se desactivó tras ' +
          `${fallos} intentos. Las actividades se siguen guardando y se ` +
          'actualizan al recargar la página.'
        );
      });

    return canal;
  }
};
