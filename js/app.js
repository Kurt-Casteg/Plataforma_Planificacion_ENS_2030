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
import { exportarExcel, exportarCSV, exportarJSON, exportarArchivoCiclo, leerRespaldo } from './core/exportar.js';
import { numero, fechaHora } from './core/formato.js';
import { perfil, nombrePerfil, PERFILES } from './core/perfil.js';
import { periodo } from './core/periodo.js';
import { ajustes } from './core/ajustes.js';
import { ZonaRevision, pedirObservacion, NOMBRE_ESTADO } from './core/aprobacion.js';
import { AnalisisPac } from './core/analisis-pac.js';
import { abrirConfiguracion } from './core/configuracion.js';
import { abrirHoja } from './core/hoja.js';
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
  asistente: null,
  revision: null,
  pac: null
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

  const { migradas, archivadas, soportaAlmacenamiento } = await almacen.iniciar();
  cerrarCarga();

  construirCascaron();

  // Bloques que abarcan los dos planes: se crean una vez y no por pestaña.
  estado.revision = new ZonaRevision({
    contenedor: $('#zonaRevision'),
    catalogos: estado.catalogos,
    alDecidir: decidir,
    alVer: verActividad,
    nombrePlan: (id) => planPorId(id).nombreCorto
  });
  estado.pac = new AnalisisPac({
    contenedor: $('#zonaPac'),
    catalogos: estado.catalogos,
    clasificador: estado.clasificador
  });

  await activarPlan(planDesdeURL());

  almacen.addEventListener('cambio', () => refrescar());
  // El servidor rechazó un cambio por una regla (por ejemplo, la actividad ya
  // estaba aprobada): se dice por qué. El almacén ya volvió a su versión.
  almacen.addEventListener('sincronizacion:rechazo', (e) => {
    avisar(e.detail?.message || 'El servidor no aceptó el cambio.', 'error', { duracion: 10000 });
  });
  // Encender o apagar el circuito de aprobación o el análisis del PAC cambia
  // botones, columnas y bloques: se rehace todo lo que depende de eso.
  ajustes.addEventListener('cambio', () => {
    estado.formulario?.aplicarModoAprobacion();
    dibujarAccionesListado();
    refrescar();
  });
  addEventListener('hashchange', () => activarPlan(planDesdeURL()));

  montarAsistente();
  prepararImpresion();

  // Iniciar sesión, cerrarla o cambiar de perfil altera qué se puede hacer:
  // el selector y los bloqueos se rehacen desde un solo lugar.
  perfil.addEventListener('cambio', () => {
    if (verificarPeriodo()) return;
    sincronizarSelectorPerfil();
    sincronizarSelectorPeriodo();
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
      .then(() => {
        // Sin sesión (o sin conexión) no hay perfil de Control de Gestión que
        // justifique seguir en un período que no es el vigente.
        if (verificarPeriodo()) return;
        refrescar();
      })
      .catch((e) => console.error('Sincronización no disponible:', e));
  }

  // Cambio de ciclo: lo que había en este navegador del año anterior se apartó.
  // Se avisa una sola vez, el día en que ocurre; después queda en «Más».
  if (archivadas) {
    avisar(
      `Comenzó el ciclo de planificación ${periodo.anio}. Las ${numero(archivadas.total)} actividades del ` +
      `${archivadas.anio} que había en este navegador se archivaron; puedes descargarlas desde «Más».`,
      'info', { duracion: 12000 }
    );
  }
  if (migradas > 0) {
    avisar(`Se recuperaron ${numero(migradas)} actividades de la versión anterior.`, 'exito', { duracion: 7000 });
  }
  if (!soportaAlmacenamiento) {
    avisar('El navegador no permite guardar datos (¿ventana privada?). Exporta tu trabajo antes de cerrar.', 'alerta', { duracion: 12000 });
  }
});

const planDesdeURL = () => planPorId(location.hash.replace('#/', '').split('/')[0]);

/**
 * Carga la cadena de resultados ENS si aún no está en memoria.
 *
 * Se descarga solo cuando hace falta —abrir el PNS o generar el informe— para
 * no cobrarle el archivo completo a quien solo viene a trabajar en el PGI.
 */
async function asegurarENS() {
  if (estado.ens) return true;
  const cerrar = mostrarCargando('Cargando la Estrategia Nacional de Salud…');
  try {
    const [ens, indicadores] = await Promise.all([cargarENS(), cargarIndicadores().catch(() => ({}))]);
    estado.ens = ens;
    estado.ensIndex = indexarENS(ens);
    estado.indicadores = indicadores;
    return true;
  } catch (e) {
    avisar('No se pudo cargar la cadena de resultados ENS. Revisa tu conexión.', 'error');
    console.error(e);
    return false;
  } finally {
    cerrar();
  }
}

/* ------------------------------------------------------------------ */
/* Cascarón: cabecera, navegación y pie                                */
/* ------------------------------------------------------------------ */

function construirCascaron() {
  const cabecera = el('header', { class: 'cabecera' }, [
    // Franja de período: solo existe fuera del período vigente. Va dentro de la
    // cabecera fija para que no desaparezca al bajar por el formulario.
    !periodo.esVigente && el('div', {
      class: 'franja-periodo', id: 'franjaPeriodo', attrs: { role: 'status' }
    }, [
      el('div', { class: 'envoltura franja-periodo__fila' }, [
        el('p', { class: 'franja-periodo__texto' }, [
          el('strong', { text: `Estás en el período ${periodo.anio}, no en el vigente (${periodo.vigente}).` }),
          el('span', {
            class: 'franja-periodo__detalle',
            text: ` Lo que registres, edites o elimines queda en ${periodo.anio} y no se mezcla con ${periodo.vigente}.`
          })
        ]),
        el('button', {
          class: 'btn btn--secundario franja-periodo__boton', text: `Volver al ${periodo.vigente}`,
          attrs: { type: 'button' },
          on: { click: () => periodo.cambiar(periodo.vigente) }
        })
      ])
    ]),
    el('div', { class: 'envoltura' }, [
      el('div', { class: 'cabecera__fila' }, [
        el('div', { class: 'cabecera__marca' }, [
          el('img', {
            class: 'cabecera__logo', src: 'assets/logo-nuble.png',
            attrs: { alt: '', width: 42, height: 42, loading: 'eager' }
          }),
          el('div', { class: 'cabecera__textos' }, [
            el('p', { class: 'cabecera__subtitulo', text: CONFIG.institucion }),
            el('h1', { class: 'cabecera__titulo', text: `Plataforma de Planificación ${periodo.anio}` })
          ])
        ]),
        el('div', { class: 'cabecera__herramientas' }, [
          // Selector de período. Nace oculto: solo lo ve Control de Gestión, y
          // solo si config.js habilita algún período además del vigente.
          el('select', {
            class: 'campo__control selector-perfil selector-periodo', id: 'selectorPeriodo',
            dataset: { distinto: String(!periodo.esVigente) },
            attrs: { hidden: true, 'aria-label': 'Período de planificación' },
            on: { change: (e) => cambiarPeriodo(Number(e.target.value)) }
          }),
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
    // Aviso de «sin sesión». Lo llena y lo muestra js/core/sesion.js, que es el
    // único que sabe si hay sesión; aquí solo se le reserva el lugar, justo
    // encima del formulario, que es donde se toma la decisión de registrar.
    el('div', { id: 'avisoSesion', attrs: { hidden: true } }),
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
    // Revisión del departamento (jefatura), avance de la aprobación (Control
    // de Gestión) o recordatorio (equipo). Solo con el circuito encendido.
    el('div', { id: 'zonaRevision', attrs: { hidden: true } }),
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
    ]),
    // Análisis del Plan Anual de Compras: los dos planes juntos.
    el('div', { id: 'zonaPac', attrs: { hidden: true } })
  ]);

  const pie = el('footer', { class: 'pie' }, [
    el('div', { class: 'envoltura' }, [
      el('div', { class: 'pie__grilla' }, [
        el('div', {}, [
          el('p', { class: 'pie__titulo', text: `Plataforma de Planificación ${periodo.anio}` }),
          el('p', { class: 'pie__texto', text: 'Herramienta institucional para planificar, consolidar y analizar las actividades de los equipos.' })
        ]),
        el('div', {}, [
          el('p', { class: 'pie__titulo', text: 'Desarrollo' }),
          CONFIG.autoria?.autor && el('p', { class: 'pie__texto pie__autor' }, [
            'Diseño y desarrollo: ', el('strong', { text: CONFIG.autoria.autor })
          ]),
          // Los créditos salen de config.js: son un texto que cambia con la
          // orgánica de la SEREMI y no debería obligar a tocar código.
          ...(CONFIG.desarrollo ?? []).map((linea) => el('p', { class: 'pie__texto', text: linea })),
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
  document.title = `${plan.nombre} · Planificación ${periodo.anio}`;

  for (const tab of document.querySelectorAll('.plan-tab')) {
    const activo = tab.dataset.plan === plan.id;
    if (activo) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }

  if (plan.id === 'pns') await asegurarENS();

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
    alGuardar: guardarActividad,
    alTerminarEdicion: () => cerrarHoja()
  });

  estado.tabla = new TablaActividades({
    contenedor: $('#zonaTabla'),
    plan,
    catalogos: estado.catalogos,
    ens: plan.id === 'pns' ? estado.ensIndex : null,
    clasificador: estado.clasificador,
    acciones: {
      editar: (id) => editarEnHoja(id),
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
      },
      enviar: (id) => enviarARevision(id),
      aprobar: (id) => decidir([id], 'aprobar'),
      observar: (id) => decidir([id], 'observar'),
      reabrir: (id) => decidir([id], 'reabrir')
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
async function guardarActividad(actividad, { editaba, enviar = true }) {
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
        anio: periodo.anio,
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

  // Circuito de aprobación: el botón pulsado decide si va a revisión. Una
  // actividad observada que se guarda sin enviar sigue observada, para que la
  // observación de la jefatura no se pierda de vista. Lo aprobado (solo Control
  // de Gestión llega a editarlo) conserva su estado.
  let mensajeEstado = '';
  if (ajustes.circuitoActivo && actividad.estado !== 'aprobada') {
    if (enviar) {
      actividad.estado = 'revision';
      mensajeEstado = ' y enviada a revisión de la jefatura';
    } else if (actividad.estado !== 'observada') {
      actividad.estado = 'borrador';
      mensajeEstado = ' como borrador';
    }
  }

  const r = await almacen.guardar(actividad);
  if (r.ok === false) {
    avisar(r.error, 'error', { duracion: 10000 });
    return;
  }
  avisar(
    editaba
      ? `Actividad actualizada${mensajeEstado}.`
      : `Actividad guardada${actividad.codigoActividad ? ` con el código N° ${actividad.codigoActividad}` : ''}${mensajeEstado}.`,
    'exito'
  );
}

/* ------------------------------------------------------------------ */
/* Circuito de aprobación                                              */
/* ------------------------------------------------------------------ */

/** El equipo envía una actividad ya guardada a revisión de su jefatura. */
async function enviarARevision(id) {
  const a = almacen.obtener(id);
  if (!a) return;
  const r = await almacen.guardar({ ...a, estado: 'revision' });
  if (r.ok === false) { avisar(r.error, 'error', { duracion: 10000 }); return; }
  avisar(`«${a.nombreActividad}» quedó enviada a revisión de la jefatura.`, 'exito');
}

/**
 * Aprueba, observa o reabre (jefatura y Control de Gestión). Lo decide el
 * servidor: si una no corresponde, no se aplica ninguna y se dice por qué.
 */
async function decidir(ids, decision) {
  const actividades = ids.map((id) => almacen.obtener(id)).filter(Boolean);
  if (!actividades.length || !perfil.nube) return;

  let observacion = null;
  if (decision === 'observar') {
    observacion = await pedirObservacion(actividades);
    if (!observacion) return;
  } else if (decision === 'reabrir') {
    const ok = await confirmar({
      titulo: 'Reabrir actividad',
      mensaje: `«${actividades[0].nombreActividad}» volverá a borrador: el equipo podrá modificarla y tendrá que enviarla de nuevo a revisión.`,
      textoConfirmar: 'Reabrir'
    });
    if (!ok) return;
  } else if (ids.length > 1) {
    const ok = await confirmar({
      titulo: `Aprobar ${ids.length} actividades`,
      mensaje: 'Quedarán aprobadas y bloqueadas para el equipo. Si alguna necesita cambios, se puede reabrir después.',
      textoConfirmar: 'Aprobar todas'
    });
    if (!ok) return;
  }

  const cerrar = mostrarCargando('Guardando la decisión…');
  try {
    const remotas = await perfil.nube.decidir(ids, decision, observacion);
    almacen.aplicarRemotas(remotas);
    const n = remotas.length;
    const que = { aprobar: n > 1 ? 'aprobadas' : 'aprobada', observar: n > 1 ? 'devueltas con observación' : 'devuelta con observación', reabrir: 'reabierta' }[decision];
    avisar(n > 1 ? `${numero(n)} actividades ${que}.` : `Actividad ${que}.`, 'exito');
  } catch (e) {
    avisar(e.message || 'No se pudo guardar la decisión.', 'error', { duracion: 10000 });
  } finally {
    cerrar();
  }
}

/** Abre el detalle de una actividad de cualquiera de los dos planes. */
async function verActividad(id, opciones = {}) {
  const a = almacen.obtener(id);
  if (!a) return;
  if (estado.plan?.id !== a.plan) {
    history.replaceState(null, '', `#/${a.plan}`);
    await activarPlan(planPorId(a.plan));
  }
  // `lista`: lo que recorren «Anterior» y «Siguiente» (desde la bandeja, sus
  // pendientes). Solo cuentan los del plan abierto: la ficha vive en su listado.
  estado.tabla?.verDetalle(id, opciones);
}

function dibujarPortada(plan) {
  // La dirección puede traer «{anio}»: se completa con el período de la pestaña.
  const enlace = plan.enlace
    ? CONFIG.enlaces[plan.enlace.url.split('.')[1]]?.replace('{anio}', String(periodo.anio))
    : null;
  render($('#portada'), el('div', { class: 'portada' }, [
    el('div', {}, [
      el('h2', { class: 'portada__titulo', text: plan.nombre }),
      el('p', { class: 'portada__descripcion', text: plan.descripcion }),
      enlace && el('a', {
        class: 'portada__enlace', href: enlace,
        attrs: { target: '_blank', rel: 'noopener noreferrer' }
      }, [plan.enlace.texto, el('span', { text: ' ↗', attrs: { 'aria-hidden': 'true' } })]),
      // Solo aparece en papel. Una hoja impresa sin institución ni fecha no se
      // puede archivar: nadie sabe de qué momento de la planificación habla.
      el('p', {
        class: 'portada__sello solo-impresion', id: 'selloImpresion',
        text: `${CONFIG.institucion} · Planificación ${periodo.anio}`
      })
    ].filter(Boolean))
  ]));
}

/* ------------------------------------------------------------------ */
/* Impresión                                                           */
/* ------------------------------------------------------------------ */

/**
 * Ajustes que la hoja de estilos no puede hacer sola.
 *
 * `beforeprint` se dispara tanto desde el botón «Imprimir o guardar como PDF»
 * como desde Ctrl+P, así que basta conectarlo una vez y las dos vías quedan
 * cubiertas.
 *
 *  - La fecha se calcula en el momento de imprimir, no al cargar la página:
 *    una pestaña abierta desde ayer imprimiría el sello equivocado.
 *  - Las tablas de datos de cada gráfico se abren. Un gráfico en papel no se
 *    puede consultar; los números sí. Se cierran después para dejar la
 *    pantalla como estaba, salvo las que ya estaban abiertas.
 */
function prepararImpresion() {
  let abiertasPorNosotros = [];

  addEventListener('beforeprint', () => {
    const sello = $('#selloImpresion');
    if (sello && estado.plan) {
      sello.textContent =
        `${CONFIG.institucion} · Planificación ${periodo.anio} · Impreso el ${fechaHora(new Date())}`;
    }

    abiertasPorNosotros = [...document.querySelectorAll('.tabla-datos:not([open])')];
    for (const d of abiertasPorNosotros) d.open = true;
  });

  addEventListener('afterprint', () => {
    for (const d of abiertasPorNosotros) d.open = false;
    abiertasPorNosotros = [];
  });
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
    // El informe consolidado cruza los dos planes y todos los departamentos:
    // solo lo ve quien tiene esa responsabilidad institucional.
    PERFILES_CON_INFORME.has(perfil.rol) && el('button', {
      class: 'btn btn--secundario',
      attrs: { type: 'button', title: 'Informe consolidado de ambos planes y del Plan Anual de Compras' },
      text: 'Exportar informe',
      on: { click: exportarInforme }
    }),
    el('button', {
      class: 'btn btn--fantasma', attrs: { type: 'button' }, text: 'Más',
      on: { click: mostrarMasAcciones }
    })
  );
}

/**
 * Informe consolidado: los dos planes, el Plan Anual de Compras y el estado de
 * cada ficha en una sola entrega.
 *
 * A diferencia de «Exportar a Excel», que entrega el plan que se está viendo,
 * este informe recorre TODA la planificación de la institución. Por eso está
 * restringido: no es una función más de exportación, es la consolidación.
 *
 * Para dárselo a otro perfil —por ejemplo al Observador, que también ve toda la
 * institución— basta con agregar su identificador a este conjunto.
 */
const PERFILES_CON_INFORME = new Set(['control_gestion']);

/**
 * Con el circuito de aprobación encendido, el informe puede ser el borrador de
 * trabajo (todo lo registrado) o la versión para el traspaso al Ministerio
 * (solo lo aprobado). Se pregunta cada vez: confundirlos es caro.
 */
function elegirAlcanceInforme(todas) {
  const aprobadas = todas.filter((a) => a.estado === 'aprobada').length;
  return new Promise((resolve) => {
    let elegido = null;
    abrirModal({
      titulo: 'Exportar informe consolidado',
      ancho: '520px',
      alCerrar: () => resolve(elegido),
      contenido: [
        el('p', { class: 'texto-cuerpo', text: `Hay ${numero(aprobadas)} de ${numero(todas.length)} actividades aprobadas por su jefatura. ¿Qué quieres incluir?` })
      ],
      acciones: [
        { texto: 'Cancelar', clase: 'btn--secundario', alHacerClic: (m) => m.cerrar() },
        { texto: 'Todas las actividades', clase: 'btn--secundario', alHacerClic: (m) => { elegido = 'todas'; m.cerrar(); } },
        { texto: 'Solo aprobadas (para el traspaso)', clase: 'btn--primario', alHacerClic: (m) => { elegido = 'aprobadas'; m.cerrar(); } }
      ]
    });
  });
}

async function exportarInforme() {
  let actividades = almacen.todas;
  if (!actividades.length) {
    avisar('Todavía no hay actividades registradas para informar.', 'alerta');
    return;
  }

  let alcance = '';
  if (ajustes.circuitoActivo) {
    const opcion = await elegirAlcanceInforme(actividades);
    if (!opcion) return;
    if (opcion === 'aprobadas') {
      actividades = actividades.filter((a) => a.estado === 'aprobada');
      if (!actividades.length) {
        avisar('Todavía no hay actividades aprobadas. Puedes exportar el informe con todas las actividades.', 'alerta', { duracion: 7000 });
        return;
      }
      alcance = 'Solo actividades aprobadas por la jefatura de su departamento.';
    } else {
      alcance = 'Incluye todas las actividades registradas, aprobadas o no.';
    }
  }

  const cerrar = mostrarCargando('Reuniendo el informe…');
  try {
    // La cobertura ENS necesita el árbol completo aunque se esté mirando el PGI.
    await asegurarENS();

    const [{ reunirInforme, exportarInformeExcel }, { abrirVistaInforme }] = await Promise.all([
      import('./core/informe.js'),
      import('./core/informe-vista.js')
    ]);

    const informe = reunirInforme({
      actividades,
      planes: PLANES,
      catalogos: estado.catalogos,
      ens: estado.ensIndex,
      clasificador: estado.clasificador,
      institucion: CONFIG.institucion,
      anio: periodo.anio,
      alcance
    });

    const descargarExcel = async () => {
      try {
        const r = await exportarInformeExcel(informe);
        avisar(`Informe descargado: ${numero(r.actividades)} actividades en ${r.hojas.length} hojas.`, 'exito');
      } catch (e) {
        console.error(e);
        avisar('No se pudo generar el archivo de Excel. La vista del informe sigue disponible para imprimir.', 'error', { duracion: 9000 });
      }
    };

    // Primero el archivo, después la vista: si algo falla en el Excel, el
    // informe en pantalla queda igualmente a la mano para imprimir.
    await descargarExcel();
    abrirVistaInforme(informe, { alExportarExcel: descargarExcel });
  } catch (e) {
    console.error(e);
    avisar('No fue posible generar el informe.', 'error');
  } finally {
    cerrar();
  }
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
  // La hoja lateral guarda aparte lo que haya a medio llenar en el
  // formulario: abrirla ya no pone en riesgo ese trabajo.
  await editarEnHoja(id);
}

/* ------------------------------------------------------------------ */
/* Editar en una hoja lateral                                          */
/* ------------------------------------------------------------------ */

/**
 * «Editar» abre la actividad en una hoja que entra desde la derecha. El
 * listado queda detrás, donde estaba: al guardar o cancelar, la hoja se va y
 * la fila editada destella un momento.
 *
 * El formulario es uno solo: mientras dura la edición se muda a la hoja y al
 * terminar vuelve a su lugar. Si alguien tenía una actividad nueva a medio
 * llenar, se guarda aparte y se le devuelve intacta al cerrar la hoja.
 */
let hoja = null;

/** Huella de lo que hay en el formulario, para saber si hubo cambios. */
function huella(a) {
  const { actualizadaEn, creadaEn, ...resto } = a || {};
  return JSON.stringify(resto);
}

async function editarEnHoja(id) {
  const a = almacen.obtener(id);
  const f = estado.formulario;
  const zona = $('#zonaFormulario');
  const marco = zona?.firstElementChild;
  if (!a || !f || !marco || hoja) return;

  const borrador = !f.editando && hayBorrador() ? f.leer() : null;
  const api = abrirHoja({
    etiqueta: 'Editar actividad',
    titulo: a.nombreActividad || 'Actividad sin nombre',
    subtitulo: [a.codigoActividad && `N° ${a.codigoActividad}`, planPorId(a.plan)?.nombre].filter(Boolean).join(' · '),
    alPedirCerrar: pedirCerrarHoja
  });
  hoja = { api, borrador, id, marco, abriendo: true };

  // El aviso ocupa el mismo alto que el formulario: nada de lo que está más
  // abajo (el listado) cambia de lugar mientras la hoja está abierta.
  const alto = marco.offsetHeight;
  render(zona, el('div', { class: 'edicion-lateral', style: { minHeight: `${alto}px` } }, [el('div', { class: 'nota nota--info nota--edicion-lateral', attrs: { role: 'status' } }, [
    el('p', {}, [
      'Estás editando ', el('strong', { text: `«${a.nombreActividad || 'una actividad'}»` }), ' en el panel de la derecha.',
      borrador ? ' Lo que tenías a medio llenar aquí te espera al terminar.' : ''
    ])
  ])]));
  api.cuerpo.append(marco);
  f.cargar(a, { desplazar: false });
  hoja.foto = huella(f.leer());
  hoja.abriendo = false;
  api.entrar();
}

async function pedirCerrarHoja() {
  if (!hoja || hoja.cerrando) return;
  if (huella(estado.formulario.leer()) !== hoja.foto) {
    const ok = await confirmar({
      titulo: 'Descartar cambios',
      mensaje: 'Hiciste cambios en esta actividad que no se han guardado. ¿Cerrar sin guardarlos?',
      textoConfirmar: 'Descartar cambios',
      peligro: true
    });
    if (!ok || !hoja) return;
  }
  // Limpiar termina la edición, y eso cierra la hoja (alTerminarEdicion).
  estado.formulario.limpiar();
}

function cerrarHoja() {
  if (!hoja || hoja.abriendo || hoja.cerrando) return;
  hoja.cerrando = true;
  const { api, borrador, marco, id } = hoja;
  hoja = null;
  render($('#zonaFormulario'), marco);
  api.cerrar();
  if (borrador) estado.formulario.restaurarBorrador(borrador);
  estado.tabla?.destacar(id);
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
 * Muestra el selector de período solo a Control de Gestión, y solo si hay más
 * de un período habilitado en config.js.
 */
function sincronizarSelectorPeriodo() {
  const sel = $('#selectorPeriodo');
  if (!sel) return;

  sel.hidden = !(periodo.hayOtros && perfil.esControlDeGestion);
  if (sel.hidden) { vaciar(sel); return; }

  render(sel, ...periodo.disponibles.map((anio) => el('option', {
    text: anio === periodo.vigente ? `Período ${anio} (vigente)` : `Período ${anio}`,
    attrs: { value: String(anio) }
  })));
  sel.value = String(periodo.anio);
  sel.title = periodo.esVigente
    ? 'Período vigente. Puedes abrir otro para revisarlo o hacer pruebas.'
    : `Estás en el período ${periodo.anio}, no en el vigente.`;
}

/** Cambia el período de esta pestaña, previa confirmación, y recarga. */
async function cambiarPeriodo(anio) {
  const sel = $('#selectorPeriodo');
  if (!anio || anio === periodo.anio) return;

  const aVigente = anio === periodo.vigente;
  const ok = await confirmar({
    titulo: aVigente ? `Volver al período vigente (${anio})` : `Trabajar en el período ${anio}`,
    mensaje: aVigente
      ? 'La plataforma se recargará con las actividades del período vigente. Guarda primero lo que tengas a medio escribir.'
      : `La plataforma se recargará y mostrará solo las actividades del ${anio}. Todo lo que registres, ` +
        `edites, elimines o exportes quedará en ese período, con su propia numeración, sin mezclarse con el ` +
        `${periodo.vigente}. Esta elección vale solo para esta pestaña: al cerrarla, la plataforma vuelve al ` +
        `${periodo.vigente}. Guarda primero lo que tengas a medio escribir.`,
    textoConfirmar: aVigente ? `Volver al ${anio}` : `Abrir el ${anio}`
  });
  if (!ok) { if (sel) sel.value = String(periodo.anio); return; }
  periodo.cambiar(anio);
}

/**
 * Solo Control de Gestión puede estar fuera del período vigente. Si la pestaña
 * quedó en otro período y quien la usa ya no es Control de Gestión —cerró
 * sesión, cambió de perfil o nunca la inició—, se vuelve al vigente.
 *
 * @returns {boolean} true si se está recargando (no conviene seguir pintando).
 */
function verificarPeriodo() {
  if (periodo.esVigente || perfil.esControlDeGestion) return false;
  periodo.cambiar(periodo.vigente);
  return true;
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
    // Fuera de Control de Gestión no se puede estar en otro período: se vuelve
    // al vigente en la misma recarga.
    if (rol !== 'control_gestion') periodo.olvidar();
    // Si el cambio de perfil ya disparó la vuelta al período vigente, esa
    // recarga está en curso: pedir otra encima la cancelaría a medio camino.
    if (!periodo.recargando) location.reload();
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
  estado.revision?.actualizar(almacen.todas);
  estado.pac?.actualizar(almacen.todas);
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
    anio: periodo.anio,
    conEstado: ajustes.circuitoActivo
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
  // Un botón por cada ciclo anterior archivado en este navegador. Es lectura:
  // está disponible para cualquier perfil, incluido el Observador.
  const botonesArchivo = almacen.archivos().map(({ anio, total }) => el('button', {
    class: 'btn btn--secundario', attrs: { type: 'button' },
    text: `Descargar actividades del ${anio} archivadas en este navegador (${numero(total)})`,
    on: {
      click: (e) => {
        e.target.closest('.modal').querySelector('.modal__cerrar').click();
        exportarArchivoCiclo(almacen.leerArchivo(anio), { anio, institucion: CONFIG.institucion });
        avisar(`Respaldo del ${anio} descargado. Se puede volver a cargar con «Importar».`, 'exito');
      }
    }
  }));

  abrirModal({
    titulo: 'Más acciones',
    ancho: '480px',
    contenido: el('div', { style: { display: 'grid', gap: '12px' } }, [
      // Interruptores del circuito de aprobación y del análisis del PAC.
      perfil.esControlDeGestion && perfil.nube && el('button', {
        class: 'btn btn--secundario', attrs: { type: 'button' }, text: 'Configuración de la plataforma',
        on: {
          click: (e) => {
            e.target.closest('.modal').querySelector('.modal__cerrar').click();
            abrirConfiguracion({ catalogos: estado.catalogos });
          }
        }
      }),
      ...botonesArchivo,
      el('button', {
        class: 'btn btn--secundario', attrs: { type: 'button' }, text: 'Exportar a CSV',
        on: { click: (e) => { e.target.closest('.modal').querySelector('.modal__cerrar').click(); exportar('csv'); } }
      }),
      el('button', {
        class: 'btn btn--secundario', attrs: { type: 'button' }, text: 'Imprimir o guardar como PDF',
        // El diálogo se cierra ANTES de imprimir; si no, «Más acciones» y su
        // fondo oscurecido se quedan sobre la vista previa.
        //
        // Se hace en dos tiempos a propósito. El clic en la × cierra bien —
        // devuelve el foco, suelta los escuchas—, pero el nodo no desaparece
        // hasta que termina su animación de salida, y ese `animationend` no es
        // algo en lo que se pueda confiar para algo tan visible como esto. Así
        // que además se quita a mano, y se esperan dos fotogramas para que el
        // navegador ya haya repintado cuando abre la impresión.
        //
        // La red de seguridad final está en la hoja de estilos, que excluye
        // `.modal` del papel: aunque todo esto fallara, el diálogo no saldría
        // impreso.
        on: {
          click: (e) => {
            const dialogo = e.target.closest('.modal');
            dialogo.querySelector('.modal__cerrar').click();
            dialogo.remove();
            requestAnimationFrame(() => requestAnimationFrame(() => print()));
          }
        }
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
      paso(2, 'Completa el formulario', (CONFIG.formulario !== 'clasico' ? 'Las secciones pasan hacia los lados: «Continuar» te lleva a la siguiente y la barra de arriba marca dónde estás y qué falta; también puedes tocar una etapa para ir directo. La última, «Revisar y guardar», resume todo y tiene los botones para guardar. ' : '') + 'Los campos con asterisco son obligatorios. En el Plan Nacional de Salud, cada selección de la cadena de resultados filtra la siguiente y te muestra el indicador oficial asociado.'),
      paso(3, 'Registra cronograma y presupuesto', 'Indica cuántas veces ejecutarás la actividad cada mes. Los montos van en miles de pesos. Si no requiere presupuesto, activa el interruptor.'),
      paso(4, 'Si vas a comprar, completa el PAC',
        'Dentro del Subtítulo 22, activa el interruptor del Plan Anual de Compras y agrega una tarjeta por cada producto o servicio a contratar. Puedes agregar varias. La plataforma compara la suma con el presupuesto del subtítulo y te avisa si no cuadran.'),
      paso(5, 'Revisa y ajusta', 'En "Actividades registradas" puedes buscar, editar, duplicar o eliminar. «Editar» abre la actividad en un panel a la derecha: al guardar se cierra y el listado sigue donde estaba. «Ver» abre la ficha al centro de la pantalla: con «Siguiente» o las flechas ← → recorres las demás sin cerrarla, y con Esc vuelves. En el panel de análisis, «Ampliar» agranda cualquier gráfico con su tabla de datos.'),
      ajustes.circuitoActivo && paso(6, 'Envía a revisión de tu jefatura',
        '«Guardar y enviar a revisión» deja la actividad lista para que tu jefatura la apruebe u observe. Si aún no está lista, usa «Guardar como borrador». Si te la observan, verás el comentario bajo la fila: corrige y vuelve a enviar. Lo aprobado queda bloqueado.'),
      paso(ajustes.circuitoActivo ? 7 : 6, 'Exporta y respalda', 'Usa "Exportar a Excel" para la entrega oficial. Usa "Respaldar (JSON)" para guardar una copia que puedas volver a importar aquí o enviar a Control de Gestión para consolidar.'),
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
      filaAsistente(),
      acercaDe()
    ],
    acciones: [{ texto: 'Entendido', clase: 'btn--primario', alHacerClic: (m) => m.cerrar() }]
  });
}

/**
 * «Acerca de la plataforma», al pie del modal de Ayuda: versión, autoría y
 * titularidad. La plataforma es de la institución y el aviso de derechos va a
 * su nombre; la autoría reconoce a quien la diseñó y desarrolló.
 */
function acercaDe() {
  const { autor, desde } = CONFIG.autoria ?? {};
  const hoy = new Date().getFullYear();
  const anios = desde && desde < hoy ? `${desde}–${hoy}` : String(desde || hoy);
  const unidad = (CONFIG.desarrollo ?? []).join(', ');

  return el('section', { class: 'ayuda__acerca', attrs: { 'aria-label': 'Acerca de la plataforma' } }, [
    el('p', { class: 'ayuda__acerca-titulo', text: 'Acerca de la plataforma' }),
    el('p', { class: 'ayuda__acerca-nombre', text: `Plataforma de Planificación · versión ${CONFIG.version}` }),
    autor && el('p', {}, [
      'Diseñada y desarrollada por ', el('strong', { text: autor }),
      unidad ? `, ${unidad}.` : '.'
    ]),
    el('p', { text: `© ${anios} ${CONFIG.institucion}. Uso institucional interno.` }),
    CONFIG.soporte && el('p', {}, [
      'Soporte: ', el('a', { href: `mailto:${CONFIG.soporte}`, text: CONFIG.soporte })
    ])
  ]);
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
