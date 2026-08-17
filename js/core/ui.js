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
    contenedorAvisos = el('div', {
      class: 'avisos',
      attrs: { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'false' }
    });
    document.body.append(contenedorAvisos);
  }
  return contenedorAvisos;
}

const ICONOS = { exito: '✓', error: '!', info: 'i', alerta: '▲' };

/**
 * Muestra un aviso flotante.
 * @param {string} mensaje
 * @param {'exito'|'error'|'info'|'alerta'} tipo
 */
export function avisar(mensaje, tipo = 'info', { duracion = 4200 } = {}) {
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

  const cerrar = () => {
    aviso.classList.add('aviso--saliendo');
    aviso.addEventListener('animationend', () => aviso.remove(), { once: true });
  };

  zonaAvisos().append(aviso);
  if (duracion) setTimeout(cerrar, duracion);
  return cerrar;
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
    if (e.key === 'Escape') { e.preventDefault(); cerrar(); return; }
    if (e.key !== 'Tab') return;
    const focos = Array.from(ventana.querySelectorAll(FOCUSABLES)).filter((n) => n.offsetParent !== null);
    if (!focos.length) return;
    const primero = focos[0];
    const ultimo = focos[focos.length - 1];
    if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
    else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
  };

  let resolver;
  const cerrado = new Promise((r) => { resolver = r; });

  function cerrar(valor) {
    document.removeEventListener('keydown', alTeclear, true);
    fondo.classList.add('modal--saliendo');
    fondo.addEventListener('animationend', () => fondo.remove(), { once: true });
    document.body.classList.remove('sin-scroll');
    previo?.focus?.();
    alCerrar?.(valor);
    resolver(valor);
  }

  const api = { cerrar, ventana, cuerpo, cerrado };

  document.body.append(fondo);
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

export function aplicarTema(tema = temaActual()) {
  const efectivo = tema === 'auto'
    ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'oscuro' : 'claro')
    : tema;
  document.documentElement.dataset.tema = efectivo;
  document.documentElement.style.colorScheme = efectivo === 'oscuro' ? 'dark' : 'light';
  try { localStorage.setItem(CLAVE_TEMA, tema); } catch { /* modo privado */ }
  return efectivo;
}

export function alternarTema() {
  const siguiente = document.documentElement.dataset.tema === 'oscuro' ? 'claro' : 'oscuro';
  return aplicarTema(siguiente);
}

export { render, vaciar, $ };
