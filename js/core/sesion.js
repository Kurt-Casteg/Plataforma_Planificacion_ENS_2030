/**
 * Gestión de sesión cuando la sincronización en la nube está activa.
 * Si está desactivada, este módulo no se carga.
 *
 * El indicador de la cabecera es el único punto de entrada: según el estado,
 * abre el ingreso por correo o el panel con los datos de la sesión y el botón
 * de cerrar sesión.
 */

import { el } from './dom.js';
import { abrirModal, avisar, confirmar, mostrarCargando } from './ui.js';
import { almacen } from './almacen.js';
import { perfil } from './perfil.js';
import { etiquetaDe } from './catalogos.js';

const NOMBRE_ROL = {
  equipo: 'Equipo · ve y edita sus propias actividades',
  jefatura: 'Jefatura · ve además todas las de su departamento',
  control_gestion: 'Control de Gestión · ve y consolida todo'
};

export async function iniciarSesionEnLaNube({ indicador, catalogos }) {
  const { nube } = await import('./nube.js');
  if (!nube.configurada) return null;

  const marcar = (estado, texto, titulo) => {
    if (!indicador) return;
    indicador.dataset.estado = estado;
    indicador.textContent = texto;
    indicador.title = titulo;
    indicador.disabled = false;
  };

  // Un solo manejador de clic para todo el ciclo de vida del indicador: lo que
  // abre depende de si hay sesión en ese momento.
  if (indicador && !indicador.__conectado) {
    indicador.__conectado = true;
    indicador.addEventListener('click', () => {
      if (perfil.identificado) panelDeSesion(nube, catalogos);
      else pedirAcceso(nube);
    });
  }

  let sesion;
  try {
    sesion = await nube.sesion();
  } catch (e) {
    console.error(e);
    marcar('error', 'Sin conexión', 'No se pudo contactar el repositorio institucional. Tus datos siguen guardados en este equipo.');
    return null;
  }

  if (!sesion) {
    marcar('local', 'Iniciar sesión', 'Inicia sesión para consolidar tus actividades con el resto de los equipos.');
    return null;
  }

  // El perfil se carga antes que las actividades: el formulario lo necesita
  // para completar identificación y para pedir el correlativo al servidor.
  const datos = await perfil.cargar(nube, sesion);

  marcar('nube', datos.nombre || sesion.user.email, 'Ver tu sesión o cerrarla');

  await almacen.conectarNube(nube);

  nube.escuchar(() => almacen.conectarNube(nube)).catch(() => { /* tiempo real es opcional */ });

  almacen.addEventListener('sincronizacion:error', () => {
    marcar('error', 'Sincronización pendiente', 'Algunos cambios no se enviaron. Se reintentará automáticamente.');
  });

  return { sesion, nube, perfil: perfil.datos };
}

/* ------------------------------------------------------------------ */
/* Ingreso                                                             */
/* ------------------------------------------------------------------ */

function pedirAcceso(nube) {
  const entrada = el('input', {
    class: 'campo__control', id: 'correoAcceso',
    attrs: { type: 'email', placeholder: 'nombre@redsalud.gob.cl', autocomplete: 'email', required: true }
  });

  const modal = abrirModal({
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

  // Enter envía, sin obligar a bajar hasta el botón.
  entrada.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      modal.ventana.querySelector('.modal__pie .btn--primario')?.click();
    }
  });
  entrada.focus();
}

/* ------------------------------------------------------------------ */
/* Panel de sesión                                                     */
/* ------------------------------------------------------------------ */

function panelDeSesion(nube, catalogos) {
  const dato = (etiqueta, valor) => valor
    ? el('div', { class: 'detalle__dato' }, [
        el('dt', { text: etiqueta }),
        el('dd', { text: String(valor) })
      ])
    : null;

  const departamento = catalogos
    ? (etiquetaDe(catalogos.departamentos, perfil.departamento) || perfil.departamento)
    : perfil.departamento;

  abrirModal({
    titulo: 'Tu sesión',
    ancho: '520px',
    contenido: [
      el('dl', { class: 'detalle__grilla' }, [
        dato('Nombre', perfil.nombre),
        dato('Correo', perfil.correo),
        dato('Departamento', departamento || 'Sin asignar'),
        dato('Perfil', NOMBRE_ROL[perfil.rol] || perfil.rol)
      ].filter(Boolean)),

      el('div', { class: 'nota nota--info', style: { marginTop: '20px' } }, [
        el('p', {}, [
          'Con estos datos la plataforma completa la sección ',
          el('strong', { text: 'Identificación' }),
          '. Si algo está mal, avisa al Departamento de Control de Gestión: se corrige en la nómina institucional.'
        ])
      ])
    ],
    acciones: [
      { texto: 'Cerrar', clase: 'btn--secundario', alHacerClic: (m) => m.cerrar() },
      {
        texto: 'Cerrar sesión', clase: 'btn--peligro',
        alHacerClic: async (m) => { m.cerrar(); await cerrarSesion(nube); }
      }
    ]
  });
}

/**
 * Cierra la sesión y recarga la página.
 *
 * Se recarga a propósito, en vez de ir desmontando el estado a mano: es la
 * única forma de garantizar que no quede nada de la sesión anterior en memoria.
 */
async function cerrarSesion(nube) {
  const ok = await confirmar({
    titulo: 'Cerrar sesión',
    mensaje: 'Se cerrará tu sesión en este navegador. Las actividades ya sincronizadas quedan guardadas y volverás a verlas al entrar de nuevo.',
    textoConfirmar: 'Cerrar sesión',
    peligro: true
  });
  if (!ok) return;

  mostrarCargando('Cerrando sesión…');
  try {
    await nube.cerrarSesion();
  } catch (e) {
    console.warn('No se pudo cerrar la sesión en el servidor:', e);
  }
  perfil.limpiar();

  // Se descarta la identidad; la copia local de las actividades se conserva.
  location.reload();
}
