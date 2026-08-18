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
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
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

  /** Notifica los cambios que hagan otros equipos, en tiempo real. */
  async escuchar(alCambiar) {
    const sb = await obtenerCliente();
    return sb.channel('actividades')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'actividades' }, alCambiar)
      .subscribe();
  }
};
