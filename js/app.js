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
import { cargarCatalogos, cargarENS, cargarIndicadores, indexarENS } from './core/catalogos.js';
import { PLANES, planPorId } from './plans/index.js';
import { Formulario } from './core/formulario.js';
import { TablaActividades } from './core/tabla.js';
import { Panel } from './core/panel.js';
import { avisar, confirmar, abrirModal, aplicarTema, alternarTema, temaActual, mostrarCargando } from './core/ui.js';
import { exportarExcel, exportarCSV, exportarJSON, leerRespaldo } from './core/exportar.js';
import { numero } from './core/formato.js';
import { perfil } from './core/perfil.js';
import { siguienteCodigo, previsualizarCodigo } from './core/codigos.js';

const estado = {
  plan: null,
  catalogos: null,
  ens: null,
  ensIndex: null,
  indicadores: {},
  formulario: null,
  tabla: null,
  panel: null
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

  if (CONFIG.nube.habilitada) {
    // La capa de nube solo se descarga si está activada en config.js.
    import('./core/sesion.js')
      .then((m) => m.iniciarSesionEnLaNube({ indicador: $('#indicadorAlmacen') }))
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
          el('span', {
            class: 'indicador-almacen', id: 'indicadorAlmacen',
            dataset: { estado: CONFIG.nube.habilitada ? 'nube' : 'local' },
            text: CONFIG.nube.habilitada ? 'Sincronizado' : 'Guardado en este equipo',
            attrs: { title: CONFIG.nube.habilitada
              ? 'Las actividades se sincronizan con el repositorio institucional.'
              : 'Las actividades se guardan en este navegador. Exporta un respaldo periódicamente.' }
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
    previsualizarCodigo: () => previsualizarCodigo(almacen.porPlan(plan.id)),
    alGuardar: guardarActividad
  });

  estado.tabla = new TablaActividades({
    contenedor: $('#zonaTabla'),
    plan,
    catalogos: estado.catalogos,
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
      actividad.codigoActividad = await siguienteCodigo({
        plan: actividad.plan,
        anio: CONFIG.anio,
        actividadesLocales: almacen.porPlan(actividad.plan)
      });
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
    el('button', {
      class: 'btn btn--secundario', attrs: { type: 'button' }, text: 'Importar',
      on: { click: importar }
    }),
    el('button', {
      class: 'btn btn--fantasma', attrs: { type: 'button' }, text: 'Más',
      on: { click: mostrarMasAcciones }
    })
  );
}

function refrescar() {
  if (!estado.plan) return;
  const actividades = almacen.porPlan(estado.plan.id);
  estado.tabla?.actualizar(actividades);
  estado.panel?.actualizar(actividades);
  // El próximo código previsto cambia con cada alta o baja.
  estado.formulario?.aplicarPerfil();
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
      el('button', {
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
    ])
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
      paso(4, 'Revisa y ajusta', 'En "Actividades registradas" puedes buscar, ver el detalle, editar, duplicar o eliminar. El panel de análisis se actualiza solo.'),
      paso(5, 'Exporta y respalda', 'Usa "Exportar a Excel" para la entrega oficial. Usa "Respaldar (JSON)" para guardar una copia que puedas volver a importar aquí o enviar a Control de Gestión para consolidar.'),
      el('div', { class: 'nota nota--info' }, [
        el('p', {}, [
          el('strong', { text: 'Importante: ' }),
          CONFIG.nube.habilitada
            ? 'Tus actividades se sincronizan con el repositorio institucional.'
            : 'Las actividades se guardan en este navegador y en este equipo. Genera un respaldo antes de limpiar el historial o cambiar de computador.'
        ])
      ])
    ],
    acciones: [{ texto: 'Entendido', clase: 'btn--primario', alHacerClic: (m) => m.cerrar() }]
  });
}
