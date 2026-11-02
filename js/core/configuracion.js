/**
 * «Más» → «Configuración de la plataforma» (solo Control de Gestión).
 *
 * Tres interruptores sin tocar código:
 *  - El circuito de aprobación por jefatura (y su plazo de envío).
 *  - El análisis del Plan Anual de Compras.
 *  - Dentro del análisis, los datos que dependen de Adquisiciones y de
 *    Presupuesto: los plazos mínimos de compra (holgura) y el marco del
 *    subtítulo 22 por departamento. Si se dejan vacíos, esos bloques no se
 *    muestran; el resto del análisis sigue funcionando.
 *
 * Lo que se guarda aquí vale para toda la institución desde la próxima vez que
 * cada persona cargue la página (y al instante en esta).
 */

import { el } from './dom.js';
import { abrirModal, avisar } from './ui.js';
import { ajustes } from './ajustes.js';
import { perfil } from './perfil.js';
import { periodo } from './periodo.js';

function interruptor({ id, marcado, texto, ayuda }) {
  const entrada = el('input', { class: 'interruptor__entrada', id, attrs: { type: 'checkbox' } });
  entrada.checked = Boolean(marcado);
  const etiqueta = el('label', { class: 'interruptor interruptor--pac', attrs: { for: id } }, [
    entrada,
    el('span', { class: 'interruptor__control', attrs: { 'aria-hidden': 'true' } }),
    el('span', { class: 'interruptor__texto' }, [
      texto,
      ayuda && el('span', { class: 'interruptor__ayuda', text: ayuda })
    ])
  ]);
  return { entrada, etiqueta };
}

const campoNumero = (valor, etiqueta, { placeholder = '' } = {}) => el('input', {
  class: 'campo__control', value: valor ?? '',
  attrs: { type: 'number', min: '0', step: '1', inputmode: 'numeric', placeholder, 'aria-label': etiqueta }
});

export function abrirConfiguracion({ catalogos }) {
  const nube = perfil.nube;
  if (!nube || !perfil.esControlDeGestion) {
    avisar('Solo Control de Gestión, con sesión iniciada, puede cambiar la configuración.', 'alerta');
    return;
  }

  const anio = String(periodo.anio);
  const apr = ajustes.aprobacion;
  const pac = ajustes.analisisPac;

  /* --- Circuito de aprobación --- */
  const swAprobacion = interruptor({
    id: 'cfgAprobacion', marcado: apr.activa,
    texto: 'Exigir la aprobación de la jefatura',
    ayuda: 'Los equipos envían sus actividades a revisión y la jefatura de su departamento las aprueba u observa. Lo aprobado queda bloqueado.'
  });
  const plazo = el('input', { class: 'campo__control', id: 'cfgPlazo', value: apr.plazo || '', attrs: { type: 'date' } });

  /* --- Análisis del PAC --- */
  const swPac = interruptor({
    id: 'cfgPac', marcado: pac.activo,
    texto: 'Mostrar el análisis del Plan Anual de Compras',
    ayuda: 'Calendario de compras y compras parecidas entre departamentos, bajo el Panel de análisis.'
  });

  // Holgura: tramos de monto con su plazo mínimo.
  const cuerpoTramos = el('tbody');
  const agregarTramo = (t = {}) => {
    const fila = el('tr', {}, [
      el('td', {}, [campoNumero(t.hasta, 'Monto hasta, en miles de pesos', { placeholder: 'Sin tope' })]),
      el('td', {}, [campoNumero(t.dias, 'Días mínimos entre compra y ejecución')]),
      el('td', {}, [el('button', {
        class: 'btn btn--fantasma btn--chico', attrs: { type: 'button', 'aria-label': 'Quitar este tramo' }, text: 'Quitar',
        on: { click: () => fila.remove() }
      })])
    ]);
    cuerpoTramos.append(fila);
  };
  (Array.isArray(pac.holgura) ? pac.holgura : []).forEach(agregarTramo);

  // Marco del subtítulo 22 por departamento, para el período en uso.
  const marcoActual = pac.marco?.[anio] ?? {};
  const entradasMarco = (catalogos?.departamentos ?? []).map((d) => ({
    id: d.id,
    entrada: campoNumero(marcoActual[d.id], `Marco del subtítulo 22 de ${d.nombre}, en miles de pesos`, { placeholder: '—' }),
    nombre: d.nombre
  }));

  const contenido = el('div', { class: 'config' }, [
    el('section', { class: 'config__bloque' }, [
      el('h3', { class: 'config__titulo', text: 'Circuito de aprobación' }),
      swAprobacion.etiqueta,
      el('div', { class: 'campo config__campo' }, [
        el('label', { class: 'campo__etiqueta', attrs: { for: 'cfgPlazo' }, text: 'Plazo para enviar a revisión (opcional)' }),
        plazo,
        el('p', { class: 'campo__ayuda', text: 'Se muestra a los equipos y a las jefaturas. No bloquea nada.' })
      ]),
      el('p', { class: 'config__nota', text: 'Apagarlo no borra nada: los estados y el historial quedan guardados y vuelven a regir si se enciende otra vez. Mientras esté apagado, todos pueden editar como antes.' })
    ]),

    el('section', { class: 'config__bloque' }, [
      el('h3', { class: 'config__titulo', text: 'Análisis del Plan Anual de Compras' }),
      swPac.etiqueta,

      el('h4', { class: 'config__subtitulo', text: 'Plazos mínimos de Adquisiciones (holgura)' }),
      el('p', { class: 'config__nota', text: 'Días mínimos entre la fecha de compra y la de ejecución, según el monto. Ordénalos de menor a mayor; deja «Sin tope» en el último. Si no hay tramos, el bloque de holgura no aparece.' }),
      el('div', { class: 'tabla__contenedor' }, [
        el('table', { class: 'tabla config__tabla' }, [
          el('thead', {}, [el('tr', {}, [
            el('th', { text: 'Monto hasta (M$)', attrs: { scope: 'col' } }),
            el('th', { text: 'Días mínimos', attrs: { scope: 'col' } }),
            el('th', { text: '', attrs: { scope: 'col' } })
          ])]),
          cuerpoTramos
        ])
      ]),
      el('button', {
        class: 'btn btn--secundario btn--chico', attrs: { type: 'button' }, text: 'Agregar tramo',
        on: { click: () => agregarTramo() }
      }),

      el('h4', { class: 'config__subtitulo', text: `Marco presupuestario del subtítulo 22 · ${anio}` }),
      el('p', { class: 'config__nota', text: 'Monto en miles de pesos por departamento. Los que queden vacíos no se comparan. Si todos quedan vacíos, el bloque del marco no aparece.' }),
      el('div', { class: 'config__marco' }, entradasMarco.map((m) => el('label', { class: 'config__marco-fila' }, [
        el('span', { text: m.nombre }), m.entrada
      ])))
    ])
  ]);

  const leerTramos = () => [...cuerpoTramos.querySelectorAll('tr')].map((tr) => {
    const [hasta, dias] = tr.querySelectorAll('input');
    return { hasta: hasta.value === '' ? null : Number(hasta.value), dias: dias.value === '' ? null : Number(dias.value) };
  }).filter((t) => t.hasta !== null || t.dias !== null);

  const guardar = async (modal, boton) => {
    const tramos = leerTramos();
    if (tramos.some((t) => !Number.isFinite(t.dias) || t.dias <= 0)) {
      avisar('Cada tramo de holgura necesita sus días mínimos (un número mayor que cero).', 'alerta');
      return;
    }
    if (tramos.filter((t) => t.hasta === null).length > 1) {
      avisar('Solo un tramo puede quedar «Sin tope».', 'alerta');
      return;
    }
    tramos.sort((a, b) => (a.hasta ?? Infinity) - (b.hasta ?? Infinity));

    const marcoAnio = {};
    for (const m of entradasMarco) {
      const v = Number(m.entrada.value);
      if (m.entrada.value !== '' && Number.isFinite(v) && v > 0) marcoAnio[m.id] = v;
    }
    const marco = { ...(pac.marco || {}) };
    if (Object.keys(marcoAnio).length) marco[anio] = marcoAnio; else delete marco[anio];

    if (boton) boton.disabled = true;
    try {
      await ajustes.guardar(nube, 'aprobacion', { activa: swAprobacion.entrada.checked, plazo: plazo.value || null });
      await ajustes.guardar(nube, 'analisisPac', { activo: swPac.entrada.checked, holgura: tramos, marco });
      modal.cerrar();
      avisar('Configuración guardada. Rige para todos desde que vuelvan a cargar la página.', 'exito', { duracion: 6000 });
    } catch (e) {
      console.error(e);
      avisar(e?.message || 'No se pudo guardar la configuración.', 'error', { duracion: 9000 });
    } finally {
      if (boton) boton.disabled = false;
    }
  };

  abrirModal({
    titulo: 'Configuración de la plataforma',
    ancho: '680px',
    contenido,
    acciones: [
      { texto: 'Cancelar', clase: 'btn--secundario', alHacerClic: (m) => m.cerrar() },
      {
        texto: 'Guardar configuración', clase: 'btn--primario',
        alHacerClic: (m) => guardar(m, document.activeElement?.closest?.('button'))
      }
    ]
  });
}
