/*
 * Aplica el tema guardado (o el del sistema) ANTES de que la página se pinte.
 * Por eso es un script común en <head>, sin `type="module"` ni `defer`: los
 * módulos corren después de pintar y quien usa modo oscuro vería un destello
 * claro. No va escrito dentro del HTML porque la política de seguridad no
 * permite scripts en línea. El resto del manejo del tema está en core/ui.js.
 */
(function () {
  var guardado = null;
  try { guardado = localStorage.getItem('seremi.tema'); } catch (e) { /* sin almacenamiento */ }
  var oscuro = guardado === 'oscuro' ||
    (guardado !== 'claro' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.tema = oscuro ? 'oscuro' : 'claro';
})();
