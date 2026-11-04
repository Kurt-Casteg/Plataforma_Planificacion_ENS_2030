/**
 * Modo enfoque: una ficha agrandada al centro, con el resto difuminado.
 *
 * Lo usan la ficha de una actividad (desde el listado o la bandeja de la
 * jefatura) y los gráficos ampliados del Panel de análisis. A diferencia de un
 * diálogo común:
 *
 *  - Crece desde el elemento en que se hizo clic (la fila, la tarjeta), para
 *    que se entienda de dónde salió y adónde vuelve.
 *  - Puede cambiar de contenido sin cerrarse: «Siguiente» y «Anterior»
 *    deslizan la ficha nueva, y también las flechas ← → del teclado.
 *  - Por debajo de un diálogo común: si desde la ficha se abre uno (observar,
 *    confirmar), ese queda encima y el teclado le pertenece a él.
 *
 * Accesibilidad: es un diálogo modal (`role="dialog"`, `aria-modal`), atrapa
 * el foco con Tab, se cierra con Esc y devuelve el foco a donde estaba. Quien
 * pidió reducir el movimiento en su sistema la ve aparecer sin animación.
 */

import { el, render } from './dom.js';

const FOCUSABLES = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

const sinMovimiento = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const CURVA = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

/** ¿Hay un diálogo común abierto encima? Entonces el teclado es suyo. */
const hayDialogoEncima = () => Boolean(document.querySelector('.modal:not(.modal--saliendo)'));

/** ¿La tecla se está escribiendo en un campo? Entonces las flechas son del campo. */
const escribiendo = (nodo) => nodo instanceof HTMLElement &&
  (nodo.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(nodo.tagName));

/**
 * @param {object} o
 * @param {string}   o.etiqueta     Nombre accesible del diálogo.
 * @param {Element}  [o.origen]     Desde dónde crece (fila, tarjeta).
 * @param {string}   [o.ancho]      Ancho máximo de la ficha.
 * @param {string}   [o.clase]      Clase extra para la ventana.
 * @param {Function} [o.alNavegar]  (paso: -1 | 1) → ← y → del teclado.
 * @param {Function} [o.alCerrar]
 * @returns {{ mostrar: Function, cerrar: Function, ventana: HTMLElement, abierto: boolean }}
 */
export function abrirEnfoque({ etiqueta, origen = null, ancho = '920px', clase = '', alNavegar, alCerrar } = {}) {
  const previo = document.activeElement;

  const ventana = el('div', {
    class: `enfoque__ventana ${clase}`.trim(),
    attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': etiqueta, tabindex: '-1' },
    style: { maxWidth: ancho }
  });
  const fondo = el('div', {
    class: 'enfoque',
    on: { mousedown: (e) => { if (e.target === fondo) cerrar(); } }
  }, [ventana]);

  const api = { ventana, abierto: true, mostrar, cerrar };

  /**
   * Pone (o reemplaza) el contenido. `direccion` 1 o -1 lo desliza desde la
   * derecha o la izquierda, como al pasar a la ficha siguiente o anterior.
   */
  function mostrar({ cabecera, cuerpo, pie, etiqueta: nueva, direccion = 0 }) {
    const teniaFoco = ventana.contains(document.activeElement);
    render(ventana,
      cabecera,
      el('div', { class: 'enfoque__cuerpo' }, [].concat(cuerpo).filter(Boolean)),
      pie
    );
    if (nueva) ventana.setAttribute('aria-label', nueva);
    if (direccion && !sinMovimiento()) {
      ventana.animate(
        [{ opacity: 0, transform: `translateX(${direccion * 48}px)` }, { opacity: 1, transform: 'none' }],
        { duration: 260, easing: CURVA }
      );
    }
    // El botón que se pulsó (Siguiente, Aprobar) ya no existe: el foco vuelve
    // a la ficha para que el teclado no se pierda en la página de fondo.
    if (teniaFoco && !ventana.contains(document.activeElement)) ventana.focus();
  }

  function alTeclear(e) {
    if (!api.abierto || hayDialogoEncima()) return;
    if (e.key === 'Escape') { e.preventDefault(); cerrar(); return; }
    if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && alNavegar &&
        !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && !escribiendo(e.target)) {
      e.preventDefault();
      alNavegar(e.key === 'ArrowRight' ? 1 : -1);
      return;
    }
    if (e.key !== 'Tab') return;
    const focos = Array.from(ventana.querySelectorAll(FOCUSABLES)).filter((n) => n.offsetParent !== null);
    if (!focos.length) { e.preventDefault(); ventana.focus(); return; }
    const primero = focos[0];
    const ultimo = focos[focos.length - 1];
    if (e.shiftKey && (document.activeElement === primero || document.activeElement === ventana)) { e.preventDefault(); ultimo.focus(); }
    else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
  }

  function cerrar() {
    if (!api.abierto) return;
    api.abierto = false;
    document.removeEventListener('keydown', alTeclear, true);
    document.body.classList.remove('con-enfoque');
    const quitar = () => fondo.remove();
    if (sinMovimiento()) quitar();
    else {
      fondo.classList.add('enfoque--saliendo');
      ventana.animate(
        [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.96)' }],
        { duration: 170, easing: 'ease-in', fill: 'forwards' }
      ).finished.then(quitar, quitar);
    }
    if (previo && document.contains(previo)) previo.focus?.();
    alCerrar?.();
  }

  document.body.append(fondo);
  document.body.classList.add('con-enfoque');
  document.addEventListener('keydown', alTeclear, true);

  /**
   * Entrada: la ficha parte con la forma y la posición del origen y crece
   * hasta su lugar (técnica FLIP). Se llama después del primer `mostrar`,
   * cuando ya se puede medir.
   */
  api.entrar = () => {
    ventana.focus({ preventScroll: true });
    if (sinMovimiento()) return;
    fondo.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' });
    const destino = ventana.getBoundingClientRect();
    const desde = origen?.isConnected ? origen.getBoundingClientRect() : null;
    let inicio = 'scale(0.94)';
    if (desde && desde.width && destino.width) {
      const dx = (desde.left + desde.width / 2) - (destino.left + destino.width / 2);
      const dy = (desde.top + desde.height / 2) - (destino.top + destino.height / 2);
      const sx = Math.min(1, Math.max(0.3, desde.width / destino.width));
      const sy = Math.min(1, Math.max(0.06, desde.height / destino.height));
      inicio = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
    }
    ventana.animate(
      [
        { transform: inicio, opacity: 0.2 },
        { opacity: 1, offset: 0.55 },
        { transform: 'none', opacity: 1 }
      ],
      { duration: 340, easing: CURVA }
    );
  };

  return api;
}

/** Barra de navegación «‹ Anterior · 2 de 5 · Siguiente ›» para el pie. */
export function navegacionEnfoque({ indice, total, alMover, nombre = '' }) {
  if (total < 2) return null;
  return el('div', { class: 'enfoque__navegacion' }, [
    el('button', {
      class: 'btn btn--secundario', attrs: { type: 'button', 'aria-label': `${nombre || 'Elemento'} anterior` },
      text: '‹ Anterior', on: { click: () => alMover(-1) }
    }),
    el('span', { class: 'enfoque__posicion', attrs: { 'aria-live': 'polite' }, text: `${indice + 1} de ${total}` }),
    el('button', {
      class: 'btn btn--secundario', attrs: { type: 'button', 'aria-label': `${nombre || 'Elemento'} siguiente` },
      text: 'Siguiente ›', on: { click: () => alMover(1) }
    })
  ]);
}
