/**
 * Utilidades de DOM seguras.
 *
 * Regla del proyecto: NUNCA se construye HTML concatenando datos del usuario.
 * Todo texto proveniente de una actividad se inserta con `textContent`,
 * lo que elimina por diseño la posibilidad de inyección de scripts (XSS).
 */

/** Atajo de querySelector con raíz opcional. */
export const $ = (sel, root = document) => root.querySelector(sel);

/** Atajo de querySelectorAll que devuelve un array real. */
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/**
 * Crea un elemento de forma declarativa y segura.
 *
 * @param {string} tag         Etiqueta HTML.
 * @param {object} [props]     Propiedades: class, text, html (solo literales de
 *                             confianza), attrs, dataset, on (eventos), style.
 * @param {Array}  [children]  Hijos: nodos o strings (los strings se insertan como texto).
 * @returns {HTMLElement}
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  const { class: cls, className, text, html, attrs, dataset, on, style, ...rest } = props;

  if (cls || className) node.className = cls || className;
  if (text != null) node.textContent = String(text);
  if (html != null) node.innerHTML = html; // solo para literales estáticos del propio código
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v !== false && v != null) node.setAttribute(k, v === true ? '' : String(v));
  }
  if (dataset) for (const [k, v] of Object.entries(dataset)) node.dataset[k] = String(v);
  if (style) Object.assign(node.style, style);
  if (on) for (const [evt, fn] of Object.entries(on)) node.addEventListener(evt, fn);
  for (const [k, v] of Object.entries(rest)) node[k] = v;

  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** Vacía un nodo sin usar innerHTML. */
export function vaciar(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** Reemplaza el contenido de un nodo por los hijos indicados. */
export function render(node, ...children) {
  vaciar(node);
  node.append(...children.flat().filter(Boolean));
  return node;
}

/** Rellena un <select> a partir de una lista de opciones. */
export function llenarSelect(select, opciones, { placeholder, valor = '', deshabilitado = false } = {}) {
  vaciar(select);
  if (placeholder != null) select.append(el('option', { value: '', text: placeholder }));
  for (const op of opciones) {
    const value = typeof op === 'string' ? op : op.value;
    const label = typeof op === 'string' ? op : op.label;
    select.append(el('option', { value, text: label, title: label }));
  }
  select.value = valor;
  select.disabled = deshabilitado;
  return select;
}

/** Delegación de eventos: un solo listener para muchos elementos. */
export function delegar(root, evento, selector, handler) {
  root.addEventListener(evento, (e) => {
    const target = e.target.closest(selector);
    if (target && root.contains(target)) handler(e, target);
  });
}

/** Ejecuta fn cuando el DOM está listo. */
export function alCargar(fn) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
  else fn();
}

/** Debounce sencillo para entradas de texto y redimensionados. */
export function debounce(fn, ms = 200) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
