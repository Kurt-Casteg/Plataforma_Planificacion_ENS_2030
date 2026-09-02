/**
 * Punto de entrada de la plataforma.
 *
 * Une las piezas: carga catálogos, arma el formulario del plan activo,
 * mantiene sincronizados el listado y el panel de análisis, y expone las
 * acciones de exportación e importación.
 */

import { CONFIG } from '../config.js';
import { el, render, vaciar, $, alCargar } from './core/dom.js';
import { almacen } from './core/almacen.js';
import { cargarCatalogos, cargarENS, cargarIndicadores, cargarClasificador, indexarENS } from './core/catalogos.js';
import { PLANES, planPorId } from './plans/index.js';
import { Formulario } from './core/formulario.js';
import { TablaActividades } from './core/tabla.js';
import { Panel } from './core/panel.js';
import { avisar, confirmar, abrirModal, aplicarTema, alternarTema, temaActual, mostrarCargando } from './core/ui.js';
import { exportarExcel, exportarCSV, exportarJSON, leerRespaldo } from './core/exportar.js';
import { numero } from './core/formato.js';
import { perfil, nombrePerfil, PERFILES } from './core/perfil.js';
import { siguienteCodigo, previsualizarCodigo } from './core/codigos.js';
import { Asistente, cargarContenidoAsistente } from './core/asistente.js';

const estado = {
  plan: null,
  catalogos: null,
  ens: null,
  ensIndex: null,
  indicadores: {},
  clasificador: { items: [] },
  formulario: null,
  tabla: null,
  panel: null,
  asistente: null
};

/* ------------------------------------------------------------------ */
/* Arranque                                                            */
/* ------------------------------------------------------------------ */

alCargar(async () => {
  aplicarTema(temaActual());
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (temaActual() === 'auto') aplicarTema('auto');
  });

  const cerrarCarga = mostrarCargando('Cargando la plataforma…');
  try {
    estado.catalogos = await cargarCatalogos();
    // El clasificador presupuestario es pequeño y lo usan ambos planes.
    estado.clasificador = await cargarClasificador().catch((e) => {
      console.warn('No se pudo cargar el clasificador presupuestario:', e);
      return { items: [] };
    });
  } catch (e) {
    cerrarCarga();
    render($('#aplicacion'), el('div', { class: 'panel' }, [
      el('div', { class: 'panel__cuerpo' }, [
        el('h2', { class: 'panel__titulo', text: 'No se pudieron cargar los datos de la plataforma' }),
        el('p', { class: 'texto-cuerpo', text: 'Verifica tu conexión y vuelve a cargar la página. Si el problema persiste, avisa al Departamento de Control de Gestión.' })
      ])
    ]));
    console.error(e);
    return;
  }

  const { migradas, soportaAlmacenamiento } = await almacen.iniciar();
  cerrarCarga();

  construirCascaron();
  await activarPlan(planDesdeURL());

  almacen.addEventListener('cambio', () => refrescar());
  addEventListener('hashchange', () => activarPlan(planDesdeURL()));

  montarAsistente();

  // Iniciar sesión, cerrarla o cambiar de perfil altera qué se puede hacer:
  // el selector y los bloqueos se rehacen desde un solo lugar.
  perfil.addEventListener('cambio', () => {
    sincronizarSelectorPerfil();
    aplicarPermisos();
    dibujarAccionesListado();
    estado.asistente?.actualizar();
    // El listado dibuja sus botones según los permisos del momento, y la sesión
    // llega DESPUÉS de la primera pintada: sin esto, alguien que entra como
    // Observador vería «Editar» y «Eliminar» en cada fila hasta recargar.
    estado.tabla?.pintar();
  });
  aplicarPermisos();

  if (CONFIG.nube.habilitada) {
    // La capa de nube solo se descarga si está activada en config.js.
    import('./core/sesion.js')
      .then((m) => m.iniciarSesionEnLaNube({
        indicador: $('#indicadorAlmacen'),
        catalogos: estado.catalogos
      }))
      .then(() => refrescar())
      .catch((e) => console.error('Sincronización no disponible:', e));
  }

  if (migradas > 0) {
    avisar(`Se recuperaron ${numero(migradas)} actividades de la versión anterior.`, 'exito', { duracion: 7000 });
  }
  if (!soportaAlmacenamiento) {
    avisar('El navegador no permite guardar datos (¿ventana privada?). Exporta tu trabajo antes de cerrar.', 'alerta', { duracion: 12000 });
  }
});

const planDesdeURL = () => planPorId(location.hash.replace('#/', '').split('/')[0]);

/* ------------------------------------------------------------------ */
/* Cascarón: cabecera, navegación y pie                                */
/* ------------------------------------------------------------------ */

function construirCascaron() {
  const cabecera = el('header', { class: 'cabecera' }, [
    el('div', { class: 'envoltura' }, [
      el('div', { class: 'cabecera__fila' }, [
        el('div', { class: 'cabecera__marca' }, [
          el('img', {
            class: 'cabecera__logo', src: 'assets/logo-nuble.png',
            attrs: { alt: '', width: 42, height: 42, loading: 'eager' }
          }),
          el('div', { class: 'cabecera__textos' }, [
            el('p', { class: 'cabecera__subtitulo', text: CONFIG.institucion }),
            el('h1', { class: 'cabecera__titulo', text: `Plataforma de Planificación ${CONFIG.anio}` })
          ])
        ]),
        el('div', { class: 'cabecera__herramientas' }, [
          // Selector de perfil activo. Nace oculto: solo aparece si la cuenta
          // tiene más de un perfil asignado, que es la única situación en que
          // hay algo que elegir.
          el('select', {
            class: 'campo__control selector-perfil', id: 'selectorPerfil',
            attrs: { hidden: true, 'aria-label': 'Perfil activo' },
            on: { change: (e) => cambiarPerfilActivo(e.target.value) }
          }),
          // Es un botón real, no un adorno: al pulsarlo se abre el panel de
          // sesión (iniciar sesión, ver quién soy, cerrar sesión).
          el('button', {
            class: 'indicador-almacen', id: 'indicadorAlmacen',
            dataset: { estado: CONFIG.nube.habilitada ? 'nube' : 'local' },
            text: CONFIG.nube.habilitada ? 'Conectando…' : 'Guardado en este equipo',
            attrs: {
              type: 'button',
              disabled: !CONFIG.nube.habilitada,
              title: CONFIG.nube.habilitada
                ? 'Ver tu sesión'
                : 'Las actividades se guardan en este navegador. Exporta un respaldo periódicamente.'
            }
          }),
          el('button', {
            class: 'btn btn--fantasma', id: 'btnTema',
            attrs: { type: 'button', 'aria-label': 'Cambiar entre modo claro y oscuro' },
            text: 'Tema',
            on: { click: () => { alternarTema(); avisar(`Modo ${document.documentElement.dataset.tema}.`, 'info', { duracion: 1600 }); } }
          }),
          el('button', {
            class: 'btn btn--fantasma',
            attrs: { type: 'button' }, text: 'Ayuda',
            on: { click: mostrarAyuda }
          })
        ])
      ]),
      el('nav', { class: 'planes', attrs: { 'aria-label': 'Planes de planificación' }, id: 'navPlanes' })
    ])
  ]);

  const principal = el('main', { class: 'envoltura contenido', id: 'contenidoPrincipal', attrs: { tabindex: '-1' } }, [
    el('div', { id: 'portada' }),
    // Ocupa el lugar del formulario cuando el perfil activo no puede escribir,
    // para que la ausencia se entienda en vez de parecer una falla.
    el('div', {
      class: 'nota nota--info nota--solo-lectura', id: 'avisoSoloLectura',
      attrs: { hidden: true, role: 'status' }
    }, [
      el('p', { class: 'nota__titulo', text: 'Estás en un perfil de solo lectura' }),
      el('p', {}, [
        'Puedes consultar y exportar todo lo registrado, pero no crear ni modificar actividades. ',
        'Si tienes otro perfil asignado, cámbialo en el selector de la cabecera.'
      ])
    ]),
    el('div', { id: 'zonaFormulario' }),
    el('section', { class: 'panel', attrs: { 'aria-labelledby': 'tituloListado' } }, [
      el('div', { class: 'panel__cabecera' }, [
        el('div', {}, [
          el('h2', { class: 'panel__titulo', id: 'tituloListado', text: 'Actividades registradas' }),
          el('p', { class: 'panel__descripcion', text: 'Busca, revisa, edita o elimina lo que ya guardaste.' })
        ]),
        el('div', { class: 'panel__acciones', id: 'accionesListado' })
      ]),
      el('div', { class: 'panel__cuerpo', id: 'zonaTabla' })
    ]),
    el('section', { class: 'panel', attrs: { 'aria-labelledby': 'tituloPanel' } }, [
      el('div', { class: 'panel__cabecera' }, [
        el('div', {}, [
          el('h2', { class: 'panel__titulo', id: 'tituloPanel', text: 'Panel de análisis' }),
          el('p', { class: 'panel__descripcion', text: 'Resumen automático de tu planificación. Se actualiza con cada cambio.' })
        ])
      ]),
      el('div', { class: 'panel__cuerpo', id: 'zonaPanel' })
    ])
  ]);

  const pie = el('footer', { class: 'pie' }, [
    el('div', { class: 'envoltura' }, [
      el('div', { class: 'pie__grilla' }, [
        el('div', {}, [
          el('p', { class: 'pie__titulo', text: `Plataforma de Planificación ${CONFIG.anio}` }),
          el('p', { class: 'pie__texto', text: 'Herramienta institucional para planificar, consolidar y analizar las actividades de los equipos.' })
        ]),
        el('div', {}, [
          el('p', { class: 'pie__titulo', text: 'Desarrollo' }),
          el('p', { class: 'pie__texto', text: 'Departamento de Control de Gestión y Calidad Institucional' }),
          el('p', { class: 'pie__texto', text: CONFIG.institucion })
        ]),
        el('div', {}, [
          el('p', { class: 'pie__titulo', text: 'Soporte' }),
          el('p', { class: 'pie__texto' }, [
            '¿Dudas o problemas con la carga de datos? Escribe a ',
            el('a', { href: `mailto:${CONFIG.soporte}`, text: CONFIG.soporte })
          ])
        ])
      ]),
      el('div', { class: 'pie__base' }, [
        el('span', { text: `© ${new Date().getFullYear()} ${CONFIG.institucion}` }),
        el('span', { text: `Versión ${CONFIG.version}` })
      ])
    ])
  ]);

  render($('#aplicacion'), cabecera, principal, pie);
  construirNavegacion();
}

function construirNavegacion() {
  const nav = $('#navPlanes');
  render(nav, ...PLANES.map((p) => el('a', {
    class: 'plan-tab', href: `#/${p.id}`, dataset: { plan: p.id }
  }, [
    el('span', { text: p.icono, attrs: { 'aria-hidden': 'true' } }),
    el('span', { text: p.nombre }),
    el('span', { class: 'plan-tab__contador', dataset: { contador: p.id }, text: '0' })
  ])));
}

/* ------------------------------------------------------------------ */
/* Activación de un plan                                               */
/* ------------------------------------------------------------------ */

async function activarPlan(plan) {
  if (estado.plan?.id === plan.id) return;
  estado.plan = plan;
  document.title = `${plan.nombre} · Planificación ${CONFIG.anio}`;

  for (const tab of document.querySelectorAll('.plan-tab')) {
    const activo = tab.dataset.plan === plan.id;
    if (activo) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }

  if (plan.id === 'pns' && !estado.ens) {
    const cerrar = mostrarCargando('Cargando la Estrategia Nacional de Salud…');
    try {
      const [ens, indicadores] = await Promise.all([cargarENS(), cargarIndicadores().catch(() => ({}))]);
      estado.ens = ens;
      estado.ensIndex = indexarENS(ens);
      estado.indicadores = indicadores;
    } catch (e) {
      avisar('No se pudo cargar la cadena de resultados ENS. Revisa tu conexión.', 'error');
      console.error(e);
    } finally {
      cerrar();
    }
  }

  dibujarPortada(plan);

  estado.panel?.destruir();

  estado.formulario?.destruir?.();
  estado.formulario = new Formulario({
    contenedor: $('#zonaFormulario'),
    plan,
    catalogos: estado.catalogos,
    ens: plan.id === 'pns' ? estado.ens : null,
    indicadores: estado.indicadores,
    clasificador: estado.clasificador,
    previsualizarCodigo: () => previsualizarCodigo(almacen.porPlan(plan.id)),
    alGuardar: guardarActividad
  });

  estado.tabla = new TablaActividades({
    contenedor: $('#zonaTabla'),
    plan,
    catalogos: estado.catalogos,
    ens: plan.id === 'pns' ? estado.ensIndex : null,
    clasificador: estado.clasificador,
    acciones: {
      editar: (id) => {
        const a = almacen.obtener(id);
        if (a) estado.formulario.cargar(a);
      },
      duplicar: async (id) => {
        const copia = await almacen.duplicar(id);
        if (copia) avisar('Se creó una copia de la actividad.', 'exito');
      },
      eliminar: async (id) => {
        const a = almacen.obtener(id);
        const ok = await confirmar({
          titulo: 'Eliminar actividad',
          mensaje: `Se eliminará "${a?.nombreActividad || 'esta actividad'}". Esta acción no se puede deshacer.`,
          textoConfirmar: 'Eliminar',
          peligro: true
        });
        if (!ok) return;
        await almacen.eliminar(id);
        avisar('Actividad eliminada.', 'info');
      }
    }
  });

  estado.panel = new Panel({
    contenedor: $('#zonaPanel'),
    plan,
    catalogos: estado.catalogos,
    nombresOE: new Map((estado.ens?.objetivosEstrategicos ?? []).map((o) => [o.codigo, o.nombre]))
  });

  dibujarAccionesListado();
  refrescar();
}

/**
 * Guarda una actividad, asignándole el código correlativo si es nueva.
 *
 * El número se pide recién en este momento, no al abrir el formulario: entre
 * que alguien empieza a escribir y guarda, otra persona de su departamento pudo
 * haber tomado el siguiente número.
 */
async function guardarActividad(actividad, { editaba }) {
  // Quien no venía en la nómina eligió su departamento a mano: se guarda en su
  // perfil para no volver a preguntárselo y para que el servidor pueda numerar.
  // Solo al crear: editar la actividad de otra persona no debe cambiar el
  // departamento propio.
  if (!editaba && perfil.necesitaDepartamento && actividad.departamento) {
    await perfil.fijarDepartamento(actividad.departamento);
  }

  if (!editaba && !actividad.codigoActividad) {
    try {
      const r = await siguienteCodigo({
        plan: actividad.plan,
        anio: CONFIG.anio,
        actividadesLocales: almacen.porPlan(actividad.plan)
      });
      actividad.codigoActividad = r.codigo;

      // Con sesión iniciada, el número lo debe dar el servidor. Si hubo que
      // recurrir al conteo local, dos personas del mismo departamento pueden
      // terminar con el mismo código: conviene decirlo, no esconderlo.
      if (r.origen === 'local' && perfil.identificado) {
        avisar(
          'El código se asignó de forma local porque el servidor no respondió. ' +
          'Avisa a Control de Gestión: puede repetirse dentro de tu departamento.',
          'alerta',
          { duracion: 12000 }
        );
      }
    } catch (e) {
      console.warn('No se pudo asignar el código automático:', e);
    }
  }

  const r = await almacen.guardar(actividad);
  if (r.ok === false) {
    avisar(r.error, 'error', { duracion: 10000 });
    return;
  }
  avisar(
    editaba
      ? 'Actividad actualizada.'
      : `Actividad guardada${actividad.codigoActividad ? ` con el código N° ${actividad.codigoActividad}` : ''}.`,
    'exito'
  );
}

function dibujarPortada(plan) {
  const enlace = plan.enlace ? CONFIG.enlaces[plan.enlace.url.split('.')[1]] : null;
  render($('#portada'), el('div', { class: 'portada' }, [
    el('div', {}, [
      el('h2', { class: 'portada__titulo', text: plan.nombre }),
      el('p', { class: 'portada__descripcion', text: plan.descripcion }),
      enlace && el('a', {
        class: 'portada__enlace', href: enlace,
        attrs: { target: '_blank', rel: 'noopener noreferrer' }
      }, [plan.enlace.texto, el('span', { text: ' ↗', attrs: { 'aria-hidden': 'true' } })])
    ].filter(Boolean))
  ]));
}

function dibujarAccionesListado() {
  render($('#accionesListado'),
    el('button', {
      class: 'btn btn--primario', attrs: { type: 'button' }, text: 'Exportar a Excel',
      on: { click: () => exportar('xlsx') }
    }),
    el('button', {
      class: 'btn btn--secundario', attrs: { type: 'button' }, text: 'Respaldar (JSON)',
      on: { click: () => exportar('json') }
    }),
    // Exportar, respaldar e imprimir son lectura y quedan siempre disponibles.
    // Importar escribe, así que sigue el permiso del perfil activo.
    el('button', {
      class: 'btn btn--secundario',
      attrs: {
        type: 'button',
        disabled: !perfil.permisos.puedeImportar,
        title: perfil.permisos.puedeImportar
          ? 'Cargar actividades desde un respaldo JSON'
          : `El perfil ${nombrePerfil(perfil.rol)} es de solo lectura: no puede importar actividades.`
      },
      text: 'Importar',
      on: { click: importar }
    }),
    el('button', {
      class: 'btn btn--fantasma', attrs: { type: 'button' }, text: 'Más',
      on: { click: mostrarMasAcciones }
    })
  );
}

/* ------------------------------------------------------------------ */
/* Asistente                                                           */
/* ------------------------------------------------------------------ */

/**
 * Monta el asistente. Su contenido se carga aparte y sin bloquear: si el
 * archivo no llegara, la plataforma sigue funcionando igual y simplemente no
 * aparece el botón. Nunca debe ser el motivo de que algo no cargue.
 */
async function montarAsistente() {
  let contenido;
  try {
    contenido = await cargarContenidoAsistente();
  } catch (e) {
    console.warn('El asistente no se cargó:', e);
    return;
  }

  estado.asistente = new Asistente({
    contenedor: document.body,
    contenido,
    contexto: () => ({
      plan: estado.plan,
      formulario: estado.formulario,
      actividades: estado.plan ? almacen.porPlan(estado.plan.id) : [],
      catalogos: estado.catalogos,
      indicadores: estado.indicadores,
      abrirActividad
    })
  });

  // Revisa mientras se escribe, no solo al guardar. Va delegado en el
  // documento porque el formulario se reconstruye con cada cambio de plan.
  const alEscribir = (e) => {
    if (e.target.closest?.('#zonaFormulario')) estado.asistente?.revisar();
  };
  document.addEventListener('input', alEscribir);
  document.addEventListener('change', alEscribir);

  estado.asistente.actualizar();
}

/** ¿Hay algo escrito en el formulario que se perdería al cargar otra cosa? */
function hayBorrador() {
  const a = estado.formulario?.leer?.();
  if (!a) return false;
  return Boolean(
    a.nombreActividad || a.descripcionActividad || a.medioVerificacion ||
    a.objetivoEstrategico || a.objetivoEstrategicoTexto || a.objetivoOperacional ||
    a.totales.cronograma || a.totales.presupuesto || a.pac?.compras?.length
  );
}

/**
 * Lleva a una actividad ya guardada desde el asistente.
 *
 * Con permiso de escritura la carga en el formulario para corregirla, que es
 * el punto de todo esto. Sin permiso abre su detalle, porque un formulario que
 * no se puede guardar no ayuda a nadie.
 *
 * La confirmación no es burocracia: cargar una actividad REEMPLAZA lo que haya
 * en el formulario, y perder media hora de escritura por pulsar un aviso sería
 * peor que el problema que el aviso señalaba.
 */
async function abrirActividad(id) {
  const a = almacen.obtener(id);
  if (!a) return;

  if (perfil.soloLectura) {
    estado.tabla?.verDetalle(id);
    return;
  }

  if (hayBorrador()) {
    const ok = await confirmar({
      titulo: 'Abrir otra actividad',
      mensaje: `Se cargará «${a.nombreActividad || 'la actividad seleccionada'}» en el formulario y se perderá lo que tengas escrito sin guardar.`,
      textoConfirmar: 'Abrir de todas formas',
      peligro: true
    });
    if (!ok) return;
  }

  estado.formulario.cargar(a);
  $('#zonaFormulario')?.scrollIntoView({
    block: 'start',
    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
  });
  avisar(`Abriste «${a.nombreActividad || 'la actividad'}» para corregirla.`, 'info', { duracion: 5000 });
}

/* ------------------------------------------------------------------ */
/* Perfil activo                                                       */
/* ------------------------------------------------------------------ */

/**
 * Pone al día el selector de la cabecera con los perfiles de la cuenta.
 * Solo aparece cuando hay más de uno: con uno no hay nada que elegir.
 */
function sincronizarSelectorPerfil() {
  const sel = $('#selectorPerfil');
  if (!sel) return;

  sel.hidden = !perfil.tieneVariosPerfiles;
  if (sel.hidden) { vaciar(sel); return; }

  render(sel, ...perfil.roles.map((r) => el('option', {
    text: nombrePerfil(r),
    attrs: { value: r, title: PERFILES[r]?.descripcion || '' }
  })));
  sel.value = perfil.rol;
  sel.dataset.solest = String(perfil.soloLectura);
  sel.title = PERFILES[perfil.rol]?.descripcion || '';
}

/**
 * Cambia el perfil activo.
 *
 * Después de confirmarlo en el servidor se recarga la página, igual que al
 * cerrar sesión y por la misma razón: el perfil decide QUÉ ENTREGA el servidor,
 * y la copia en memoria quedó armada con los permisos anteriores. Al pasar de
 * un perfil que ve toda la institución a uno que solo ve lo suyo, seguir con
 * esa copia mostraría actividades ajenas que ya no corresponden. Recargar es la
 * única forma de garantizar que no quede nada del modo anterior.
 */
async function cambiarPerfilActivo(rol) {
  const sel = $('#selectorPerfil');
  if (!rol || rol === perfil.rol) return;

  const ok = await confirmar({
    titulo: `Cambiar al perfil ${nombrePerfil(rol)}`,
    mensaje: `${PERFILES[rol]?.descripcion || ''} La plataforma se recargará para aplicar los permisos, ` +
             'así que guarda primero lo que tengas a medio escribir.',
    textoConfirmar: 'Cambiar de perfil'
  });
  if (!ok) { if (sel) sel.value = perfil.rol; return; }

  const cerrar = mostrarCargando('Cambiando de perfil…');
  try {
    const cambiado = await perfil.cambiarPerfil(rol);
    if (!cambiado) {
      cerrar();
      if (sel) sel.value = perfil.rol;
      avisar('El servidor no aceptó ese perfil. Sigues con el anterior.', 'error', { duracion: 7000 });
      return;
    }
    location.reload();
  } catch (e) {
    cerrar();
    if (sel) sel.value = perfil.rol;
    avisar(`No se pudo cambiar de perfil: ${e.message}`, 'error', { duracion: 8000 });
  }
}

/**
 * Aplica a la interfaz los permisos del perfil activo.
 *
 * Es la capa cosmética: esconde lo que no corresponde para que nadie pierda el
 * tiempo con un botón que va a fallar. Quien manda de verdad son las políticas
 * de la base de datos, y entremedio está el cerrojo del almacén.
 */
function aplicarPermisos() {
  const { soloLectura } = perfil.permisos;
  document.documentElement.dataset.soloLectura = String(soloLectura);

  // El formulario de registro completo desaparece: no tiene sentido dejar a la
  // vista media pantalla de campos que no se van a poder guardar.
  const zona = $('#zonaFormulario');
  if (zona) {
    zona.hidden = soloLectura;
    zona.setAttribute('aria-hidden', String(soloLectura));
  }

  const aviso = $('#avisoSoloLectura');
  if (aviso) aviso.hidden = !soloLectura;

  const listado = $('#tituloListado')?.nextElementSibling;
  if (listado) {
    listado.textContent = soloLectura
      ? 'Consulta y exporta las actividades registradas.'
      : 'Busca, revisa, edita o elimina lo que ya guardaste.';
  }
}

function refrescar() {
  if (!estado.plan) return;
  const actividades = almacen.porPlan(estado.plan.id);
  estado.tabla?.actualizar(actividades);
  estado.panel?.actualizar(actividades);
  // El próximo código previsto cambia con cada alta o baja.
  estado.formulario?.aplicarPerfil();
  estado.asistente?.actualizar();
  for (const p of PLANES) {
    const contador = document.querySelector(`[data-contador="${p.id}"]`);
    if (contador) contador.textContent = String(almacen.porPlan(p.id).length);
  }
}

/* ------------------------------------------------------------------ */
/* Exportar / importar                                                 */
/* ------------------------------------------------------------------ */

function contexto() {
  return {
    plan: estado.plan,
    catalogos: estado.catalogos,
    ens: estado.ensIndex,
    clasificador: estado.clasificador,
    institucion: CONFIG.institucion,
    anio: CONFIG.anio
  };
}

async function exportar(formato) {
  const actividades = almacen.porPlan(estado.plan.id);
  if (!actividades.length) {
    avisar('Todavía no hay actividades para exportar.', 'alerta');
    return;
  }
  const cerrar = mostrarCargando('Generando el archivo…');
  try {
    if (formato === 'xlsx') {
      const n = await exportarExcel(actividades, contexto());
      avisar(`Se exportaron ${numero(n)} actividades a Excel.`, 'exito');
    } else if (formato === 'csv') {
      const n = exportarCSV(actividades, contexto());
      avisar(`Se exportaron ${numero(n)} actividades a CSV.`, 'exito');
    } else {
      const n = exportarJSON(actividades, contexto());
      avisar(`Respaldo generado con ${numero(n)} actividades.`, 'exito');
    }
  } catch (e) {
    console.error(e);
    if (formato === 'xlsx') {
      avisar('No se pudo cargar la librería de Excel. Generando un CSV equivalente…', 'alerta');
      try {
        exportarCSV(actividades, contexto());
      } catch {
        avisar('No fue posible generar el archivo.', 'error');
      }
    } else {
      avisar('No fue posible generar el archivo.', 'error');
    }
  } finally {
    cerrar();
  }
}

function importar() {
  const entrada = el('input', { attrs: { type: 'file', accept: '.json,application/json' }, style: { display: 'none' } });
  entrada.addEventListener('change', async () => {
    const archivo = entrada.files?.[0];
    entrada.remove();
    if (!archivo) return;

    let entrantes;
    try {
      entrantes = await leerRespaldo(archivo, { planPorDefecto: estado.plan.id });
    } catch (e) {
      avisar(e.message, 'error', { duracion: 8000 });
      return;
    }
    if (!entrantes.length) {
      avisar('El archivo no contiene actividades.', 'alerta');
      return;
    }

    const porPlan = entrantes.reduce((m, a) => m.set(a.plan, (m.get(a.plan) || 0) + 1), new Map());
    const detalle = [...porPlan.entries()]
      .map(([id, n]) => `${numero(n)} en ${planPorId(id).nombre}`)
      .join(' · ');

    abrirModal({
      titulo: 'Importar actividades',
      ancho: '520px',
      contenido: [
        el('p', {
          class: 'texto-cuerpo',
          text: `El archivo contiene ${numero(entrantes.length)} ${entrantes.length === 1 ? 'actividad' : 'actividades'} (${detalle}).`
        }),
        el('p', { class: 'texto-cuerpo', style: { marginTop: '12px' }, text: 'Elige cómo incorporarlas:' }),
        el('ul', { class: 'texto-cuerpo', style: { marginTop: '8px', paddingLeft: '20px' } }, [
          el('li', { text: 'Agregar: mantiene lo que ya tienes y suma lo nuevo (si una actividad ya existe, se actualiza).' }),
          el('li', { text: 'Reemplazar: borra todo lo actual y deja solo el contenido del archivo.' })
        ])
      ],
      acciones: [
        { texto: 'Cancelar', clase: 'btn--secundario', alHacerClic: (m) => m.cerrar() },
        {
          texto: 'Reemplazar todo', clase: 'btn--peligro',
          alHacerClic: async (m) => {
            m.cerrar();
            const ok = await confirmar({
              titulo: 'Reemplazar todas las actividades',
              mensaje: 'Se eliminará todo lo registrado actualmente en este navegador. ¿Continuar?',
              textoConfirmar: 'Sí, reemplazar', peligro: true
            });
            if (!ok) return;
            const r = await almacen.importar(entrantes, { modo: 'reemplazar' });
            avisar(`Se importaron ${numero(r.total)} actividades.`, 'exito');
          }
        },
        {
          texto: 'Agregar', clase: 'btn--primario',
          alHacerClic: async (m) => {
            m.cerrar();
            const r = await almacen.importar(entrantes, { modo: 'agregar' });
            avisar(`Se importaron ${numero(r.total)} actividades.`, 'exito');
          }
        }
      ]
    });
  });
  document.body.append(entrada);
  entrada.click();
}

/* ------------------------------------------------------------------ */
/* Menús auxiliares                                                    */
/* ------------------------------------------------------------------ */

function mostrarMasAcciones() {
  abrirModal({
    titulo: 'Más acciones',
    ancho: '480px',
    contenido: el('div', { style: { display: 'grid', gap: '12px' } }, [
      el('button', {
        class: 'btn btn--secundario', attrs: { type: 'button' }, text: 'Exportar a CSV',
        on: { click: (e) => { e.target.closest('.modal').querySelector('.modal__cerrar').click(); exportar('csv'); } }
      }),
      el('button', {
        class: 'btn btn--secundario', attrs: { type: 'button' }, text: 'Imprimir o guardar como PDF',
        on: { click: () => print() }
      }),
      perfil.permisos.puedeEliminar && el('button', {
        class: 'btn btn--peligro', attrs: { type: 'button' }, text: `Vaciar el ${estado.plan.nombreCorto}`,
        on: {
          click: async (e) => {
            e.target.closest('.modal').querySelector('.modal__cerrar').click();
            const ok = await confirmar({
              titulo: `Vaciar ${estado.plan.nombre}`,
              mensaje: 'Se eliminarán todas las actividades de este plan en este navegador. Genera un respaldo antes si aún lo necesitas.',
              textoConfirmar: 'Vaciar', peligro: true
            });
            if (!ok) return;
            await almacen.vaciarPlan(estado.plan.id);
            avisar('Plan vaciado.', 'info');
          }
        }
      })
    ].filter(Boolean))
  });
}

function mostrarAyuda() {
  const paso = (n, titulo, texto) => el('div', { style: { display: 'flex', gap: '14px', marginBottom: '18px' } }, [
    el('span', { class: 'seccion__numero', text: String(n), attrs: { 'aria-hidden': 'true' } }),
    el('div', {}, [
      el('p', { style: { fontWeight: '650' }, text: titulo }),
      el('p', { class: 'texto-cuerpo', text: texto })
    ])
  ]);

  abrirModal({
    titulo: 'Cómo usar la plataforma',
    ancho: '640px',
    contenido: [
      paso(1, 'Elige tu plan', 'Arriba puedes cambiar entre el Plan Nacional de Salud y el Plan de Gestión Institucional. Cada uno guarda sus actividades por separado.'),
      paso(2, 'Completa el formulario', 'Los campos con asterisco son obligatorios. En el Plan Nacional de Salud, cada selección de la cadena de resultados filtra la siguiente y te muestra el indicador oficial asociado.'),
      paso(3, 'Registra cronograma y presupuesto', 'Indica cuántas veces ejecutarás la actividad cada mes. Los montos van en miles de pesos. Si no requiere presupuesto, activa el interruptor.'),
      paso(4, 'Si vas a comprar, completa el PAC',
        'Dentro del Subtítulo 22, activa el interruptor del Plan Anual de Compras y agrega una tarjeta por cada producto o servicio a contratar. Puedes agregar varias. La plataforma compara la suma con el presupuesto del subtítulo y te avisa si no cuadran.'),
      paso(5, 'Revisa y ajusta', 'En "Actividades registradas" puedes buscar, ver el detalle, editar, duplicar o eliminar. El panel de análisis se actualiza solo.'),
      paso(6, 'Exporta y respalda', 'Usa "Exportar a Excel" para la entrega oficial. Usa "Respaldar (JSON)" para guardar una copia que puedas volver a importar aquí o enviar a Control de Gestión para consolidar.'),
      el('div', { class: 'nota nota--info' }, [
        el('p', {}, [
          el('strong', { text: 'Importante: ' }),
          CONFIG.nube.habilitada
            ? 'Tus actividades se sincronizan con el repositorio institucional.'
            : 'Las actividades se guardan en este navegador y en este equipo. Genera un respaldo antes de limpiar el historial o cambiar de computador.'
        ])
      ]),
      // El interruptor del asistente vive aquí porque Ayuda es donde alguien lo
      // va a buscar. Sin esto, ocultarlo era irreversible sin tocar la consola
      // del navegador.
      filaAsistente()
    ],
    acciones: [{ texto: 'Entendido', clase: 'btn--primario', alHacerClic: (m) => m.cerrar() }]
  });
}

/** Interruptor de mostrar/ocultar el asistente, dentro del modal de Ayuda. */
function filaAsistente() {
  if (!estado.asistente) return null;

  const fila = el('div', { class: 'ayuda__interruptor' });

  const pintar = () => {
    const oculto = estado.asistente.oculto;
    render(fila,
      el('div', {}, [
        el('p', { style: { fontWeight: '650' }, text: 'Asistente de la plataforma' }),
        el('p', {
          class: 'texto-cuerpo',
          text: oculto
            ? 'Está oculto en este navegador.'
            : 'El botón redondo de abajo a la derecha. Revisa lo que escribes y responde dudas.'
        })
      ]),
      el('button', {
        class: oculto ? 'btn btn--primario' : 'btn btn--secundario',
        attrs: { type: 'button' },
        text: oculto ? 'Mostrar' : 'Ocultar',
        on: {
          click: () => {
            if (oculto) {
              estado.asistente.mostrar();
              estado.asistente.actualizar();
              avisar('El asistente volvió a aparecer, abajo a la derecha.', 'exito', { duracion: 4000 });
            } else {
              estado.asistente.ocultarDelTodo();
            }
            pintar();
          }
        }
      })
    );
  };

  pintar();
  return fila;
}
