/**
 * Componentes de interfaz: avisos (toasts), diálogos de confirmación y modales.
 * Reemplazan a `alert()` y `confirm()`, que bloquean el navegador y no son accesibles.
 */

import { el, render, vaciar, $ } from './dom.js';

/* ------------------------------------------------------------------ */
/* Avisos                                                              */
/* ------------------------------------------------------------------ */

let contenedorAvisos;

function zonaAvisos() {
  if (!contenedorAvisos) {
    // Región con nombre: el lector de pantalla la encuentra siempre en el mismo lugar.
    contenedorAvisos = el('div', {
      class: 'avisos',
      attrs: { role: 'region', 'aria-label': 'Avisos', 'aria-live': 'polite', 'aria-atomic': 'false' }
    });
    document.body.append(contenedorAvisos);
  }
  return contenedorAvisos;
}

const ICONOS = { exito: '✓', error: '!', info: 'i', alerta: '▲' };

/**
 * Muestra un aviso flotante.
 *
 * Los errores no se van solos: quedan hasta que se cierran, para que nadie se
 * pierda por qué algo no se guardó. Los demás se van al cumplir `duracion`,
 * pero la cuenta se detiene mientras el mouse o el foco están sobre el aviso.
 *
 * @param {string} mensaje
 * @param {'exito'|'error'|'info'|'alerta'} tipo
 */
export function avisar(mensaje, tipo = 'info', { duracion = 4200 } = {}) {
  const previo = document.activeElement;
  const aviso = el('div', { class: `aviso aviso--${tipo}` }, [
    el('span', { class: 'aviso__icono', text: ICONOS[tipo] || 'i', attrs: { 'aria-hidden': 'true' } }),
    el('p', { class: 'aviso__texto', text: mensaje }),
    el('button', {
      class: 'aviso__cerrar',
      text: '×',
      attrs: { type: 'button', 'aria-label': 'Cerrar aviso' },
      on: { click: () => cerrar() }
    })
  ]);

  let temporizador = null;
  let restante = tipo === 'error' ? 0 : duracion;
  let desde = 0;
  const correr = () => { if (restante > 0) { desde = performance.now(); temporizador = setTimeout(cerrar, restante); } };
  const pausar = () => {
    if (!temporizador) return;
    clearTimeout(temporizador);
    temporizador = null;
    restante = Math.max(1000, restante - (performance.now() - desde));
  };
  const reanudar = () => { if (!aviso.matches(':hover, :focus-within')) correr(); };

  let cerrado = false;
  function cerrar() {
    if (cerrado) return;
    cerrado = true;
    clearTimeout(temporizador);
    // Si el foco estaba en este aviso, pasa al siguiente o vuelve a donde estaba.
    if (aviso.contains(document.activeElement)) {
      const siguiente = [...zonaAvisos().children].find((a) => a !== aviso && !a.classList.contains('aviso--saliendo'));
      const destino = siguiente?.querySelector('.aviso__cerrar') || (previo?.isConnected ? previo : null);
      destino?.focus({ preventScroll: true });
    }
    aviso.classList.add('aviso--saliendo');
    aviso.addEventListener('animationend', () => aviso.remove(), { once: true });
  }

  aviso.addEventListener('pointerenter', pausar);
  aviso.addEventListener('pointerleave', reanudar);
  aviso.addEventListener('focusin', pausar);
  aviso.addEventListener('focusout', () => setTimeout(reanudar));

  zonaAvisos().append(aviso);
  correr();
  return cerrar;
}

/* ------------------------------------------------------------------ */
/* Fondo inactivo bajo una ventana                                     */
/* ------------------------------------------------------------------ */

/**
 * Deja inactivo (`inert`) todo lo que está detrás de `capa`: ni Tab ni el
 * lector de pantalla llegan ahí, así que no hace falta atrapar el foco a mano.
 * Devuelve la función que lo reactiva; las ventanas se cierran en orden
 * inverso, así que cada una reactiva solo lo que ella desactivó.
 *
 * Por qué no <dialog>: su capa superior quedaría encima de los avisos y del
 * «Cargando…», que tienen que verse mientras una ventana está abierta (por
 * ejemplo, los errores de validación de la hoja de edición).
 */
export function bloquearFondo(capa) {
  const nodos = [...document.body.children].filter((n) =>
    n !== capa && !n.inert && !n.matches('.avisos, .cargando, script, noscript'));
  for (const n of nodos) n.inert = true;
  return () => { for (const n of nodos) n.inert = false; };
}

/* ------------------------------------------------------------------ */
/* Modal genérico accesible                                            */
/* ------------------------------------------------------------------ */

const FOCUSABLES = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Abre un modal. Devuelve un objeto con `cerrar()` y la promesa `cerrado`.
 */
export function abrirModal({ titulo, contenido, acciones = [], ancho = '', alCerrar } = {}) {
  const previo = document.activeElement;
  const idTitulo = `modal-titulo-${Math.random().toString(36).slice(2, 8)}`;

  const cuerpo = el('div', { class: 'modal__cuerpo' }, [].concat(contenido));
  const pie = acciones.length
    ? el('div', { class: 'modal__pie' }, acciones.map((a) =>
        el('button', {
          class: `btn ${a.clase || 'btn--secundario'}`,
          text: a.texto,
          attrs: { type: 'button' },
          on: { click: () => a.alHacerClic?.(api) }
        })
      ))
    : null;

  const ventana = el('div', {
    class: 'modal__ventana',
    attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': idTitulo },
    style: ancho ? { maxWidth: ancho } : {}
  }, [
    el('header', { class: 'modal__cabecera' }, [
      el('h2', { id: idTitulo, class: 'modal__titulo', text: titulo }),
      el('button', {
        class: 'modal__cerrar',
        text: '×',
        attrs: { type: 'button', 'aria-label': 'Cerrar' },
        on: { click: () => cerrar() }
      })
    ]),
    cuerpo,
    pie
  ]);

  const fondo = el('div', { class: 'modal', on: { mousedown: (e) => { if (e.target === fondo) cerrar(); } } }, [ventana]);

  const alTeclear = (e) => {
    // Solo la ventana de más arriba responde a Esc: las de abajo quedaron inertes.
    if (e.key === 'Escape' && !fondo.inert) { e.preventDefault(); cerrar(); }
  };

  let resolver;
  const cerrado = new Promise((r) => { resolver = r; });
  let liberar = () => {};
  let abierto = true;

  function cerrar(valor) {
    if (!abierto) return;
    abierto = false;
    document.removeEventListener('keydown', alTeclear, true);
    liberar();
    fondo.classList.add('modal--saliendo');
    fondo.addEventListener('animationend', () => fondo.remove(), { once: true });
    document.body.classList.remove('sin-scroll');
    previo?.focus?.();
    alCerrar?.(valor);
    resolver(valor);
  }

  const api = { cerrar, ventana, cuerpo, cerrado };

  document.body.append(fondo);
  liberar = bloquearFondo(fondo);
  document.body.classList.add('sin-scroll');
  document.addEventListener('keydown', alTeclear, true);
  (ventana.querySelector(FOCUSABLES) || ventana).focus?.();

  return api;
}

/** Confirmación accesible. Devuelve una promesa booleana. */
export function confirmar({ titulo = '¿Confirmas la acción?', mensaje, textoConfirmar = 'Confirmar', peligro = false } = {}) {
  return new Promise((resolve) => {
    const modal = abrirModal({
      titulo,
      ancho: '440px',
      contenido: el('p', { class: 'texto-cuerpo', text: mensaje }),
      acciones: [
        { texto: 'Cancelar', clase: 'btn--secundario', alHacerClic: (m) => m.cerrar(false) },
        { texto: textoConfirmar, clase: peligro ? 'btn--peligro' : 'btn--primario', alHacerClic: (m) => m.cerrar(true) }
      ],
      alCerrar: (v) => resolve(Boolean(v))
    });
    // Foco inicial en Cancelar, para evitar confirmaciones accidentales.
    modal.ventana.querySelectorAll('.modal__pie .btn')[0]?.focus();
  });
}

/* ------------------------------------------------------------------ */
/* Estado de carga                                                     */
/* ------------------------------------------------------------------ */

export function mostrarCargando(texto = 'Procesando…') {
  const capa = el('div', { class: 'cargando', attrs: { role: 'status', 'aria-live': 'assertive' } }, [
    el('div', { class: 'cargando__spinner', attrs: { 'aria-hidden': 'true' } }),
    el('p', { class: 'cargando__texto', text: texto })
  ]);
  document.body.append(capa);
  return () => capa.remove();
}

/* ------------------------------------------------------------------ */
/* Tema claro / oscuro                                                 */
/* ------------------------------------------------------------------ */

const CLAVE_TEMA = 'seremi.tema';

export function temaActual() {
  try {
    return localStorage.getItem(CLAVE_TEMA) || 'auto';
  } catch {
    return 'auto';
  }
}

const temaDelSistema = () => (matchMedia('(prefers-color-scheme: dark)').matches ? 'oscuro' : 'claro');

/** Pinta el tema indicado ('auto' sigue al sistema). No guarda nada. */
export function aplicarTema(tema = temaActual()) {
  const efectivo = tema === 'auto' ? temaDelSistema() : tema;
  document.documentElement.dataset.tema = efectivo;
  document.documentElement.style.colorScheme = efectivo === 'oscuro' ? 'dark' : 'light';
  return efectivo;
}

/**
 * Cambia al tema contrario al que se ve. Si ese tema es el del sistema, se
 * borra la preferencia y la plataforma vuelve a seguir al sistema; si no, se
 * guarda tal cual. Así siempre hay forma de volver a «automático».
 */
export function alternarTema() {
  const objetivo = document.documentElement.dataset.tema === 'oscuro' ? 'claro' : 'oscuro';
  const tema = objetivo === temaDelSistema() ? 'auto' : objetivo;
  try {
    if (tema === 'auto') localStorage.removeItem(CLAVE_TEMA);
    else localStorage.setItem(CLAVE_TEMA, tema);
  } catch { /* modo privado: el cambio dura hasta recargar */ }
  aplicarTema(tema);
  return tema;
}

/** Otra pestaña cambió el tema: se sigue el cambio. */
addEventListener('storage', (e) => { if (e.key === CLAVE_TEMA) aplicarTema(temaActual()); });

export { render, vaciar, $ };
