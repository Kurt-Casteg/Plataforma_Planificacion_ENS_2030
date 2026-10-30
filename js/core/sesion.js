/**
 * Gestión de sesión cuando la sincronización en la nube está activa.
 * Si está desactivada, este módulo no se carga.
 *
 * El indicador de la cabecera es el único punto de entrada: según el estado,
 * abre el ingreso por correo o el panel con los datos de la sesión y el botón
 * de cerrar sesión.
 */

import { CONFIG } from '../../config.js';
import { el, render } from './dom.js';
import { abrirModal, avisar, confirmar, mostrarCargando } from './ui.js';
import { almacen } from './almacen.js';
import { perfil } from './perfil.js';
import { periodo } from './periodo.js';
import { etiquetaDe } from './catalogos.js';

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
    // Sin servidor no tiene sentido ofrecer el ingreso: se explica qué pasa
    // con lo que se registre mientras tanto y nada más.
    mostrarAvisoSesion({ nube, sinConexion: true });
    return null;
  }

  if (!sesion) {
    // Estado propio, distinto de «local»: «local» es el modo sin nube, que es
    // deliberado y se ve tranquilo. Esto es otra cosa —la nube existe y la
    // persona no ha entrado— y tiene que verse como una acción pendiente.
    marcar('sin-sesion', 'Iniciar sesión', 'Entra con tu correo institucional para poder guardar tus actividades.');
    mostrarAvisoSesion({ nube });
    if (!ingresoOmitido()) mostrarPantallaIngreso(nube);
    return null;
  }

  ocultarAvisoSesion();

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

/**
 * Entrada al ingreso desde el botón de la cabecera o desde el aviso ámbar.
 * Abre la misma pantalla de ingreso que aparece al llegar: un solo camino,
 * con los mismos dos pasos (correo y código), en vez de dos versiones que
 * habría que mantener iguales.
 */
function pedirAcceso(nube) {
  mostrarPantallaIngreso(nube);
}

/* ------------------------------------------------------------------ */
/* Aviso de «sin sesión» sobre el formulario                           */
/* ------------------------------------------------------------------ */

/**
 * Franja ámbar entre la portada y el formulario.
 *
 * Dice la CONSECUENCIA, no solo el estado: «no has iniciado sesión» se lee y se
 * ignora; «lo que registres no llegará a Control de Gestión» no. Y trae su
 * propio botón, para que la solución esté donde se descubre el problema.
 *
 * El texto es literal a propósito. Hoy lo que se guarda sin sesión NO se sube
 * después al iniciarla: queda en ese navegador. Prometer otra cosa aquí sería
 * peor que no avisar.
 */
function mostrarAvisoSesion({ nube, sinConexion = false }) {
  const caja = document.getElementById('avisoSesion');
  if (!caja) return;

  const contenido = sinConexion
    ? [
      el('p', { class: 'aviso-sesion__titulo', text: 'Sin conexión con el servidor institucional' }),
      el('p', { class: 'aviso-sesion__texto', text: 'Puedes seguir trabajando, pero lo que registres ahora se guardará solo en este navegador y no llegará a Control de Gestión. Vuelve a cargar la página más tarde para iniciar sesión.' })
    ]
    : [
      el('p', { class: 'aviso-sesion__titulo', text: 'No has iniciado sesión' }),
      el('p', { class: 'aviso-sesion__texto', text: 'Lo que registres se guardará solo en este navegador y no se guardará en la plataforma.' }),
      el('div', { class: 'aviso-sesion__acciones' }, [
        el('button', {
          class: 'btn btn--primario', attrs: { type: 'button' },
          text: 'Iniciar sesión con mi correo',
          on: { click: () => pedirAcceso(nube) }
        })
      ])
    ];

  render(caja, el('div', {
    class: `aviso-sesion${sinConexion ? ' aviso-sesion--sin-conexion' : ''}`,
    attrs: { role: 'status' }
  }, [
    el('span', { class: 'aviso-sesion__icono', text: '!', attrs: { 'aria-hidden': 'true' } }),
    el('div', { class: 'aviso-sesion__cuerpo' }, contenido)
  ]));
  caja.hidden = false;
}

function ocultarAvisoSesion() {
  const caja = document.getElementById('avisoSesion');
  if (caja) caja.hidden = true;
}

/* ------------------------------------------------------------------ */
/* Pantalla de ingreso                                                 */
/* ------------------------------------------------------------------ */

/*
 * «Continuar sin sesión» se recuerda solo en esta pestaña (sessionStorage), no
 * para siempre. Quien la cierra hoy no vuelve a verla mientras trabaja, pero
 * mañana, al abrir la plataforma de nuevo, la encuentra otra vez. Si se
 * recordara para siempre, bastaría un clic distraído para perder el recordatorio
 * durante todo el ciclo de planificación.
 */
const CLAVE_OMITIDO = 'seremi.ingresoOmitido';

function ingresoOmitido() {
  try { return sessionStorage.getItem(CLAVE_OMITIDO) === '1'; } catch { return false; }
}
function omitirIngreso() {
  try { sessionStorage.setItem(CLAVE_OMITIDO, '1'); } catch { /* ventana privada */ }
}

/** «Usa tu correo @redsalud.gob.cl o @minsal.cl.», o nada si no hay dominios. */
function textoDominios() {
  const dominios = CONFIG.nube.dominiosPermitidos || [];
  return dominios.length ? `Usa tu correo ${dominios.map((d) => `@${d}`).join(' o ')}.` : '';
}

/**
 * Lo primero que ve quien llega sin sesión: una tarjeta centrada con un solo
 * campo y un solo botón, antes de la plataforma.
 *
 * No es una barrera. «Continuar sin sesión» está siempre ahí, porque la
 * plataforma sigue funcionando sin nube (y porque si Supabase fallara, nadie
 * podría trabajar). Lo que cambia es que continuar sin sesión pasa a ser una
 * decisión y no un descuido.
 */
function mostrarPantallaIngreso(nube) {
  if (document.querySelector('.ingreso')) return;

  const anterior = document.activeElement;
  const idTitulo = 'ingresoTitulo';

  const entrada = el('input', {
    class: 'campo__control ingreso__entrada', id: 'ingresoCorreo',
    attrs: {
      type: 'email', autocomplete: 'email', required: true,
      placeholder: `nombre@${(CONFIG.nube.dominiosPermitidos || [])[0] || 'institucion.cl'}`,
      'aria-describedby': 'ingresoAyuda ingresoError'
    }
  });
  const error = el('p', { class: 'campo__error', id: 'ingresoError', attrs: { hidden: true, role: 'alert' } });
  const botonEnviar = el('button', {
    class: 'btn btn--primario btn--grande ingreso__boton', attrs: { type: 'submit' },
    text: 'Enviarme un código de acceso'
  });

  const formulario = el('form', {
    class: 'ingreso__formulario', attrs: { novalidate: true },
    on: { submit: (e) => { e.preventDefault(); enviar(); } }
  }, [
    el('label', { class: 'campo__etiqueta', text: 'Correo institucional', attrs: { for: 'ingresoCorreo' } }),
    entrada,
    el('p', { class: 'campo__ayuda', id: 'ingresoAyuda', text: `${textoDominios()} Te llegará un código de 6 dígitos: no hay contraseñas que recordar.`.trim() }),
    error,
    botonEnviar
  ]);


  const continuar = el('button', {
    class: 'btn btn--texto ingreso__continuar', attrs: { type: 'button' },
    text: 'Continuar sin sesión →',
    on: { click: () => cerrar() }
  });

  const tarjeta = el('div', { class: 'ingreso__tarjeta' }, [
    el('div', { class: 'ingreso__marca' }, [
      el('img', { class: 'ingreso__logo', src: 'assets/logo-nuble.png', attrs: { alt: '' } }),
      el('div', {}, [
        el('p', { class: 'ingreso__institucion', text: CONFIG.institucion }),
        el('p', { class: 'ingreso__plataforma', text: `Plataforma de Planificación ${periodo.anio}` })
      ])
    ]),
    el('h1', { class: 'ingreso__titulo', id: idTitulo, text: 'Ingresa con tu correo institucional' }),
    el('p', { class: 'ingreso__texto', text: 'Así tus actividades quedan registradas a tu nombre y en la plataforma.' }),
    formulario,
    el('div', { class: 'ingreso__pie' }, [
      continuar,
      el('p', { class: 'ingreso__nota', text: 'Sin sesión puedes usar la plataforma, pero lo que registres quedará solo en este navegador.' })
    ])
  ]);

  const pantalla = el('div', {
    class: 'ingreso',
    attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': idTitulo }
  }, [tarjeta]);

  // --- Paso 2: el código -------------------------------------------------
  let correoEnviado = '';
  let temporizador = null;

  const entradaCodigo = el('input', {
    class: 'campo__control ingreso__codigo', id: 'ingresoCodigo',
    attrs: {
      type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code',
      maxlength: 10, placeholder: '000000', 'aria-describedby': 'ingresoCodigoError'
    },
    on: {
      // Solo dígitos: quien copia el código desde el correo suele arrastrar
      // espacios o guiones.
      input: (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 10); }
    }
  });
  const errorCodigo = el('p', { class: 'campo__error', id: 'ingresoCodigoError', attrs: { hidden: true, role: 'alert' } });
  const botonEntrar = el('button', {
    class: 'btn btn--primario btn--grande ingreso__boton', attrs: { type: 'submit' }, text: 'Entrar'
  });
  const botonReenviar = el('button', {
    class: 'btn btn--texto ingreso__reenviar', attrs: { type: 'button' },
    text: 'Enviarme un código nuevo',
    on: { click: () => reenviar() }
  });
  const destino = el('strong');

  const formularioCodigo = el('form', {
    class: 'ingreso__formulario ingreso__paso-codigo', attrs: { novalidate: true, hidden: true },
    on: { submit: (e) => { e.preventDefault(); verificar(); } }
  }, [
    el('div', { class: 'ingreso__confirmacion', attrs: { role: 'status' } }, [
      el('p', { class: 'ingreso__confirmacion-titulo', text: 'Revisa tu correo' }),
      el('p', {}, ['Te enviamos un código de 6 dígitos a ', destino, '. Escríbelo aquí para entrar.'])
    ]),
    el('label', { class: 'campo__etiqueta', text: 'Código de acceso', attrs: { for: 'ingresoCodigo' } }),
    entradaCodigo,
    el('p', { class: 'campo__ayuda', text: 'El código sirve una sola vez y vence en 1 hora. Si no llega en unos minutos, revisa la carpeta de correo no deseado.' }),
    errorCodigo,
    botonEntrar,
    el('div', { class: 'ingreso__otras-acciones' }, [
      botonReenviar,
      el('button', {
        class: 'btn btn--texto', attrs: { type: 'button' }, text: 'Usar otro correo',
        on: { click: () => volverAlCorreo() }
      })
    ])
  ]);
  formulario.after(formularioCodigo);

  function mostrarError(nodo, campo, mensaje) {
    nodo.textContent = mensaje;
    nodo.hidden = false;
    campo.setAttribute('aria-invalid', 'true');
    campo.focus();
  }
  function limpiarError(nodo, campo) {
    nodo.hidden = true;
    campo.removeAttribute('aria-invalid');
  }

  /**
   * Cuenta regresiva del botón «código nuevo». Supabase admite un código por
   * persona cada 60 segundos: mostrar la espera evita que el botón parezca
   * roto, y que alguien lo pulse diez veces.
   */
  function esperarParaReenviar(segundos = 60) {
    clearInterval(temporizador);
    let restante = segundos;
    const pintar = () => {
      botonReenviar.disabled = restante > 0;
      botonReenviar.textContent = restante > 0
        ? `Podrás pedir un código nuevo en ${restante} s`
        : 'Enviarme un código nuevo';
    };
    pintar();
    temporizador = setInterval(() => {
      restante -= 1;
      pintar();
      if (restante <= 0) clearInterval(temporizador);
    }, 1000);
  }

  // --- Paso 1: el correo -------------------------------------------------
  async function enviar() {
    limpiarError(error, entrada);
    const correo = entrada.value.trim();
    botonEnviar.disabled = true;
    botonEnviar.textContent = 'Enviando…';
    try {
      await nube.enviarCodigo(correo);
      correoEnviado = correo;
      destino.textContent = correo;
      formulario.hidden = true;
      formularioCodigo.hidden = false;
      entradaCodigo.value = '';
      limpiarError(errorCodigo, entradaCodigo);
      esperarParaReenviar(60);
      entradaCodigo.focus();
    } catch (e) {
      mostrarError(error, entrada, e.message);
    } finally {
      botonEnviar.disabled = false;
      botonEnviar.textContent = 'Enviarme un código de acceso';
    }
  }

  async function reenviar() {
    limpiarError(errorCodigo, entradaCodigo);
    botonReenviar.disabled = true;
    try {
      await nube.enviarCodigo(correoEnviado);
      entradaCodigo.value = '';
      esperarParaReenviar(60);
      avisar('Te enviamos un código nuevo. El anterior ya no sirve.', 'exito', { duracion: 6000 });
      entradaCodigo.focus();
    } catch (e) {
      if (e.esperar) esperarParaReenviar(e.esperar);
      else botonReenviar.disabled = false;
      mostrarError(errorCodigo, entradaCodigo, e.message);
    }
  }

  async function verificar() {
    limpiarError(errorCodigo, entradaCodigo);
    botonEntrar.disabled = true;
    botonEntrar.textContent = 'Comprobando…';
    try {
      await nube.verificarCodigo(correoEnviado, entradaCodigo.value);
      botonEntrar.textContent = 'Entrando…';
      // Se recarga, igual que al cerrar sesión: la sesión ya quedó guardada y
      // así perfil, permisos y actividades se cargan desde un estado limpio.
      clearInterval(temporizador);
      location.reload();
    } catch (e) {
      botonEntrar.disabled = false;
      botonEntrar.textContent = 'Entrar';
      mostrarError(errorCodigo, entradaCodigo, e.message);
      entradaCodigo.select();
    }
  }

  function volverAlCorreo() {
    clearInterval(temporizador);
    formularioCodigo.hidden = true;
    formulario.hidden = false;
    entrada.select();
    entrada.focus();
  }

  function alTeclear(e) {
    // Escape equivale a «Continuar sin sesión»: un diálogo que no se cierra con
    // Escape es una trampa para quien navega con teclado.
    if (e.key === 'Escape') { e.preventDefault(); cerrar(); }
  }

  function cerrar() {
    clearInterval(temporizador);
    omitirIngreso();
    document.removeEventListener('keydown', alTeclear, true);
    pantalla.remove();
    document.body.classList.remove('sin-scroll', 'con-ingreso');
    (anterior && document.contains(anterior) ? anterior : document.getElementById('contenidoPrincipal'))?.focus?.();
  }

  document.body.append(pantalla);
  document.body.classList.add('sin-scroll', 'con-ingreso');
  document.addEventListener('keydown', alTeclear, true);
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
        dato('Departamento', departamento || 'Sin asignar')
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
