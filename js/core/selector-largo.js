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
 * Desde la 3.19.2 el panel FLOTA sobre lo que está debajo, sin empujarlo.
 * Antes de abrirse mide el espacio libre entre el campo y la barra de botones
 * (o el borde de la hoja o del panel lateral): si abajo no caben unas cuantas
 * opciones y arriba hay más espacio, se abre hacia arriba, y la lista toma el
 * alto que quepa. En el celular se abre como una hoja desde abajo.
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

const LUPA = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>';
const ALTO_MAXIMO = 380;
const ALTO_MINIMO = 140;
const esCelular = () => matchMedia('(max-width: 640px)').matches;

/** El contenedor más cercano que recorta lo que se sale (hoja de edición, panel lateral). */
function contenedorQueRecorta(nodo) {
  for (let n = nodo.parentElement; n && n !== document.body; n = n.parentElement) {
    if (getComputedStyle(n).overflowY !== 'visible') return n;
  }
  return null;
}

/**
 * Convierte un <select> ya insertado en su campo en un selector de textos largos.
 * @param {HTMLSelectElement} select
 * @param {object} [o]
 * @param {'nunca'|'siempre'|number} [o.buscador] Cuándo aparece el buscador:
 *   nunca, siempre, o desde cuántas opciones (por omisión, más de 8).
 * @param {boolean} [o.compacto] Una sola línea y del ancho del contenido: para
 *   filtros y la cabecera (3.20).
 * @param {boolean} [o.incluirVacio] La opción sin valor («Todos los…») es una
 *   elección más de la lista, como en los filtros.
 * @returns {{ refrescar: Function, cerrar: Function }}
 */
export function mejorarSelect(select, { buscador: reglaBuscador = 8, compacto = false, incluirVacio = false } = {}) {
  const id = select.id || `selector-${++contador}`;
  const etiqueta = select.closest('.campo')?.querySelector(`label[for="${id}"]`);
  if (etiqueta && !etiqueta.id) etiqueta.id = `${id}-etiqueta`;
  const nombreAccesible = etiqueta ? '' : (select.getAttribute('aria-label') || '');
  const idPanel = `${id}-lista`;

  // Las clases propias de la lista (por ejemplo, las de la cabecera) pasan al
  // botón, para que conserve su aspecto.
  const clasesPropias = [...select.classList].filter((c) => c !== 'campo__control');
  select.classList.add('selector-largo__nativo');
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');
  // El <select> oculto se ubica contra su contenedor, no contra la página. Si
  // la lista todavía no está en la página (la cabecera se arma antes de
  // insertarse), se revisa en el cuadro siguiente.
  const anclar = () => {
    const padre = select.parentElement;
    if (padre && padre.isConnected && getComputedStyle(padre).position === 'static') padre.style.position = 'relative';
  };
  anclar();
  requestAnimationFrame(anclar);

  const codigo = el('span', { class: 'selector-largo__codigo' });
  const texto = el('span', { class: 'selector-largo__texto' });
  const disparador = el('button', {
    class: ['campo__control', 'selector-largo__disparador', ...clasesPropias].join(' '),
    attrs: {
      type: 'button', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-controls': idPanel,
      'aria-labelledby': etiqueta ? `${etiqueta.id} ${id}-valor` : null,
      'aria-describedby': select.getAttribute('aria-describedby') || null
    }
  }, [codigo, texto]);
  if (nombreAccesible) disparador.setAttribute('aria-label', nombreAccesible);
  texto.id = `${id}-valor`;

  const panel = el('div', { class: 'selector-largo__panel', id: idPanel, attrs: { hidden: true } });
  // Solo se ve en el celular, detrás de la hoja que sube desde abajo.
  const fondo = el('div', { class: 'selector-largo__fondo', attrs: { 'aria-hidden': 'true' }, on: { click: () => cerrar({ devolverFoco: true }) } });
  const contenedor = el('div', { class: `selector-largo${compacto ? ' selector-largo--compacto' : ''}` }, [disparador, fondo, panel]);
  select.after(contenedor);

  let abierto = false;
  let consulta = '';
  let buscador = null;
  let lista = null;

  // Las opciones, con el título de su grupo cuando la lista viene agrupada
  // (<optgroup>, como el clasificador presupuestario del PAC).
  const opciones = () => [...select.options]
    .filter((o) => o.value || (incluirVacio && o.textContent.trim()))
    .map((o) => ({ valor: o.value, grupo: o.parentElement?.tagName === 'OPTGROUP' ? o.parentElement.label : '', ...partir(o.textContent) }));

  function refrescar() {
    const op = select.selectedOptions[0];
    const tiene = Boolean(select.value) || (incluirVacio && Boolean(op?.textContent.trim()));
    const partes = partir(op?.textContent || '');
    codigo.textContent = tiene ? partes.codigo : '';
    codigo.hidden = !tiene || !partes.codigo;
    texto.textContent = tiene ? partes.texto : (op?.textContent || '');
    // El texto completo al pasar el mouse, por si no cabe en dos líneas.
    disparador.title = tiene ? (op?.textContent || '').trim() : '';
    disparador.classList.toggle('selector-largo__disparador--vacio', !tiene);
    disparador.disabled = select.disabled;
    const invalido = select.getAttribute('aria-invalid');
    if (invalido) disparador.setAttribute('aria-invalid', invalido); else disparador.removeAttribute('aria-invalid');
    // La lista puede estar oculta (la cabecera la muestra solo a algunos
    // perfiles) y llevar marcas de estado que tiñen el botón.
    contenedor.hidden = select.hidden;
    for (const [k, v] of Object.entries(select.dataset)) disparador.dataset[k] = v;
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
  new MutationObserver(programar).observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'aria-invalid', 'hidden', 'data-solest', 'data-distinto'] });
  select.addEventListener('change', programar);
  const alReiniciar = (e) => {
    // Un selector que ya no está en la página (una compra quitada) suelta el escucha.
    if (!select.isConnected) { document.removeEventListener('reset', alReiniciar, true); return; }
    if (e.target.contains?.(select)) setTimeout(refrescar);
  };
  document.addEventListener('reset', alReiniciar, true);
  // Quien lleve el foco al <select> (validación, asistente, la etiqueta) llega al botón.
  select.addEventListener('focus', () => disparador.focus({ preventScroll: true }));

  function pintarLista() {
    const todas = opciones();
    const q = normalizar(consulta.trim());
    const visibles = q ? todas.filter((o) => normalizar(`${o.codigo} ${o.texto} ${o.grupo}`).includes(q)) : todas;
    let grupoActual = null;
    lista.replaceChildren(...visibles.flatMap((o) => {
      const elegida = o.valor === select.value;
      const titulo = o.grupo && o.grupo !== grupoActual
        ? el('p', { class: 'selector-largo__grupo', attrs: { role: 'presentation' }, text: o.grupo })
        : null;
      grupoActual = o.grupo;
      return [titulo, el('button', {
        class: `selector-largo__opcion${elegida ? ' selector-largo__opcion--elegida' : ''}`,
        attrs: { type: 'button', role: 'option', 'aria-selected': elegida ? 'true' : 'false', tabindex: '-1' },
        dataset: { valor: o.valor },
        on: { click: () => elegir(o.valor) }
      }, [
        o.codigo && el('span', { class: 'selector-largo__opcion-codigo', text: o.codigo }),
        el('span', { class: 'selector-largo__opcion-texto' }, resaltar(o.texto, consulta)),
        el('span', { class: 'selector-largo__marca', attrs: { 'aria-hidden': 'true' }, text: elegida ? '✓' : '' })
      ].filter(Boolean))].filter(Boolean);
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
    const conBuscador = reglaBuscador === 'siempre' || (reglaBuscador !== 'nunca' && todas.length > Number(reglaBuscador));
    lista = el('div', { class: 'selector-largo__lista', attrs: { role: 'listbox', 'aria-labelledby': etiqueta?.id || null, 'aria-label': etiqueta ? null : (nombreAccesible || null) } });
    let busqueda = null;
    if (conBuscador) {
      buscador = el('input', {
        class: 'selector-largo__buscador',
        attrs: { type: 'search', autocomplete: 'off', 'aria-label': `Buscar entre ${todas.length} opciones`, placeholder: `Buscar entre ${todas.length} opciones…` },
        on: { input: (e) => { consulta = e.target.value; pintarLista(); } }
      });
      busqueda = el('label', { class: 'selector-largo__busqueda' }, [el('span', { class: 'selector-largo__lupa', html: LUPA }), buscador]);
    } else buscador = null;
    panel.replaceChildren(...[busqueda, lista].filter(Boolean));
    pintarLista();
    panel.hidden = false;
    // En el celular la lista es una hoja fija al pie de la pantalla. Un ancestro
    // con transform (la sección activa, el panel lateral) haría que «fija» se
    // mida contra él, así que mientras está abierta vive en <body>.
    if (esCelular()) {
      document.body.append(fondo, panel);
      fondo.classList.add('selector-largo__fondo--visible');
      document.body.classList.add('con-selector-abierto');
    }
    ubicar();
    disparador.setAttribute('aria-expanded', 'true');
    contenedor.classList.add('selector-largo--abierto');
    document.addEventListener('pointerdown', alPulsarFuera, true);
    addEventListener('resize', alCambiarTamano);
    requestAnimationFrame(() => {
      if (buscador) buscador.focus({ preventScroll: true });
      else (lista.querySelector('[aria-selected="true"]') || lista.querySelector('[role="option"]'))?.focus({ preventScroll: true });
    });
  }

  /**
   * Decide hacia dónde se abre y cuánto alto tiene la lista, según el espacio
   * libre entre el campo y lo que lo limita: la cabecera fija y la barra de
   * botones del formulario, o los bordes de la hoja o del panel lateral.
   */
  function ubicar() {
    panel.classList.remove('selector-largo__panel--arriba');
    lista.style.maxHeight = '';
    if (esCelular()) return; // la hoja que sube desde abajo tiene su propio alto
    const r = disparador.getBoundingClientRect();
    let tope = 0;
    let piso = innerHeight;
    const scroll = contenedorQueRecorta(contenedor);
    if (scroll) {
      const c = scroll.getBoundingClientRect();
      tope = Math.max(tope, c.top);
      piso = Math.min(piso, c.bottom);
    }
    const cabecera = document.querySelector('.cabecera');
    if (cabecera && !scroll) tope = Math.max(tope, cabecera.getBoundingClientRect().bottom);
    const barra = contenedor.closest('form')?.querySelector('.formulario__acciones');
    if (barra) {
      const b = barra.getBoundingClientRect();
      if (b.top > r.bottom && b.top < piso) piso = b.top;
    }
    const abajo = piso - r.bottom - 14;
    const arriba = r.top - tope - 14;
    const haciaArriba = abajo < 280 && arriba > abajo;
    const extra = (panel.querySelector('.selector-largo__busqueda')?.offsetHeight || 0) + 16;
    const alto = Math.max(ALTO_MINIMO, Math.min(ALTO_MAXIMO, (haciaArriba ? arriba : abajo) - extra));
    panel.classList.toggle('selector-largo__panel--arriba', haciaArriba);
    lista.style.maxHeight = `${alto}px`;
    // Un panel más ancho que su campo (los compactos) no se sale por la derecha.
    panel.classList.remove('selector-largo__panel--derecha');
    if (panel.getBoundingClientRect().right > document.documentElement.clientWidth - 8) panel.classList.add('selector-largo__panel--derecha');
  }

  function alCambiarTamano() { cerrar(); }

  function cerrar({ devolverFoco = false } = {}) {
    if (!abierto) return;
    abierto = false;
    panel.hidden = true;
    panel.replaceChildren();
    if (panel.parentElement !== contenedor) {
      fondo.classList.remove('selector-largo__fondo--visible');
      document.body.classList.remove('con-selector-abierto');
      contenedor.append(fondo, panel);
    }
    buscador = lista = null;
    disparador.setAttribute('aria-expanded', 'false');
    contenedor.classList.remove('selector-largo--abierto');
    panel.classList.remove('selector-largo__panel--arriba', 'selector-largo__panel--derecha');
    document.removeEventListener('pointerdown', alPulsarFuera, true);
    removeEventListener('resize', alCambiarTamano);
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

  const dentro = (n) => Boolean(n) && (contenedor.contains(n) || panel.contains(n));
  function alPulsarFuera(e) {
    if (!dentro(e.target) || e.target === fondo) cerrar();
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
  const alSalirFoco = (e) => { if (abierto && e.relatedTarget && !dentro(e.relatedTarget)) cerrar(); };
  contenedor.addEventListener('focusout', alSalirFoco);
  panel.addEventListener('focusout', alSalirFoco);

  refrescar();
  return { refrescar, cerrar };
}
