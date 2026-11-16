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
 */

import { el } from './dom.js';

let abierto = null; // { boton, menu, cerrar }

export function alternarMenu(boton, items) {
  if (abierto?.boton === boton) { abierto.cerrar({ devolverFoco: true }); return; }
  abierto?.cerrar();

  const opciones = [];
  const menu = el('div', { class: 'menu', attrs: { role: 'menu', 'aria-label': boton.textContent.trim() } },
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

  function ubicar() {
    const r = boton.getBoundingClientRect();
    const anchoPagina = document.documentElement.clientWidth;
    menu.style.top = `${r.bottom + scrollY + 6}px`;
    // Alineado al borde derecho del botón; si así se saldría por la izquierda
    // (en el celular el botón queda a la izquierda), al borde izquierdo.
    const ancho = menu.offsetWidth;
    let izquierda = r.right - ancho;
    if (izquierda < 8) izquierda = r.left;
    izquierda = Math.max(8, Math.min(izquierda, anchoPagina - ancho - 8));
    menu.style.left = `${izquierda + scrollX}px`;
  }

  function alPulsarFuera(e) {
    if (!menu.contains(e.target) && !boton.contains(e.target)) cerrar();
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

  function cerrar({ devolverFoco = false } = {}) {
    if (abierto?.menu !== menu) return;
    abierto = null;
    menu.remove();
    boton.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', alPulsarFuera, true);
    removeEventListener('resize', cerrarSinFoco);
    if (devolverFoco) boton.focus();
  }
  const cerrarSinFoco = () => cerrar();

  boton.setAttribute('aria-haspopup', 'menu');
  boton.setAttribute('aria-expanded', 'true');
  document.body.append(menu);
  ubicar();
  menu.addEventListener('keydown', alTeclear);
  document.addEventListener('pointerdown', alPulsarFuera, true);
  addEventListener('resize', cerrarSinFoco);
  abierto = { boton, menu, cerrar };
  opciones[0]?.focus({ preventScroll: true });
}

/** Cierra el menú abierto, si hay uno (por ejemplo, antes de redibujar). */
export function cerrarMenu() { abierto?.cerrar(); }
