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
import { normalizarActividad } from './modelo.js';

const CDN = 'https://esm.sh/@supabase/supabase-js@2';

/** Intentos de WebSocket antes de renunciar al tiempo real. */
const MAX_REINTENTOS_TIEMPO_REAL = 3;

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
  anio: CONFIG.anio,
  propietario: usuarioId,
  datos: a,
  creada_en: a.creadaEn,
  actualizada_en: a.actualizadaEn
});

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

  /** Envía un enlace de acceso al correo institucional (sin contraseñas). */
  async enviarEnlace(correo) {
    const dominios = CONFIG.nube.dominiosPermitidos || [];
    const dominio = String(correo).split('@')[1]?.toLowerCase();
    if (dominios.length && !dominios.includes(dominio)) {
      throw new Error(`Solo se permiten correos de: ${dominios.join(', ')}`);
    }
    const sb = await obtenerCliente();
    const { error } = await sb.auth.signInWithOtp({
      email: correo,
      options: { emailRedirectTo: location.origin + location.pathname }
    });
    if (error) throw new Error(error.message);
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
      .select('correo, nombre, departamento, rol')
      .eq('id', user.id)
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
      .eq('anio', CONFIG.anio);
    if (error) throw new Error(error.message);
    return (data || []).map(desdeFila);
  },

  async guardar(actividad) {
    const sb = await obtenerCliente();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) throw new Error('Sesión no iniciada.');
    const { error } = await sb.from('actividades').upsert(aFila(actividad, user.id), { onConflict: 'id' });
    if (error) throw new Error(error.message);
  },

  async eliminar({ id }) {
    const sb = await obtenerCliente();
    const { error } = await sb.from('actividades').delete().eq('id', id);
    if (error) throw new Error(error.message);
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
