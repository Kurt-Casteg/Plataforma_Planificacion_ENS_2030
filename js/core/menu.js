/**
 * Menú desplegable anclado a un botón (versión 3.21).
 *
 * Para acciones secundarias que no merecen una ventana completa, como «Más» en
 * el listado: se abre bajo el botón, se recorre con las flechas, se cierra con
 * Esc, con Tab o al hacer clic fuera, y al elegir una opción se cierra ANTES de
 * ejecutarla (así «Imprimir» no se lleva el menú al papel).
 *
 *   alternarMenu(boton, [
 *     { texto: 'Exportar a CSV', alElegir: () => … },
 *     { separador: true },
 *     { texto: 'Vaciar', peligro: true, alElegir: () => … }
 *   ]);
 *
 * Es un `popover="auto"`: el navegador lo pone sobre todo lo demás (sin pelear
 * con z-index) y lo cierra con Esc o con un clic fuera. Donde hay anclaje CSS
 * (`position-area`), el CSS lo ubica bajo el botón y lo da vuelta si no cabe;
 * donde no, se ubica desde aquí y se cierra al desplazar la página.
 */

import { el } from './dom.js';

const ANCLA = '--menu-abierto';
const conPopover = Object.hasOwn(HTMLElement.prototype, 'popover');
const conAnclaje = conPopover && (globalThis.CSS?.supports?.('position-area: block-end') ?? false);

let abierto = null; // { boton, menu, cerrar }
/** El clic fuera que cierra el menú llega antes que el clic en su propio botón. */
let ultimoCierre = { boton: null, en: 0 };

export function alternarMenu(boton, items) {
  if (abierto?.boton === boton) { abierto.cerrar({ devolverFoco: true }); return; }
  // Ese mismo clic en el botón ya lo cerró como «clic fuera»: no se reabre.
  if (ultimoCierre.boton === boton && performance.now() - ultimoCierre.en < 400) return;
  abierto?.cerrar();

  const opciones = [];
  const menu = el('div', { class: 'menu', attrs: { popover: conPopover ? 'auto' : null, role: 'menu', 'aria-label': boton.textContent.trim() } },
    items.filter(Boolean).map((it) => {
      if (it.separador) return el('div', { class: 'menu__separador', attrs: { role: 'separator' } });
      const b = el('button', {
        class: `menu__item${it.peligro ? ' menu__item--peligro' : ''}`,
        attrs: { type: 'button', role: 'menuitem', tabindex: '-1' },
        text: it.texto,
        on: { click: () => { cerrar(); it.alElegir?.(); } }
      });
      opciones.push(b);
      return b;
    }));

  /** Sin anclaje CSS: bajo el botón, alineado a su borde derecho y dentro de la pantalla. */
  function ubicar() {
    const r = boton.getBoundingClientRect();
    const anchoPagina = document.documentElement.clientWidth;
    const ancho = menu.offsetWidth;
    let izquierda = r.right - ancho;
    if (izquierda < 8) izquierda = r.left;
    izquierda = Math.max(8, Math.min(izquierda, anchoPagina - ancho - 8));
    let arriba = r.bottom + 6;
    if (arriba + menu.offsetHeight > innerHeight - 8 && r.top - menu.offsetHeight - 6 > 8) arriba = r.top - menu.offsetHeight - 6;
    menu.style.left = `${izquierda}px`;
    menu.style.top = `${arriba}px`;
  }

  /** Solo sin popover: el clic fuera lo resuelve el navegador en los demás. */
  function alPulsarFuera(e) {
    if (!menu.contains(e.target) && !boton.contains(e.target)) cerrar({ porClicFuera: true });
  }

  function alTeclear(e) {
    const i = opciones.indexOf(document.activeElement);
    const ir = (n) => { e.preventDefault(); opciones[(n + opciones.length) % opciones.length]?.focus(); };
    if (e.key === 'ArrowDown') ir(i + 1);
    else if (e.key === 'ArrowUp') ir(i - 1);
    else if (e.key === 'Home') ir(0);
    else if (e.key === 'End') ir(opciones.length - 1);
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrar({ devolverFoco: true }); }
    else if (e.key === 'Tab') cerrar();
  }

  function cerrar({ devolverFoco = false, porClicFuera = false } = {}) {
    if (abierto?.menu !== menu) return;
    abierto = null;
    if (porClicFuera) ultimoCierre = { boton, en: performance.now() };
    const teniaFoco = menu.contains(document.activeElement);
    if (conPopover && menu.matches(':popover-open')) menu.hidePopover();
    menu.remove();
    boton.setAttribute('aria-expanded', 'false');
    boton.style.removeProperty('anchor-name');
    document.removeEventListener('pointerdown', alPulsarFuera, true);
    removeEventListener('resize', cerrarSinFoco);
    removeEventListener('scroll', cerrarSinFoco, true);
    if (devolverFoco || teniaFoco) boton.focus({ preventScroll: true });
  }
  const cerrarSinFoco = () => cerrar();

  boton.setAttribute('aria-haspopup', 'menu');
  boton.setAttribute('aria-expanded', 'true');
  // Justo después de su botón: así el navegador no le agrega una relación aria-details.
  boton.after(menu);
  if (conAnclaje) boton.style.setProperty('anchor-name', ANCLA);
  menu.addEventListener('keydown', alTeclear);
  if (conPopover) {
    // Esc o clic fuera, resueltos por el navegador.
    menu.addEventListener('toggle', (e) => { if (e.newState === 'closed') cerrar({ porClicFuera: true }); });
    // `source`: el botón queda como su invocador (un clic en él no cuenta como «fuera»).
    menu.showPopover({ source: boton });
  } else {
    document.addEventListener('pointerdown', alPulsarFuera, true);
  }
  if (!conAnclaje) {
    ubicar();
    addEventListener('scroll', cerrarSinFoco, { capture: true, passive: true });
  }
  addEventListener('resize', cerrarSinFoco);
  abierto = { boton, menu, cerrar };
  opciones[0]?.focus({ preventScroll: true });
}

/** Cierra el menú abierto, si hay uno (por ejemplo, antes de redibujar). */
export function cerrarMenu() { abierto?.cerrar(); }
