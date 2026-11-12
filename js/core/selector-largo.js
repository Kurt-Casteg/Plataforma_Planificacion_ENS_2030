/**
 * Selector para listas de textos largos (versión 3.19).
 *
 * Los resultados inmediatos de la ENS tienen en promedio 170 caracteres y
 * algunos pasan de 600. La lista nativa del navegador muestra cada opción en
 * una sola línea y la corta en el borde de la pantalla; cerrada, solo deja ver
 * lo que cabe en el recuadro. Este selector reemplaza SOLO lo que se ve:
 *
 *  - Cerrado: el código destacado y el texto en hasta dos líneas.
 *  - Abierto: un panel bajo el campo, con cada opción completa en los renglones
 *    que necesite, y un buscador cuando hay muchas opciones.
 *
 * El <select> original sigue en su lugar, oculto, y es la única fuente de la
 * verdad: el formulario lo llena, lo lee, lo valida y le marca errores como
 * siempre. Este módulo solo lo observa y, al elegir, le asigna el valor y
 * dispara `input` y `change`, igual que si la persona lo hubiera usado.
 *
 * El panel va en el flujo de la página (empuja lo de abajo) y no flotando:
 * las secciones del formulario recortan lo que se sale de ellas, y así
 * funciona igual en el formulario clásico, en el lateral y en la hoja de
 * edición.
 */

import { el } from './dom.js';

const normalizar = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** «1.4.2 — Texto» → { codigo: '1.4.2', texto: 'Texto' }. Sin código, todo es texto. */
function partir(etiqueta) {
  const m = /^(\S+)\s+—\s+([\s\S]*)$/.exec(etiqueta.trim());
  return m ? { codigo: m[1], texto: m[2] } : { codigo: '', texto: etiqueta.trim() };
}

/** El texto con las coincidencias de la búsqueda envueltas en <mark>. */
function resaltar(texto, consulta) {
  const q = normalizar(consulta.trim());
  if (!q) return [texto];
  const base = normalizar(texto);
  const partes = [];
  let i = 0;
  while (i < texto.length) {
    const j = base.indexOf(q, i);
    if (j < 0) { partes.push(texto.slice(i)); break; }
    if (j > i) partes.push(texto.slice(i, j));
    partes.push(el('mark', { class: 'selector-largo__coincidencia', text: texto.slice(j, j + q.length) }));
    i = j + q.length;
  }
  return partes;
}

let contador = 0;

/**
 * Convierte un <select> ya insertado en su campo en un selector de textos largos.
 * @param {HTMLSelectElement} select
 * @param {object} [o]
 * @param {number} [o.umbralBuscador] Desde cuántas opciones aparece el buscador.
 * @returns {{ refrescar: Function, cerrar: Function }}
 */
export function mejorarSelect(select, { umbralBuscador = 8 } = {}) {
  const id = select.id || `selector-${++contador}`;
  const etiqueta = select.closest('.campo')?.querySelector(`label[for="${id}"]`);
  if (etiqueta && !etiqueta.id) etiqueta.id = `${id}-etiqueta`;
  const idPanel = `${id}-lista`;

  select.classList.add('selector-largo__nativo');
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');

  const codigo = el('span', { class: 'selector-largo__codigo' });
  const texto = el('span', { class: 'selector-largo__texto' });
  const disparador = el('button', {
    class: 'campo__control selector-largo__disparador',
    attrs: {
      type: 'button', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-controls': idPanel,
      'aria-labelledby': [etiqueta?.id, `${id}-valor`].filter(Boolean).join(' '),
      'aria-describedby': select.getAttribute('aria-describedby') || ''
    }
  }, [codigo, texto]);
  texto.id = `${id}-valor`;

  const panel = el('div', { class: 'selector-largo__panel', id: idPanel, attrs: { hidden: true } });
  const contenedor = el('div', { class: 'selector-largo' }, [disparador, panel]);
  select.after(contenedor);

  let abierto = false;
  let consulta = '';
  let buscador = null;
  let lista = null;

  const opciones = () => [...select.options].filter((o) => o.value).map((o) => ({ valor: o.value, ...partir(o.textContent) }));

  function refrescar() {
    const op = select.selectedOptions[0];
    const tiene = Boolean(select.value);
    const partes = partir(op?.textContent || '');
    codigo.textContent = tiene ? partes.codigo : '';
    codigo.hidden = !tiene || !partes.codigo;
    texto.textContent = tiene ? partes.texto : (op?.textContent || '');
    disparador.classList.toggle('selector-largo__disparador--vacio', !tiene);
    disparador.disabled = select.disabled;
    const invalido = select.getAttribute('aria-invalid');
    if (invalido) disparador.setAttribute('aria-invalid', invalido); else disparador.removeAttribute('aria-invalid');
    if (abierto && (select.disabled || !opciones().length)) cerrar();
  }

  // El formulario cambia el <select> por código (lo llena, le asigna valor, lo
  // reinicia): todas esas vías terminan llamando a refrescar.
  let pendiente = false;
  const programar = () => {
    if (pendiente) return;
    pendiente = true;
    queueMicrotask(() => { pendiente = false; refrescar(); });
  };
  for (const prop of ['value', 'selectedIndex']) {
    const d = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, prop);
    Object.defineProperty(select, prop, {
      configurable: true,
      get() { return d.get.call(this); },
      set(v) { d.set.call(this, v); programar(); }
    });
  }
  new MutationObserver(programar).observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'aria-invalid'] });
  select.addEventListener('change', programar);
  document.addEventListener('reset', (e) => { if (e.target.contains?.(select)) setTimeout(refrescar); }, true);
  // Quien lleve el foco al <select> (validación, asistente, la etiqueta) llega al botón.
  select.addEventListener('focus', () => disparador.focus({ preventScroll: true }));

  function pintarLista() {
    const todas = opciones();
    const q = normalizar(consulta.trim());
    const visibles = q ? todas.filter((o) => normalizar(`${o.codigo} ${o.texto}`).includes(q)) : todas;
    lista.replaceChildren(...visibles.map((o) => {
      const elegida = o.valor === select.value;
      return el('button', {
        class: `selector-largo__opcion${elegida ? ' selector-largo__opcion--elegida' : ''}`,
        attrs: { type: 'button', role: 'option', 'aria-selected': elegida ? 'true' : 'false', tabindex: '-1' },
        dataset: { valor: o.valor },
        on: { click: () => elegir(o.valor) }
      }, [
        o.codigo && el('span', { class: 'selector-largo__opcion-codigo', text: o.codigo }),
        el('span', { class: 'selector-largo__opcion-texto' }, resaltar(o.texto, consulta)),
        el('span', { class: 'selector-largo__marca', attrs: { 'aria-hidden': 'true' }, text: elegida ? '✓' : '' })
      ].filter(Boolean));
    }));
    if (!visibles.length) {
      lista.append(el('p', { class: 'selector-largo__vacio', text: `Ninguna opción contiene «${consulta.trim()}».` }));
    }
  }

  function abrir() {
    if (abierto || select.disabled) return;
    const todas = opciones();
    if (!todas.length) return;
    abierto = true;
    consulta = '';
    const conBuscador = todas.length > umbralBuscador;
    lista = el('div', { class: 'selector-largo__lista', attrs: { role: 'listbox', 'aria-labelledby': etiqueta?.id || '' } });
    buscador = conBuscador
      ? el('input', {
          class: 'campo__control selector-largo__buscador',
          attrs: { type: 'search', autocomplete: 'off', 'aria-label': `Buscar entre ${todas.length} opciones`, placeholder: `Buscar entre ${todas.length} opciones…` },
          on: { input: (e) => { consulta = e.target.value; pintarLista(); } }
        })
      : null;
    panel.replaceChildren(...[buscador, lista].filter(Boolean));
    pintarLista();
    panel.hidden = false;
    disparador.setAttribute('aria-expanded', 'true');
    contenedor.classList.add('selector-largo--abierto');
    document.addEventListener('pointerdown', alPulsarFuera, true);
    requestAnimationFrame(() => {
      if (buscador) buscador.focus({ preventScroll: true });
      else (lista.querySelector('[aria-selected="true"]') || lista.querySelector('[role="option"]'))?.focus({ preventScroll: true });
      // Que el panel quede a la vista, sin esconderse bajo la barra de botones
      // (el margen está en la hoja de estilos: scroll-margin del panel).
      panel.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    });
  }

  function cerrar({ devolverFoco = false } = {}) {
    if (!abierto) return;
    abierto = false;
    panel.hidden = true;
    panel.replaceChildren();
    buscador = lista = null;
    disparador.setAttribute('aria-expanded', 'false');
    contenedor.classList.remove('selector-largo--abierto');
    document.removeEventListener('pointerdown', alPulsarFuera, true);
    if (devolverFoco) disparador.focus({ preventScroll: true });
  }

  function elegir(valor) {
    const cambia = valor !== select.value;
    select.value = valor;
    cerrar({ devolverFoco: true });
    if (cambia) {
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function alPulsarFuera(e) {
    if (!contenedor.contains(e.target)) cerrar();
  }

  function mover(paso, desde) {
    const ops = [...panel.querySelectorAll('[role="option"]')];
    if (!ops.length) return;
    let i = ops.indexOf(desde);
    if (paso === 'inicio') i = 0;
    else if (paso === 'fin') i = ops.length - 1;
    else i = i < 0 ? (paso > 0 ? 0 : ops.length - 1) : Math.max(0, Math.min(ops.length - 1, i + paso));
    ops[i].focus();
  }

  disparador.addEventListener('click', () => (abierto ? cerrar() : abrir()));
  disparador.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); abrir(); }
  });
  panel.addEventListener('keydown', (e) => {
    const enBuscador = e.target === buscador;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrar({ devolverFoco: true }); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); mover(enBuscador ? 'inicio' : 1, e.target); return; }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const primera = panel.querySelector('[role="option"]');
      if (!enBuscador && e.target === primera && buscador) buscador.focus(); else if (!enBuscador) mover(-1, e.target);
      return;
    }
    if (!enBuscador && (e.key === 'Home' || e.key === 'End')) { e.preventDefault(); mover(e.key === 'Home' ? 'inicio' : 'fin', e.target); return; }
    // Escribir sobre la lista lleva al buscador.
    if (!enBuscador && buscador && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { buscador.focus(); }
  });
  contenedor.addEventListener('focusout', (e) => {
    if (abierto && e.relatedTarget && !contenedor.contains(e.relatedTarget)) cerrar();
  });

  refrescar();
  return { refrescar, cerrar };
}
