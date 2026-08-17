/**
 * Gestión de sesión cuando la sincronización en la nube está activa.
 * Si está desactivada, este módulo no se carga.
 */

import { el } from './dom.js';
import { abrirModal, avisar } from './ui.js';
import { almacen } from './almacen.js';

export async function iniciarSesionEnLaNube({ indicador }) {
  const { nube } = await import('./nube.js');
  if (!nube.configurada) return null;

  const marcar = (estado, texto, titulo) => {
    if (!indicador) return;
    indicador.dataset.estado = estado;
    indicador.textContent = texto;
    indicador.title = titulo;
  };

  let sesion;
  try {
    sesion = await nube.sesion();
  } catch (e) {
    console.error(e);
    marcar('error', 'Sin conexión', 'No se pudo contactar el repositorio institucional. Tus datos siguen guardados en este equipo.');
    return null;
  }

  if (!sesion) {
    marcar('local', 'Sin sesión', 'Inicia sesión para consolidar tus actividades con el resto de los equipos.');
    indicador?.addEventListener('click', () => pedirAcceso(nube));
    indicador?.setAttribute('role', 'button');
    indicador?.setAttribute('tabindex', '0');
    return null;
  }

  marcar('nube', sesion.user.email, 'Sesión iniciada. Tus actividades se sincronizan automáticamente.');
  await almacen.conectarNube(nube);

  nube.escuchar(() => almacen.conectarNube(nube)).catch(() => { /* tiempo real es opcional */ });

  almacen.addEventListener('sincronizacion:error', () => {
    marcar('error', 'Sincronización pendiente', 'Algunos cambios no se enviaron. Se reintentará automáticamente.');
  });

  return sesion;
}

function pedirAcceso(nube) {
  const entrada = el('input', {
    class: 'campo__control', id: 'correoAcceso',
    attrs: { type: 'email', placeholder: 'nombre@redsalud.gob.cl', autocomplete: 'email', required: true }
  });

  abrirModal({
    titulo: 'Iniciar sesión',
    ancho: '460px',
    contenido: [
      el('p', { class: 'texto-cuerpo', text: 'Te enviaremos un enlace de acceso a tu correo institucional. No necesitas recordar contraseñas.' }),
      el('div', { class: 'campo', style: { marginTop: '16px' } }, [
        el('label', { class: 'campo__etiqueta', text: 'Correo institucional', attrs: { for: 'correoAcceso' } }),
        entrada
      ])
    ],
    acciones: [
      { texto: 'Cancelar', clase: 'btn--secundario', alHacerClic: (m) => m.cerrar() },
      {
        texto: 'Enviar enlace', clase: 'btn--primario',
        alHacerClic: async (m) => {
          try {
            await nube.enviarEnlace(entrada.value.trim());
            m.cerrar();
            avisar('Revisa tu correo: te enviamos el enlace de acceso.', 'exito', { duracion: 9000 });
          } catch (e) {
            avisar(e.message, 'error', { duracion: 8000 });
          }
        }
      }
    ]
  });
}
