# Plataforma de Planificación · SEREMI de Salud de Ñuble

Herramienta web para que los equipos de la SEREMI planifiquen, registren, revisen
y exporten sus actividades anuales, tanto del **Plan Nacional de Salud** (alineado
a la cadena de resultados de la Estrategia Nacional de Salud 2021-2030) como del
**Plan de Gestión Institucional**.

No requiere instalación, servidor propio ni compilación: son archivos estáticos
que se publican en GitHub Pages y se abren en cualquier navegador moderno.

---

## Qué hace

- Formulario guiado por secciones, con validación y mensajes claros.
- Cadena de resultados ENS con listas dependientes (OE → Tema → OI → RE → RI) y
  el **indicador oficial** del resultado esperado a la vista mientras se planifica.
- Cronograma mensual y presupuesto por subtítulo 21 y 22, con totales automáticos.
- Listado con búsqueda, filtros, detalle, edición, duplicado y eliminación.
- Panel de análisis con indicadores clave y gráficos que se actualizan solos.
- Exportación a **Excel** (dos hojas: datos y resumen por departamento), **CSV** y
  **respaldo JSON** reimportable.
- Modo claro y oscuro, teclado completo y accesibilidad.
- Funciona sin conexión a internet; opcionalmente sincroniza a una base de datos
  compartida para que Control de Gestión consolide sin pedir archivos.

---

## Cómo se organiza

```
.
├── index.html              Único HTML. No contiene campos ni lógica.
├── config.js               ⭐ Lo único que se edita para configurar el despliegue.
│
├── data/                   Los datos, separados del código.
│   ├── catalogos.json        Departamentos, tipos, componentes, programas, subtítulos.
│   ├── ens-2026.json         Cadena de resultados ENS (9 OE · 52 temas · 145 RE · 836 RI).
│   └── indicadores-re-2026.json  215 indicadores oficiales por resultado esperado.
│
├── js/
│   ├── app.js              Orquestador: une las piezas y define las acciones.
│   ├── plans/index.js      ⭐ Definición declarativa de los planes (qué campos tiene cada uno).
│   └── core/
│       ├── modelo.js         Forma del dato, normalización, validación.
│       ├── almacen.js        Guardado, migración desde versiones anteriores, fusión.
│       ├── formulario.js     Construye el formulario a partir de la definición del plan.
│       ├── tabla.js          Listado, búsqueda, filtros y detalle.
│       ├── panel.js          Indicadores y gráficos.
│       ├── exportar.js       Excel, CSV, respaldo e importación.
│       ├── catalogos.js      Carga y consulta de los catálogos.
│       ├── nube.js           Sincronización opcional (Supabase).
│       ├── sesion.js         Inicio de sesión, solo si la nube está activa.
│       ├── ui.js             Avisos, modales, confirmaciones, tema.
│       ├── dom.js            Utilidades para construir interfaz de forma segura.
│       └── formato.js        Números, montos y fechas en formato chileno.
│
├── css/
│   ├── tokens.css          ⭐ Colores, tipografía y espaciado. Cambiar la identidad visual se hace aquí.
│   └── app.css             Estilos de los componentes.
│
├── vendor/                 Chart.js y SheetJS servidos desde el propio sitio.
├── assets/                 Logotipo.
└── docs/                   Guías, esquema SQL y ⭐ nomina.sql (quién usa la plataforma).
```

**Las dos estrellas** marcan los archivos que se tocan para operar la plataforma
sin programar: `config.js` (parámetros del despliegue) y `js/plans/index.js`
(qué campos pide cada plan).

---

## Cómo probarla en tu computador

No hace falta compilar nada, pero sí servirla por HTTP (los navegadores bloquean
la carga de datos si se abre el archivo con doble clic):

```bash
# Con Python (viene instalado en la mayoría de los equipos)
python -m http.server 8000

# O con Node
npx serve .
```

Luego abre <http://localhost:8000>.

---

## Cómo publicarla

Ver **[docs/GUIA-DESPLIEGUE.md](docs/GUIA-DESPLIEGUE.md)**. Resumen: subir la carpeta
al repositorio, activar GitHub Pages con origen «GitHub Actions», y cada `git push`
publica la nueva versión automáticamente.

---

## Tareas frecuentes

| Necesito… | Archivo a editar |
|---|---|
| Cambiar el año del ciclo de planificación | `config.js` → `anio` |
| Agregar o renombrar un departamento | `data/catalogos.json` → `departamentos` |
| Agregar un tipo de actividad | `data/catalogos.json` → `tiposActividad` |
| Actualizar la cadena de resultados ENS | `data/ens-2026.json` |
| Actualizar los indicadores oficiales | `data/indicadores-re-2026.json` |
| Agregar un campo al formulario | `js/plans/index.js` |
| Agregar un tercer plan | `js/plans/index.js` (un objeto más en `PLANES`) |
| Cambiar colores o tipografía | `css/tokens.css` |
| Activar la base de datos compartida | `config.js` → `nube` + `docs/GUIA-SUPABASE.md` |
| Agregar o mover a una persona | `docs/nomina.sql` |

---

## Decisiones técnicas

**Sin compilación.** JavaScript moderno con módulos nativos del navegador. Se
publica tal cual, cualquier persona del equipo puede editarlo sin instalar Node,
y no hay un paso intermedio que se pueda olvidar antes de desplegar.

**Los datos no son código.** Los catálogos y la cadena de resultados ENS viven en
archivos JSON. Actualizar los lineamientos del año siguiente ya no significa
editar un archivo de programación de 492 KB, y el navegador solo descarga el
catálogo grande cuando alguien entra al Plan Nacional de Salud.

**Un núcleo, planes declarativos.** Los dos planes comparten todo el motor
(formulario, cronograma, presupuesto, listado, panel, exportación) y se
diferencian solo por su definición de campos. Antes eran dos aplicaciones con
código duplicado que había que corregir dos veces.

**Sin HTML construido con datos del usuario.** Todo el texto que proviene de una
actividad se inserta con `textContent`, nunca concatenando HTML. Eso elimina por
diseño la inyección de scripts, y la política de seguridad de contenido declarada
en `index.html` cierra el resto.

**Los totales se recalculan siempre.** Nunca se confía en el total que venga
guardado, importado o sincronizado: se deriva de los meses cada vez que el dato
entra al sistema.

**Local primero.** La plataforma funciona completa sin internet. La nube es una
capa opcional que se enchufa detrás de la misma interfaz del almacén, sin que el
resto del código se entere.

---

## Compatibilidad

Chrome, Edge, Firefox y Safari en sus versiones de los últimos tres años
(se requiere soporte de módulos ES y campos privados de clase).

---

## Créditos

Departamento de Control de Gestión y Calidad Institucional
SEREMI de Salud de Ñuble
