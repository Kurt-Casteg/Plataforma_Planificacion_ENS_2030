/**
 * Hoja lateral: un panel que entra desde la derecha sobre la página, que
 * queda visible (apenas oscurecida) detrás.
 *
 * La usa «Editar» del listado: el formulario se abre en la hoja y, al guardar
 * o cancelar, la hoja se va y el listado sigue exactamente donde estaba. Ya no
 * hay que subir hasta el formulario y volver a bajar a buscar la fila.
 *
 * Es un diálogo modal: atrapa el foco con Tab, Esc pide cerrarla y al cerrar
 * devuelve el foco a donde estaba. Quien decide si se puede cerrar (por
 * ejemplo, si hay cambios sin guardar) es quien la abrió, con `alPedirCerrar`.
 */

import { el } from './dom.js';

const FOCUSABLES = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
const sinMovimiento = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const CURVA = 'cubic-bezier(0.22, 0.8, 0.2, 1)';

/** Un diálogo común (confirmar), la ficha en modo enfoque o una lista abiertos encima: el teclado es suyo. */
// También una lista de la cadena ENS abierta (3.19.2): su Esc la cierra a ella, no a la hoja.
const hayAlgoEncima = () => Boolean(document.querySelector('.modal:not(.modal--saliendo), .enfoque:not(.enfoque--saliendo), .selector-largo--abierto'));

/**
 * @param {object} o
 * @param {string}   o.etiqueta        Nombre accesible.
 * @param {string}   o.titulo          Texto grande de la cabecera.
 * @param {string}   [o.subtitulo]
 * @param {Function} o.alPedirCerrar   × , Esc o clic en el fondo.
 */
export function abrirHoja({ etiqueta, titulo, subtitulo = '', alPedirCerrar }) {
  const previo = document.activeElement;
  const idTitulo = `hoja-titulo-${Math.random().toString(36).slice(2, 8)}`;

  const cuerpo = el('div', { class: 'hoja__cuerpo' });
  const panel = el('div', {
    class: 'hoja__panel',
    attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': idTitulo, 'aria-label': etiqueta, tabindex: '-1' }
  }, [
    el('header', { class: 'hoja__cabecera' }, [
      el('div', { class: 'hoja__textos' }, [
        el('p', { class: 'hoja__etiqueta', text: etiqueta }),
        el('h2', { class: 'hoja__titulo', id: idTitulo, text: titulo }),
        subtitulo && el('p', { class: 'hoja__subtitulo', text: subtitulo })
      ]),
      el('button', {
        class: 'enfoque__cerrar', attrs: { type: 'button', 'aria-label': 'Cerrar la hoja de edición' }, text: '×',
        on: { click: () => alPedirCerrar?.() }
      })
    ]),
    cuerpo
  ]);
  const fondo = el('div', {
    class: 'hoja',
    on: { mousedown: (e) => { if (e.target === fondo) alPedirCerrar?.(); } }
  }, [panel]);

  const api = { cuerpo, panel, abierta: true, cerrar, entrar };

  function alTeclear(e) {
    if (!api.abierta || hayAlgoEncima()) return;
    if (e.key === 'Escape') { e.preventDefault(); alPedirCerrar?.(); return; }
    if (e.key !== 'Tab') return;
    const focos = Array.from(panel.querySelectorAll(FOCUSABLES)).filter((n) => n.offsetParent !== null && !n.closest('[inert]'));
    if (!focos.length) return;
    const primero = focos[0];
    const ultimo = focos[focos.length - 1];
    if (e.shiftKey && (document.activeElement === primero || document.activeElement === panel)) { e.preventDefault(); ultimo.focus(); }
    else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
  }

  function entrar() {
    panel.focus({ preventScroll: true });
    if (sinMovimiento()) return;
    fondo.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: 'ease-out' });
    panel.animate([{ transform: 'translateX(100%)' }, { transform: 'none' }], { duration: 420, easing: CURVA });
  }

  function cerrar() {
    if (!api.abierta) return;
    api.abierta = false;
    document.removeEventListener('keydown', alTeclear, true);
    document.body.classList.remove('con-hoja');
    const quitar = () => fondo.remove();
    if (sinMovimiento()) quitar();
    else {
      fondo.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, easing: 'ease-in', fill: 'forwards' });
      panel.animate([{ transform: 'none' }, { transform: 'translateX(100%)' }], { duration: 300, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' })
        .finished.then(quitar, quitar);
    }
    if (previo && document.contains(previo)) previo.focus?.({ preventScroll: true });
  }

  document.body.append(fondo);
  document.body.classList.add('con-hoja');
  document.addEventListener('keydown', alTeclear, true);
  return api;
}
