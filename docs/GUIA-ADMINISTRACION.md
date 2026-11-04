# Guía de administración

Cómo mantener la plataforma al día sin programar. Cada tarea indica exactamente
qué archivo abrir y qué escribir.

Después de cualquier cambio:

```bash
git add .
git commit -m "Describe el cambio"
git push
```

y en un par de minutos queda publicado.

---

## Comenzar un nuevo ciclo de planificación (cambiar el año)

Abre `config.js` y cambia el número:

```js
anio: 2027,
```

Con ese único cambio, desde la versión 3.9:

- **La nube** muestra y guarda solo las actividades del año nuevo. Las del año
  anterior **no se borran**: siguen en Supabase como historial, filtrables por
  la columna `anio`.
- **La numeración** de cada departamento empieza de nuevo en 1, porque los
  correlativos se llevan por plan, departamento y año.
- **Cada navegador** se limpia solo la próxima vez que alguien abre la
  plataforma: lo que tenía del año anterior se aparta a un archivo dentro del
  mismo navegador y la persona ve un aviso. No hay que pedirle a nadie que
  borre nada.
- **Nada se pierde.** Si alguien había registrado actividades sin sesión (que
  nunca llegaron a la nube), las puede descargar desde «Más → Descargar
  actividades del <año> archivadas en este navegador» y, si hiciera falta,
  volver a cargarlas con «Importar».

Lo que **no** cambia solo, y hay que revisar cada año:

- La cadena de resultados del año nuevo: `data/ens-<año>.json` e
  `indicadores-re-<año>.json`, cuando MINSAL publique los lineamientos. Ver
  «Actualizar la cadena de resultados ENS del año siguiente». El enlace a los
  Lineamientos y su texto ya se ajustan solos al año.
- `otrosPeriodos` en `config.js`: los años que Control de Gestión puede seguir
  abriendo con el selector «Período» (ver la sección siguiente). Lo habitual es
  dejar ahí el año que termina.

> **Si alguna vez hiciera falta borrar de verdad un año en la nube**, se hace
> desde el SQL Editor de Supabase, siempre después de respaldar:
>
> ```sql
> -- Respaldo en el esquema privado: una tabla en `public` quedaría expuesta por la API.
> create table privado.respaldo_actividades_2026 as select * from public.actividades where anio = 2026;
>
> begin;
> delete from public.actividades  where anio = 2026;
> delete from public.correlativos where anio = 2026;
> commit;
> ```
>
> Para empezar un ciclo nuevo no es necesario: basta cambiar el año.

---

## Trabajar en otro período (selector «Período», solo Control de Gestión)

Desde la versión 3.10, quien está con el perfil **Control de Gestión** ve en la
cabecera un selector **«Período 2027 (vigente)»** junto al de perfil. Sirve para
abrir un año que no es el vigente —revisar el ciclo anterior o seguir haciendo
pruebas en 2026— sin que nada se mezcle con el ciclo real.

Al elegir otro año, la plataforma se recarga y **todo** pasa a ese período:
listado, formulario, numeración correlativa, panel, exportaciones, informe e
impresión. Arriba aparece una franja azul fija: «Estás en el período 2026, no
en el vigente (2027)», con un botón **Volver al 2027**.

Reglas que conviene tener presentes:

- **Vale solo para esa pestaña.** Al cerrarla, o al abrir la plataforma en otra,
  vuelve al vigente. Nadie queda trabajando en otro año por olvido.
- **Los equipos nunca lo ven.** Trabajan siempre en el año de `anio`. Si en esa
  pestaña se cambia a un perfil que no es Control de Gestión, o se cierra
  sesión, la plataforma vuelve sola al vigente.
- **No se mezcla nada.** Lo que se registra en 2026 queda guardado con año
  2026, con la numeración del 2026, y no aparece en 2027. El navegador guarda
  una copia separada por período.
- **Cuidado con lo que se edita.** Es el mismo servidor de siempre: si se abre
  2026, lo que se edite o elimine ahí cambia los datos reales de 2026. Para
  pruebas desechables, conviene registrar actividades nuevas con un nombre que
  las delate («PRUEBA …») y borrarlas al terminar.

Qué años aparecen en el selector se decide en `config.js`:

```js
otrosPeriodos: [2026],
```

Para agregar otro, súmalo a la lista (`[2025, 2026]`). Para quitar el selector
por completo, déjala vacía: `otrosPeriodos: []`. El vigente siempre está y no
hace falta repetirlo.

---

## Agregar, renombrar o quitar un departamento

Abre `data/catalogos.json`, sección `departamentos`:

```json
{
  "id": "unidad_estadisticas",
  "nombre": "Unidad de Estadísticas Sanitarias",
  "nombreCorto": "Estadísticas"
}
```

- `id`: sin espacios, sin tildes, en minúsculas. **No lo cambies nunca** una vez
  que haya actividades guardadas con él: es la llave que las relaciona.
- `nombre`: como aparece en el formulario, el detalle y las exportaciones.
- `nombreCorto`: como aparece en los ejes de los gráficos, donde no cabe el
  nombre completo.

Para renombrar, cambia solo `nombre` y `nombreCorto`; deja el `id` intacto.

Para quitar uno, bórralo de la lista. Las actividades que ya lo usaban seguirán
mostrando el `id` crudo — mejor dejarlo y no ofrecerlo, si hay historial.

---

## Agregar un tipo de actividad o un componente transversal

Mismo archivo, secciones `tiposActividad` y `componentesTransversales`. Solo
necesitan `id` y `nombre`:

```json
{ "id": "auditoria", "nombre": "Auditoría" }
```

---

## Agregar un programa presupuestario

En `data/catalogos.json`, dentro de `programasPorCategoria`, busca la categoría
(`funcionamiento`, `emergentes`, `expansion` o `salud_ocupacional`) y agrega el
texto a la lista, respetando el formato existente:

```json
"funcionamiento": [
  "Continuidad / Cáncer",
  "Continuidad / Nueva Línea Programática"
]
```

---

## Actualizar la cadena de resultados ENS del año siguiente

Cada año tiene **su propio archivo**: `data/ens-2026.json`, `data/ens-2027.json`,
etc. La plataforma usa el del período con que se está trabajando, así que una
actividad 2026 abierta desde el selector de período se sigue leyendo con los
textos 2026, y una 2027 con los de 2027. Si un año no tiene archivo propio, se
usa el más reciente anterior.

La estructura es un árbol:

```
objetivosEstrategicos[]
  └── temas[]
        └── objetivosImpacto[]
              └── resultadosEsperados[]
                    └── resultadosInmediatos[]
```

Cada nivel tiene `codigo` y `nombre` (los temas solo `nombre`).

### Cómo se armó `ens-2027.json` (versión 3.12)

Se generó desde la planilla oficial `Lineamientos_temáticos_2027.xls` (hoja
«Informe Ambitos», filas con Periodo 2027 y Estado «activo»), con este criterio:

- **Objetivos estratégicos, temas y objetivos de impacto**: los mismos de 2026,
  con sus mismos códigos. Se tomó la redacción 2027 (por ejemplo, «migrantes» en
  vez de «inmigrantes» en el 6.3, y «con enfoque de equidad» en el 8.3).
- **Resultados esperados**: conservan su código 2026. El 2.10.2 (enfermedades
  poco frecuentes) mantiene el código con su redacción nueva. El único nuevo,
  «Fomentar la permanencia de especialistas en el sistema público», recibió el
  siguiente número de su objetivo de impacto: **8.2.4**.
- **Resultados inmediatos**: se numeran de nuevo desde 1 dentro de cada
  resultado esperado, en el orden de la planilla de MINSAL. Es el mismo criterio
  de 2026 (en 141 de 144 resultados esperados, el orden de la planilla 2026
  coincide con la numeración oficial). Por eso **un mismo código no significa lo
  mismo en 2026 y en 2027**: el 1.4.2.11 de 2026 ya no existe en 2027.
- El RE **1.4.2** aparece en dos temas («Enfermedades Transmisibles en
  Eliminación» e «Infecciones Respiratorias Agudas»), cada uno con sus propios
  RI. Así venía en 2026 y así se mantiene.
- Resultado: 9 OE · 52 temas · 52 OI · 146 RE · 824 RI, idénticos texto a texto
  a la planilla oficial.

Los indicadores (`indicadores-re-2027.json`) son los mismos de 2026: pertenecen
a la ENS 2021-2030 y se asocian por código de resultado esperado, que se
conservó. El RE nuevo 8.2.4 todavía no tiene indicadores; si MINSAL publica la
«Base maestra de indicadores RE» actualizada, se reemplaza ese archivo.

### Para el año siguiente

1. Pide que se genere `ens-<año>.json` desde la planilla oficial con el mismo
   criterio (o copia el del año anterior y edítalo).
2. Copia o actualiza `indicadores-re-<año>.json`.
3. En `js/core/catalogos.js`, agrega el año a `ANIOS_CON_ENS`.

> No borres los archivos de años anteriores: las actividades de esos años
> guardan los códigos y se leen con su propio catálogo.

---

## Agregar un campo al formulario

Abre `js/plans/index.js`. Busca la sección donde debe ir y agrega un objeto:

```js
{
  id: 'poblacionObjetivo',
  tipo: 'texto',
  etiqueta: 'Población objetivo',
  placeholder: 'Ej: adolescentes de 10 a 19 años',
  ancho: 'completo'
}
```

Tipos disponibles:

| `tipo` | Qué dibuja |
|---|---|
| `texto` | Una línea de texto |
| `correo` | Una línea con validación de correo |
| `textoLargo` | Un área de varias líneas (usa `filas: 3`) |
| `select` | Lista desplegable (requiere `catalogo: 'nombreDeLaLista'`) |

Anchos: `chico`, `medio` (por omisión) o `completo`.

Para hacerlo obligatorio, agrega `requerido: true` **y** añade su `id` a
`camposObligatorios` del plan, con su mensaje en `etiquetasError`.

Para que aparezca en la exportación a Excel, agrégalo también en
`js/core/exportar.js`, en la lista `COLUMNAS_DETALLE`:

```js
['poblacionObjetivo', 'Población objetivo'],
```

---

## Agregar un tercer plan

En `js/plans/index.js`, agrega un objeto más al arreglo `PLANES`, copiando la
estructura del Plan de Gestión Institucional y cambiando `id`, `nombre`,
`nombreCorto`, `descripcion` y sus secciones. Aparecerá solo como una pestaña
nueva, con su propio listado, panel y exportación. No hay que tocar nada más.

---

## Mantener el clasificador presupuestario

El desplegable del Plan Anual de Compras sale de
`data/clasificador-presupuestario.json`. Su estructura es:

```json
{
  "items": [
    {
      "codigo": "2207",
      "nombre": "Publicidad y Difusión",
      "asignaciones": [
        { "codigo": "2207001", "nombre": "Servicios de Publicidad" }
      ]
    }
  ]
}
```

- `items` son los grupos que se ven en el desplegable (ítem presupuestario).
- `asignaciones` son las opciones seleccionables.
- `nombre` es lo que ve la persona: **texto simple, sin códigos ni guiones
  bajos**. Escríbelo tal como debe leerse.
- `codigo` nunca se muestra, pero es lo que viaja al Excel. **No lo cambies** si
  ya hay compras registradas con él.

Cuando se actualice el clasificador oficial, edita este archivo. No hay que
tocar código.

---

## Campos obligatorios del formulario

Un campo obligatorio lleva **asterisco rojo** y la actividad no se guarda sin él.
En ambos planes:

- Nombre de la actividad y departamento.
- **Descripción detallada** y **medio de verificación** (desde la versión 3.6).
- Al menos un mes con ejecución en el cronograma.
- Presupuesto, o la marca «esta actividad no requiere presupuesto».
- Categoría programática y programa de cada subtítulo que tenga monto.
- El **Plan Anual de Compras**, si hay monto en el subtítulo 22 (ver abajo).

Además, en el PNS el resultado inmediato de la cadena ENS, y en el PGI el
objetivo estratégico y el objetivo operacional.

Las reglas viven en `validarActividad()`, en `js/core/modelo.js`. El asistente,
el informe consolidado y el formulario consultan esa misma función, así que un
campo nuevo que se marque ahí como obligatorio queda exigido en los tres a la
vez. El asterisco, en cambio, se pone en `js/plans/index.js` con
`requerido: true`: son dos cosas distintas —mostrar y exigir— y hay que tocar
las dos.

> **Actividades guardadas antes de la versión 3.6.** Las que no tengan
> descripción, medio de verificación o PAC (teniendo subtítulo 22) no se pierden
> ni se modifican: se siguen viendo y exportando igual. Pero al editarlas no se
> podrán volver a guardar hasta completar lo que falta, y el asistente y el
> informe consolidado las señalan con nombre.

---

## Sobre el Plan Anual de Compras (PAC)

- El bloque vive dentro del **Subtítulo 22**: el PAC solo aplica a bienes y
  servicios de consumo.
- **Con presupuesto en el subtítulo 22, el PAC es obligatorio** (desde la
  versión 3.6). Al escribir la primera cifra en cualquier mes del 22, el bloque
  se abre solo, ofrece la primera compra y el interruptor queda fijo, con una
  nota que explica por qué. No se puede guardar la actividad sin al menos una
  compra.
- En ese caso **los seis datos de cada compra son obligatorios**: clasificador,
  producto, cantidad, fecha de compra, fecha de ejecución y monto. Llevan el
  asterisco rojo como el resto de los campos obligatorios.
- Si la persona borra el monto del 22 y todavía no había escrito nada en la
  compra que se abrió sola, el bloque se vuelve a cerrar. Si ya había escrito
  algo, se respeta: el interruptor se libera y la compra queda como estaba.
- Un PAC **sin** subtítulo 22 se puede seguir activando a mano. En ese caso
  mantiene la regla anterior: clasificador, producto y monto obligatorios;
  cantidad y fechas sugeridos, marcados «Faltan N datos» pero sin bloquear.
- Una actividad puede tener **varias compras**. Cada una lleva su propio
  clasificador, porque en el PAC cada línea se imputa por separado.
- **Las dos fechas** significan cosas distintas y el formulario lo explica en un
  cuadro: la *fecha de compra o contratación* es cuándo se presenta la solicitud
  de compra; la *fecha de ejecución*, cuándo se realiza la actividad con esos
  insumos ya disponibles. La primera debe ir antes que la segunda, con el margen
  que necesite el proceso de adquisición.
- La plataforma **compara** la suma de las compras con el total del subtítulo 22
  y avisa si no cuadran. Sigue siendo solo un aviso, aun con el PAC obligatorio:
  durante la estimación es normal que todavía no calce, y parte del gasto del 22
  puede no pasar por compras.
- Las fechas se repiten **en palabras** bajo cada campo («miércoles, 15 de abril
  de 2026»). El formato del calendario nativo depende del idioma del navegador,
  y en un equipo en inglés `04/09` se lee como 4 de septiembre en vez de 9 de
  abril: el texto en español elimina esa ambigüedad.
- Al marcar «esta actividad no requiere presupuesto», el PAC se apaga y sus
  compras se descartan.
- **Cantidad, las dos fechas y el monto forman una sola fila.** El número de
  columnas lo decide el ancho de la tarjeta (4 · 2 · 1), no el de la ventana, y
  las tres franjas de cada campo —etiqueta, control y texto de apoyo— se alinean
  entre sí con `subgrid`. Por eso las etiquetas van pegadas hacia abajo: da igual
  que «Fecha estimada de compra o contratación» ocupe dos líneas y «Cantidad»
  una, los recuadros quedan a la misma altura. Si alargas el texto de una
  etiqueta no hay que ajustar nada.

- **Compra crítica para el SGC** (desde la versión 3.8). Cada compra trae al
  final una casilla «Compra crítica para el Sistema de Gestión de Calidad
  (SGC)». No es obligatoria: desmarcada significa «no crítica», y las compras
  registradas antes de esta versión quedan así hasta que alguien las marque.
  Una compra marcada muestra el distintivo «Crítica SGC» en su cabecera, y el
  detalle («Ver») lo indica en cada compra.

En la exportación a Excel, el PAC ocupa **su propia hoja**, con una fila por
compra y el código, ítem y asignación del clasificador. Desde la versión 3.8
trae además dos columnas pensadas para el seguimiento:

- **Programa (subtítulo 22)**, junto al clasificador. No se pide en cada
  compra: el PAC vive dentro del subtítulo 22 de la actividad, así que la compra
  se carga al programa que esa actividad eligió para su subtítulo 22. Si una
  actividad activó el PAC sin tener monto en el 22, la celda queda vacía.
- **Crítica para el SGC**, con «Sí» o «No», después del monto.

La hoja tiene autofiltro, así que basta un clic para ver solo las compras
críticas o solo las de un programa.

En el **informe consolidado**, la portada suma cuántas compras son críticas y
por qué monto. La hoja «Conciliación PAC» agrega dos bloques: compras por
programa (con cuántas son críticas en cada uno) y la lista de compras críticas
ordenada por fecha estimada de compra, que es el orden en que hay que
gestionarlas. La vista imprimible trae lo mismo, y el anexo marca cada compra
crítica.

> Cuatro programas del catálogo se repiten con el mismo nombre en dos
> categorías (por ejemplo, «Continuidad / Marea Roja»). En la columna
> «Programa» se ven iguales aunque correspondan a categorías distintas. Si eso
> llegara a importar para el análisis, se puede agregar la categoría
> programática como otra columna. El Plan Anual de Compras
es una entrega distinta del plan de actividades, así que queda lista para enviar
a Adquisiciones sin recortar nada.

---

## El asistente

El botón redondo de abajo a la derecha. **No es inteligencia artificial**, y el
propio panel lo dice: son reglas que leen el formulario en curso más un banco de
respuestas escritas a mano. Se eligió así a propósito. Un modelo pequeño corriendo
en el navegador no conoce la ENS, ni los lineamientos, ni el clasificador: se
inventaría un código de resultado inmediato que parece correcto, y alguien lo
copiaría. Esto no puede equivocarse en ese sentido, porque no genera nada.

Tiene tres pestañas:

- **Revisión** — mira lo que se está escribiendo y avisa de vacíos e
  incoherencias: cadena ENS a medio elegir, cronograma vacío, compras que no
  cuadran con el subtítulo 22, fechas de compra posteriores a la de ejecución,
  medio de verificación faltante (con el que corresponde según el tipo de
  actividad). También revisa lo ya guardado del plan.
- **Preguntas** — el banco de preguntas frecuentes.
- **Guía** — los siete pasos del formulario, en orden.

**El contador cuenta solo lo que pide acción**: las tarjetas rojas (obligatorio)
y ámbar (conviene revisar). Las azules son información —un indicador oficial
asociado, un dato de contexto— y se muestran pero no suman. Un número que
incluye avisos que no hay que atender deja de significar nada y se aprende a
ignorar. El punto es rojo si hay algo obligatorio y ámbar si son sugerencias.

**Cada observación lleva a su problema.** La tarjeta entera es pulsable:
- Si es del formulario, baja hasta el campo, lo enfoca y lo marca un momento.
  En el Plan Anual de Compras apunta a **la compra concreta y al campo
  concreto**, no al bloque.
- Si es de una actividad **ya guardada**, lista cuáles son con su código y
  nombre; al pulsar una, se carga en el formulario para corregirla. Si tienes
  algo escrito sin guardar, pide confirmación antes de reemplazarlo. En un
  perfil de solo lectura abre el detalle en vez del formulario.

**La observación desaparece sola al corregir la causa.** El asistente no guarda
estado: recalcula con cada tecla y con cada guardado. No hay forma de descartar
un aviso a mano, y es deliberado: un contador que se apaga porque alguien lo
silenció puede quedar en cero mientras el problema sigue ahí.

**Ocultarlo y recuperarlo.** Cualquiera puede ocultar el asistente desde el pie
de su panel, y la elección queda guardada en su navegador. Para volver a
mostrarlo: botón **Ayuda** de la cabecera, al final del modal. El mismo
interruptor sirve para las dos cosas.

### Editar lo que dice

Todo el contenido vive en **`data/asistente.json`** y se edita sin tocar código:

```json
{
  "p": "¿Por qué no puedo editar ni eliminar nada?",
  "r": "Estás usando un perfil de solo lectura...",
  "claves": ["observador", "no puedo", "bloqueado", "permiso"]
}
```

`claves` son las palabras extra por las que la búsqueda debe encontrar esa
entrada: sinónimos, errores de tipeo frecuentes y, sobre todo, **cómo lo llama la
gente en la práctica**. Ahí está la diferencia entre un buscador que sirve y uno
que no. Cuando un equipo te haga una pregunta que el asistente no responde,
agrégala: es la forma en que esto mejora.

El bloque `mediosSugeridos` relaciona cada tipo de actividad con el medio de
verificación que le corresponde, y `campos` explica campo por campo.

> Si `asistente.json` no cargara, la plataforma funciona igual y el botón
> simplemente no aparece. Nunca es el motivo de que algo no arranque.

---

## El Security Advisor de Supabase

Supabase trae un revisor automático (**Advisors → Security**). Esto es lo que
dice sobre esta base y qué se hizo con cada aviso.

### El esquema `privado` y por qué existe

PostgREST —la capa que atiende al navegador— **publica como API REST todo lo que
viva en un esquema expuesto**. Una función en `public` queda disponible en
`/rest/v1/rpc/<nombre>` para cualquiera que tenga la clave anon. Las funciones
que sostienen las políticas de seguridad (`mi_rol`, `puede_escribir`, `ve_todo`,
los triggers) son plomería interna y no tienen por qué ser un punto de entrada,
así que viven en el esquema **`privado`**, que no está expuesto.

> **No les revoques el permiso de ejecución.** Es lo que sugiere el texto del
> aviso, y probado contra PostgreSQL **deja a todo el mundo fuera**: la base
> comprueba el privilegio `EXECUTE` de estas funciones al evaluar cada política,
> con la identidad de quien consulta, y toda consulta falla con «permission
> denied for function». Sacarlas del esquema expuesto quita el endpoint sin
> tocar el permiso. Eso es lo que hace `esquema.sql`.

Después de ejecutar el esquema, en `public` queda **una sola función**:
`reservar_codigo`.

### `reservar_codigo` seguirá apareciendo marcada, y está bien

Es la única función pensada como API: el navegador la llama para obtener el
correlativo. El aviso «SECURITY DEFINER ejecutable por usuarios autenticados»
es correcto y conviene que exista, pero aquí es deliberado. Está acotada: exige
sesión iniciada, valida el plan y el año, rechaza a los perfiles de solo
lectura, **toma el departamento del perfil y nunca de un parámetro**, y devuelve
un número, jamás datos de nadie.

`decidir_actividades` (versión 3.14) aparece con el mismo aviso, también a
propósito: es la única vía para aprobar, observar o reabrir. Exige sesión,
rechaza a quien no sea jefatura o Control de Gestión, toma el departamento del
perfil y no de un parámetro, y no hace nada con el circuito apagado.

### Rendimiento de las reglas de acceso (versión 3.14.1)

Las reglas que deciden quién ve qué llaman a `auth.uid()` y a las funciones de
`privado` envueltas en `(select ...)`. Así Postgres las calcula **una vez por
consulta** y no una vez por cada actividad. En una prueba con 40 personas y 780
actividades, cargar el listado de un equipo bajó de 38 ms a 1,4 ms, y la
capacidad subió de unas 51 a unas 990 consultas por segundo.

Si se agrega una regla nueva, conviene escribirla igual:
`propietario = (select auth.uid())` y no `propietario = auth.uid()`. El
Performance Advisor de Supabase avisa («Auth RLS Initialization Plan») cuando
alguna queda sin envolver. El cambio está suelto en `docs/rendimiento-rls.sql`.

### `search_path` fijo en todas

Todas las funciones declaran `set search_path = ''` y califican cada referencia.
En una función `SECURITY DEFINER`, dejar el `search_path` al criterio de quien
la invoca es una vía de escalada conocida.

### Protección de contraseñas filtradas

Este aviso **no aplica hoy**: la plataforma entra con enlace por correo, no con
contraseñas. Aun así conviene activarlo —**Authentication → Providers →
Password**— porque no cuesta nada y deja la puerta cerrada si algún día se
habilita el ingreso con contraseña. Es un interruptor del panel, no SQL.

---

## Apariencia del formulario: lateral o clásico (versión 3.17)

En `config.js`, la línea `formulario` decide cómo se ve el formulario de
registro:

```js
formulario: 'lateral',    // las secciones como tarjetas que pasan hacia los lados
formulario: 'clasico',    // todas abiertas, una bajo otra, con el índice lateral (3.15)
```

- **Lateral:** cada sección es una tarjeta de alto fijo; se cambia de una a otra
  hacia los lados («Continuar», «Anterior», arrastrando con el dedo o tocando la
  vecina que asoma). La página no sube ni baja sola. Arriba, una barra con las
  seis etapas marca con un recuadro azul la sección actual y el estado de cada
  una (completa, pendiente o con datos faltantes); se puede tocar una etapa para
  ir directo. La última tarjeta, «Revisar y guardar», resume las cinco y tiene
  los botones de guardar. Si al guardar falta algo, la tarjeta con el problema
  se desliza al centro y el cursor queda en el campo.
- **Clásico:** el formulario de la versión 3.15.

Es solo la apariencia: las actividades se guardan igual en los dos modos, así
que se puede cambiar cuantas veces se quiera sin tocar Supabase. Tras cambiar
la línea, commit y push como siempre.

(La versión 3.16 tuvo un tercer modo, «acordeón», que se retiró en la 3.17. Si
`config.js` todavía dijera `'acordeon'`, la plataforma usa el modo lateral.)

---

## Editar desde el listado: la hoja lateral (versión 3.18)

«Editar» (en el listado o en la ficha de una actividad) abre la actividad en un
panel que entra desde la derecha. El listado queda detrás, apenas oscurecido y
en el mismo lugar. Al guardar, el panel se cierra y la fila editada destella un
momento; con la × o Esc se cierra sin guardar (si hubo cambios, pregunta antes).

El formulario es el mismo de siempre (lateral o clásico, según `config.js`):
mientras dura la edición se muda al panel. Si alguien tenía una actividad nueva
a medio llenar, queda guardada aparte y vuelve intacta al cerrar el panel.

---

## Perfiles: qué puede hacer cada uno

| Perfil | Ve | Modifica |
|---|---|---|
| `equipo` | sus propias actividades | sus propias actividades |
| `jefatura` | todo su departamento | sus propias actividades |
| `control_gestion` | toda la institución | toda la institución; consolida; mantiene la nómina |
| `observador` | toda la institución | **nada** |

Con el circuito de aprobación encendido, `equipo` y `jefatura` no pueden editar
ni eliminar lo ya aprobado (ver «Circuito de aprobación por jefatura»).

Solo `control_gestion` ve el botón **«Exportar informe»**, el informe consolidado
de ambos planes y del PAC (ver más abajo).

El **Observador** consulta, filtra, ve el panel de análisis, exporta a Excel, CSV
y JSON, e imprime. No ve el formulario de registro ni los botones de editar,
duplicar o eliminar, y tampoco puede importar ni vaciar un plan. Está pensado
para cargos directivos y para Finanzas: gente que necesita el panorama completo
sin riesgo de alterar el trabajo de los equipos.


---

## Circuito de aprobación por jefatura (versión 3.14)

Con el circuito encendido, cada actividad tiene un **estado**:

| Estado | Qué significa | Quién lo cambia |
|---|---|---|
| Borrador | El equipo la está preparando. | El equipo, al guardar con «Guardar como borrador». |
| En revisión | El equipo la envió a su jefatura. | El equipo, con «Guardar y enviar a revisión» o «Enviar» en el listado. |
| Observada | La jefatura la devolvió con un comentario. | La jefatura (o Control de Gestión), con «Observar». |
| Aprobada | Lista para el traspaso. Queda **bloqueada**. | La jefatura (o Control de Gestión), con «Aprobar». |

- La **jefatura** ve arriba del listado la bandeja «Revisión del departamento»,
  con las actividades por revisar de los dos planes. Puede aprobar varias a la
  vez marcando las casillas.
- **Control de Gestión** ve «Avance de la aprobación» por departamento y puede
  aprobar, observar o **reabrir** cualquier actividad. Reabrir devuelve una
  aprobada a borrador para que el equipo la corrija.
- Cada decisión queda en el **historial de revisión** de la actividad (pestaña
  «Ver»): quién, cuándo y con qué observación.
- «Exportar informe» pregunta si se quiere **todo** o **solo lo aprobado**
  (para el traspaso al Ministerio). La portada del informe dice cuál se eligió.
- Las reglas las aplica la base de datos, no el navegador: nadie puede
  aprobarse a sí mismo ni editar lo aprobado, aunque manipule la página.

### Encenderlo, apagarlo y fijar un plazo

**«Más» → «Configuración de la plataforma»** (solo Control de Gestión). El
interruptor «Exigir la aprobación de la jefatura» enciende o apaga el circuito,
y el campo de plazo muestra una fecha a equipos y jefaturas (no bloquea nada).

**Apagarlo no borra nada.** Los estados y el historial quedan guardados en cada
actividad y vuelven a regir si se enciende otra vez. Mientras está apagado, la
plataforma se comporta como en la versión 3.13: sin columna «Estado», sin
bandeja y con todo editable según el perfil.

Si alguna vez la interfaz no estuviera disponible, lo mismo se hace en
Supabase → SQL Editor:

```sql
-- Apagar
update public.configuracion set valor = jsonb_set(valor, '{activa}', 'false') where clave = 'aprobacion';
-- Encender
update public.configuracion set valor = jsonb_set(valor, '{activa}', 'true')  where clave = 'aprobacion';
```

### Instalación (una sola vez)

Supabase → SQL Editor → pegar `docs/aprobacion.sql` → Run. Crea la tabla
`configuracion`, las reglas del estado y la función `decidir_actividades`. Se
puede ejecutar más de una vez sin problema. Queda **encendido**; si se prefiere
partir apagado, ejecutar después el «Apagar» de arriba.

---

## Análisis del Plan Anual de Compras (versión 3.14)

Bajo el Panel de análisis aparece «Análisis del Plan Anual de Compras», que
junta las compras de los dos planes. Tiene cuatro bloques:

1. **Calendario de compras**: monto por mes según la fecha estimada de compra.
   Muestra el mes con más compras, para coordinar la carga de Adquisiciones.
2. **Compras con poca holgura**: compras cuyo plazo entre la fecha de compra y
   la de ejecución es menor al mínimo que defina Adquisiciones según el monto.
   *Solo aparece si se cargaron los plazos.*
3. **Compras parecidas en varios departamentos**: mismo clasificador y producto
   parecido en dos o más departamentos. Candidatas a una sola compra (y a
   prevenir el fraccionamiento). Solo la ven Control de Gestión y Observador.
4. **Planificado frente al marco presupuestario del subtítulo 22**, por
   departamento: verde bajo 90 %, ámbar entre 90 y 100 %, rojo sobre el marco.
   *Solo aparece si se cargó el marco.* La jefatura ve solo el de su
   departamento; los equipos no lo ven.

Todo se configura en **«Más» → «Configuración de la plataforma»**:

- **Interruptor «Mostrar el análisis del Plan Anual de Compras»**: lo oculta
  completo, por ejemplo mientras no haya información de presupuesto.
- **Plazos mínimos de Adquisiciones**: tramos «Monto hasta (M$)» y «Días
  mínimos». El último tramo puede quedar «Sin tope». Ejemplo: hasta M$ 500,
  15 días; sin tope, 30 días. Sin tramos, el bloque de holgura no aparece.
- **Marco presupuestario del subtítulo 22** del período en uso, en miles de
  pesos por departamento. Los departamentos sin monto no se comparan; si
  ninguno tiene monto, el bloque no aparece. El marco se guarda por año, así
  que cargar el de 2028 no borra el de 2027.

---

## Perfiles múltiples y el selector

Una persona puede tener **varios perfiles** y alternar entre ellos desde el
selector de la cabecera, sin volver a iniciar sesión. El selector aparece solo
si tiene más de uno.

En `docs/nomina.sql` cada línea lleva una lista:

```sql
('kurt.castro@redsalud.gob.cl', 'Kurt Castro', 'dpto_control_gestion',
 array['control_gestion', 'observador']),
```

El **primero de la lista** es el perfil con el que se entra.

**El cambio de perfil no es un filtro visual.** El perfil activo se guarda en la
base de datos y las políticas de seguridad lo consultan: alguien que tiene
Control de Gestión y está usando Observador es, para el servidor, un observador.
Sus intentos de escribir se rechazan en la base, no en el navegador. Eso incluye
sus propias actividades: en modo Observador no puede editar ni siquiera lo que
él mismo cargó.

Al cambiar de perfil **la plataforma se recarga**. Es a propósito: el perfil
decide qué entrega el servidor, y la copia en memoria quedó armada con los
permisos anteriores. Al pasar de un perfil que ve toda la institución a uno que
solo ve lo suyo, seguir con esa copia mostraría actividades ajenas que ya no
corresponden.

> Si le quitas un perfil a alguien que lo tenía activo, la base lo devuelve sola
> al primero de su lista nueva. No hay que corregir nada a mano.

---

## Agregar, cambiar o quitar personas

La sección Identificación se completa sola con los datos de la sesión. Esos
datos salen de **`docs/nomina.sql`**, que es la lista oficial de quién usa la
plataforma y con qué perfil.

**Para agregar, mover o cambiar el perfil de alguien:**

1. Abre `docs/nomina.sql` y edita la lista. Cada línea es una persona:

   ```sql
   ('nombre.apellido@redsalud.gob.cl', 'Nombre Apellido', 'dpto_salud_publica', array['equipo']),
   ```

   Los identificadores de departamento son los de `data/catalogos.json`
   (columna `id`), no el nombre completo. Los perfiles válidos son `equipo`,
   `jefatura`, `control_gestion` y `observador`. Para dar más de uno, se agregan
   a la lista: `array['control_gestion', 'observador']`.

2. Copia el archivo completo y ejecútalo en Supabase → **SQL Editor**.

3. Sube el cambio al repositorio (`git add . && git commit && git push`) para
   que quede registrado quién tenía acceso y desde cuándo.

Puedes ejecutarlo cuantas veces quieras: actualiza a quien ya existe, agrega a
quien falta, y no duplica a nadie.

**Para quitarle el acceso a alguien:** bórralo de `docs/nomina.sql`, y además
elimina su cuenta en Supabase → **Authentication** → **Users**. Ojo: al eliminar
la cuenta se borran también sus actividades, así que exporta antes lo que
necesites conservar.

> Sacar a alguien de `nomina.sql` **no** le quita el acceso por sí solo: su
> perfil ya existe. La nómina define quién entra con qué datos; el acceso lo
> corta la eliminación de la cuenta.
>
> Sí sirve, en cambio, para **dejarlo en solo lectura sin perder su historial**:
> cámbiale la lista a `array['observador']` y vuelve a ejecutar `nomina.sql`.
> Conserva sus actividades y deja de poder tocarlas.

---

## La entrada a la plataforma (inicio de sesión)

Desde la versión 3.7, a quien llega sin sesión la plataforma se lo hace notar de
tres formas, de la más insistente a la más discreta:

1. **Pantalla de ingreso.** Lo primero que se ve es una tarjeta centrada con el
   campo de correo y el botón «Enviarme un código de acceso». Al enviarlo, la
   misma tarjeta pide el **código de 6 dígitos** que llegó por correo, con un
   botón para pedir uno nuevo (cada 60 segundos) y otro para cambiar de correo.
   Abajo está siempre **«Continuar sin sesión»**, que también se activa con
   Escape. El botón de la cabecera y el de la franja ámbar abren esta misma
   pantalla. Desde la versión 3.11 es un código y no un enlace: ver
   `docs/GUIA-CORREO-CODIGO.md`, que explica también cómo se configura el envío
   desde el Gmail de la unidad.
2. **Franja ámbar sobre el formulario.** Si se continúa sin sesión, arriba del
   formulario queda una franja que dice la consecuencia —«lo que registres se
   guardará solo en este navegador y no llegará a Control de Gestión»— con su
   propio botón para entrar.
3. **Botón azul en la cabecera.** «Iniciar sesión →» deja de ser una píldora gris
   y pasa a ser el botón principal de la cabecera. Con sesión vuelve a verse
   discreto, con el nombre de la persona.

«Continuar sin sesión» se recuerda **solo en esa pestaña**. Al recargar no
vuelve a aparecer la pantalla, pero al abrir la plataforma otro día sí. Si se
recordara para siempre, un clic distraído borraría el recordatorio durante todo
el ciclo de planificación.

Casos en que nada de esto aparece:

- **Con sesión iniciada.** Nada cambia respecto de antes.
- **Servidor caído** («Sin conexión» en la cabecera). No se ofrece un ingreso
  que no puede funcionar: queda solo la franja, que explica que lo registrado se
  guarda en el navegador.
- **Nube desactivada** en `config.js` (`habilitada: false`). Trabajar en el
  navegador es el modo previsto y el indicador sigue diciendo «Guardado en este
  equipo», sin llamar la atención.

Todo vive en `js/core/sesion.js` (`mostrarPantallaIngreso`, `mostrarAvisoSesion`)
y los estilos en `css/app.css`, secciones «Aviso sin sesión» y «Pantalla de
ingreso». Nada de esto se imprime.

> **Lo registrado sin sesión no se sube después.** Si alguien registra
> actividades sin sesión y luego inicia sesión en el mismo navegador, esas
> actividades siguen solo en ese navegador: al entrar, la plataforma *baja* lo
> que hay en la nube, pero no *sube* lo que se hizo sin sesión. Para enviarlas,
> hay que abrir cada una y volver a guardarla ya con la sesión iniciada. Por eso
> los textos de la pantalla y de la franja dicen «no llegará a Control de
> Gestión» y no «llegará cuando inicies sesión».

---

## Quién puede registrarse: dominios y excepciones

Desde la versión 3.5 esta regla vive **en la base de datos**. Antes estaba en
`config.js`, y ahí no era una restricción sino una cortesía: cualquiera que
abriera la consola del navegador y llamara a la API de Supabase directamente se
registraba igual, con el correo que quisiera. Ahora un *trigger* corta el alta
antes de que la cuenta exista.

> **Configuración actual (desde la 3.10.1): solo la nómina.** La tabla de
> dominios está vacía, así que solo puede crear cuenta quien esté en
> `usuarios_autorizados`, **aunque tenga correo @redsalud.gob.cl o @minsal.cl**.
> Una persona fuera de la nómina que pida el código verá *«Ese correo no está
> autorizado para acceder a la plataforma…»* y no se le crea cuenta.
>
> Para aplicar esto en una base que todavía tenía los dominios cargados, ejecuta
> `docs/acceso-solo-nomina.sql` en Supabase → **SQL Editor**. Además de cerrar
> los dominios, lista a quienes **ya** tenían cuenta sin estar en la nómina (esas
> cuentas siguen entrando hasta que se agreguen a la nómina o se eliminen).

La base admite **dos caminos** para registrarse, y basta cumplir uno:

| Camino | Dónde se define | Para qué sirve |
|---|---|---|
| El **dominio** del correo está autorizado | tabla `dominios_permitidos` | Deja entrar a la institución completa sin enumerar a nadie. |
| El **correo exacto** está en la nómina | tabla `usuarios_autorizados` (`docs/nomina.sql`) | La excepción nominal, persona por persona. |

Cualquier otro correo es rechazado y **no queda ningún rastro** de él: ni cuenta,
ni perfil. En la plataforma la persona ve el mensaje *«Ese correo no está
autorizado para acceder a la plataforma…»*.

### Autorizar un correo que no es institucional

Es el mismo gesto que dar de alta a cualquier funcionario: **se agrega a la
nómina**. No hay una segunda lista que mantener, ni hay que tocar código ni
desplegar el sitio.

1. Abre `docs/nomina.sql` y agrega la línea, con el departamento y los perfiles
   que le correspondan:

   ```sql
   ('nombre.apellido@gmail.com', 'Nombre Apellido', 'dpto_control_gestion',
    array['equipo', 'control_gestion']),
   ```

2. Ejecuta el archivo completo en Supabase → **SQL Editor**.
3. Pídele a la persona que entre desde la plataforma con ese correo.

El **primer perfil de la lista es con el que entra**: con
`array['equipo', 'control_gestion']` empieza como Equipo y cambia desde el
selector de la cabecera. Si prefieres que entre directo a Control de Gestión,
invierte el orden.

> Piénsalo dos veces antes de dar `control_gestion` a un correo externo. Ese
> perfil ve y edita las actividades de toda la institución, administra la nómina
> y administra la propia lista de dominios autorizados.

### Agregar o quitar un dominio completo

Hoy no hay ninguno, a propósito. Si algún día se quisiera abrir un dominio
entero —por ejemplo, para que entre cualquiera con correo institucional sin
estar en la nómina—, se hace desde Supabase → **SQL Editor**. Ten presente que
quien entre por esa vía queda con perfil Equipo y elige su departamento sin que
nadie lo verifique:

```sql
-- Agregar un dominio
insert into public.dominios_permitidos (dominio, nota)
values ('seremi.cl', 'Motivo por el que se autoriza');

-- Quitarlo
delete from public.dominios_permitidos where dominio = 'seremi.cl';

-- Ver la lista actual
select * from public.dominios_permitidos order by dominio;
```

Un registro con el dominio `'*'` **desactiva la restricción por completo** y
deja entrar a cualquier correo. Está ahí como salida de emergencia; borrar esa
fila vuelve a cerrar la puerta de inmediato.

### Lo que conviene tener claro

- **Solo afecta a cuentas nuevas.** Quien ya tiene cuenta creada sigue entrando
  aunque su correo deje de estar autorizado, porque al volver a iniciar sesión
  Supabase no registra nada: solo envía el código. Para cortarle el acceso hay
  que eliminar su cuenta en **Authentication → Users**. Al eliminarla se borran
  también su perfil y **todas sus actividades**.
- **Sacar a alguien de la nómina no le quita el acceso** por la misma razón:
  hay que eliminar además su cuenta.
- **También aplica a las cuentas creadas a mano** desde el panel de Supabase. Si
  necesitas crear una, primero agrega el correo a la nómina; si no, la creación
  falla con «Database error saving new user».
- `dominiosPermitidos` en `config.js` **ya no restringe nada**: quedó solo como
  el texto que se muestra en la pantalla de ingreso y en los mensajes de error.
  Conviene mantenerlo al día con la tabla para que los mensajes no mientan, pero
  editarlo no cambia quién puede entrar.
- Ni la nómina ni la lista de dominios son visibles para nadie que no sea
  Control de Gestión; el trigger las consulta con privilegios propios.

## Qué muestra el Panel de análisis

**Filtro por departamento.** Sobre las fichas hay un desplegable que alcanza a
todo lo que va debajo: las seis fichas, los cinco gráficos y sus tablas de datos
se recalculan con la misma selección, así que las cifras nunca se contradicen. El
desplegable ofrece solo los departamentos que tienen actividades registradas, y
si hay uno solo la barra ni siquiera aparece. El filtro es del panel: **no**
modifica el listado de actividades ni la exportación a Excel.

**Fichas.** Actividades · Ejecuciones programadas · Departamentos · Presupuesto
total · Subtítulo 21 · Subtítulo 22. Las dos últimas desglosan el presupuesto
total y muestran qué porcentaje representa cada subtítulo y cuántas actividades
lo usan; siempre suman el total.

**Gráficos, en este orden:**

1. Actividades por departamento
2. Ejecuciones por mes
3. Actividades por objetivo estratégico
4. Actividades por tema
5. Presupuesto por mes

La idea del orden es leer primero *quién* y *cuándo*, después *contra qué* se
planifica y al final *con cuánto*.

El gráfico de temas lleva el código del objetivo estratégico delante de cada tema
(`2 · Cáncer`), de modo que se ve la pertenencia sin necesidad de un segundo
gráfico ni de distinguir colores. Cuando hay más de 14 temas se grafican los 14
con más actividades y el resto se agrupa en una barra «Otros N temas»; la tabla
de datos del gráfico los sigue listando todos.

El Plan de Gestión Institucional no tiene cadena ENS: en lugar de los gráficos 3
y 4 muestra «Actividades por tipo».

---

## Qué muestra la pestaña «Ver»

El detalle de una actividad se ordena así: **Código, Departamento, Responsable →
cadena de resultados → Tipo de Actividad, Componentes Transversales, Nombre de la
Actividad → Descripción → Medio de Verificación → Cronograma → Presupuesto → Plan
Anual de Compras**.

La cadena de resultados se muestra **con el texto completo de cada nivel**, no
solo con el código: la plataforma lo reconstruye desde el catálogo del año
(`data/ens-2027.json`, `data/ens-2026.json`…) en el momento de abrir el detalle.
Por eso, si se corrige un texto en ese archivo, las actividades ya registradas
pasan a mostrarlo sin necesidad de volver a guardarlas.

- El **Tema** no lleva código porque en la ENS su nombre *es* su identificador.
- Si un código no existe en el archivo del año (por ejemplo, una actividad
  antigua con un RI que MINSAL eliminó), se muestra el código tal cual, para que
  el dato no se pierda.
- En el **Plan de Gestión Institucional** no hay cadena ENS: en su lugar se
  muestran Objetivo Estratégico, Objetivo Operacional y Producto, que son campos
  de texto libre de ese plan.
- El bloque **Presupuesto** aparece solo si hay montos cargados o si la actividad
  está marcada como «no requiere presupuesto».

---

## Imprimir la pantalla («Más» → Imprimir o guardar como PDF)

Es la impresión rápida de lo que se está viendo, distinta del informe
consolidado. Funciona igual con Ctrl+P.

Lo que sale en el papel: el **nombre del plan**, un **sello** con la institución
y la fecha y hora de impresión, el **listado completo de actividades** y el
**panel de análisis** con sus gráficos, cada uno acompañado de su tabla de
datos (las tablas se abren solas al imprimir y se vuelven a cerrar al terminar,
porque un gráfico en papel no se puede consultar y los números sí).

Lo que **no** sale: la cabecera, las pestañas de plan, el formulario de
registro, la barra de búsqueda, la columna de botones de cada fila, el
asistente y los diálogos abiertos.

La hoja es **A4 vertical**. La tabla se imprime con siete columnas de ancho
fijo —Código, Actividad, Departamento, Tema (u Objetivo operacional en el PGI),
Tipo, Ejec. y Presupuesto— y su encabezado se repite en cada página.

Todo esto vive en el bloque `@media print` de `css/app.css`, salvo dos cosas que
la hoja de estilos no puede hacer sola y están en `prepararImpresion()`, en
`js/app.js`: calcular la fecha del sello en el momento de imprimir y abrir las
tablas de datos de los gráficos.

> Si se agrega o se quita una columna del listado, hay que revisar los anchos
> `nth-child` de la tabla en el bloque de impresión: están fijados a mano y
> suman 100 %.

---

## El informe consolidado («Exportar informe»)

El botón **«Exportar informe»** aparece en la barra del listado y **solo lo ve el
perfil Control de Gestión**. No es una exportación más: mientras «Exportar a
Excel» entrega el plan que se está mirando, el informe recorre **toda la
planificación de la institución** —los dos planes y el Plan Anual de Compras— sin
importar en qué pestaña se esté.

Al pulsarlo pasan dos cosas, en este orden:

1. Se **descarga un archivo Excel** (`informe-planificacion-2026-AAAA-MM-DD.xlsx`).
2. Se abre en pantalla la **vista imprimible**, con un botón «Imprimir o guardar
   como PDF». El navegador genera el PDF; la plataforma no necesita ninguna
   librería adicional para eso.

Si el Excel fallara —por ejemplo, si no carga la librería—, la vista en pantalla
se abre igual y el informe se puede entregar en PDF.

### Las diez hojas del Excel

| Hoja | Qué trae |
|---|---|
| Portada | Totales generales, estado de las fichas, resumen por plan e índice del libro. |
| Resumen | Totales por departamento (ambos planes), por tipo de actividad y por componente transversal. |
| PNS | Una fila por actividad del Plan Nacional de Salud, con todos los campos y la cadena ENS en texto. |
| PGI | Lo mismo para el Plan de Gestión Institucional. |
| PAC | Una fila **por compra**, no por actividad, con la actividad de origen como referencia. |
| Conciliación PAC | PAC contra subtítulo 22 de cada actividad, compras por ítem y calendario de compras. |
| Presupuesto | Distribución mensual por subtítulo y presupuesto por departamento y plan. |
| Cronograma | Ejecuciones mes a mes por departamento. |
| Cobertura ENS | Actividades por objetivo, tema y resultado esperado, incluyendo los que quedaron sin ninguna. |
| Calidad de datos | Solo las fichas con pendientes, ordenadas de más a menos, y qué le falta a cada una. |

Las hojas PNS y PGI terminan con cuatro columnas de estado: **Estado de la ficha,
Datos obligatorios que faltan, Datos recomendados que faltan y Observaciones del
PAC**. Vienen con autofiltro, así que se puede aislar en un clic todo lo que está
a medio llenar.

### Cómo decide si una ficha está completa

El informe **no inventa un criterio propio**: usa las mismas reglas del
formulario y del asistente. Distingue tres estados:

- **Completa** — no le falta nada.
- **Faltan datos recomendados** — no impide entregar, pero conviene completar:
  código, responsable, correo, tipo de actividad, componente transversal; o
  alguna observación del PAC. (Descripción y medio de verificación estaban
  aquí hasta la versión 3.5; ahora son obligatorios.)
- **Faltan datos obligatorios** — hay que corregirla: es lo mismo que el
  formulario rechazaría al guardar.

Los campos recomendados están en la constante `RECOMENDADOS`, arriba de
`js/core/informe.js`. Agregar o quitar uno es editar esa lista.

### El anexo del PDF

La vista imprimible trae una casilla: **«Incluir el anexo con el detalle de cada
actividad»**. El anexo dedica un bloque a cada ficha, con todos sus campos, su
cronograma, su presupuesto mes a mes, sus compras y sus pendientes.

Viene marcada cuando hay **150 actividades o menos**; sobre esa cifra empieza
desmarcada, porque el anexo puede sumar más de cien páginas. Ese umbral está en
`abrirVistaInforme()`, en `js/core/informe-vista.js`.

### Dárselo a otro perfil

Está restringido a Control de Gestión a propósito. Para habilitarlo también al
Observador —que ya ve toda la institución y exporta—, se agrega su identificador
a esta línea de `js/app.js`:

```js
const PERFILES_CON_INFORME = new Set(['control_gestion']);
```

Ese conjunto solo gobierna **quién ve el botón**. Lo que el informe puede leer lo
siguen decidiendo las políticas de la base de datos: un perfil que solo ve su
departamento generaría un informe con su departamento, no con la institución.

### Dónde se cambia el contenido

- Las hojas del Excel y sus columnas: `exportarInformeExcel()` en
  `js/core/informe.js`.
- Las secciones y los gráficos del PDF: `js/core/informe-vista.js`.
- Los cálculos —totales, agrupaciones, cobertura ENS, conciliación—:
  `reunirInforme()` en `js/core/informe.js`.

Los tres archivos están separados a propósito: **el Excel y el PDF consumen
exactamente los mismos números**. Si alguna vez dijeran cifras distintas, sería
un error de formato en una de las dos salidas, nunca un cálculo hecho dos veces.

---

## Sobre el código correlativo

Se asigna solo al guardar, y la serie es **por departamento, plan y año**: dos
personas del mismo departamento comparten la numeración y nunca reciben el mismo
número, aunque guarden al mismo tiempo.

- El número se reserva recién al presionar Guardar, no al abrir el formulario.
  Por eso el campo dice «Automático · N° 5» y no «5»: es una estimación hasta
  que se confirma.
- Si alguien elimina una actividad, su número **no** se reutiliza. Quedan huecos
  en la serie y está bien: lo importante es que no se repitan.
- Sin sesión iniciada, la plataforma numera a partir de lo que hay en ese
  navegador.

Para reiniciar la numeración de un departamento (por ejemplo, al empezar un año
nuevo con la base vacía), en Supabase:

```sql
delete from public.correlativos where anio = 2026 and departamento = 'dpto_salud_publica';
```

---

## Cambiar los colores institucionales

Abre `css/tokens.css`. Los valores relevantes están arriba:

```css
--marca:       #2a78d6;   /* color principal: botones, enlaces, acentos */
--marca-hover: #256abf;   /* el mismo, un paso más oscuro */
```

Si cambias `--marca`, ajusta también `--marca-hover`, `--marca-activo`,
`--marca-suave` (muy claro, para fondos) y `--marca-ink` (muy oscuro, para texto
sobre fondo claro), y repite el ajuste en el bloque `[data-tema='oscuro']`.

**Antes de cambiar los colores de los gráficos** (`--serie-1` y `--serie-2`):
esas dos tonalidades están elegidas para ser distinguibles por personas con
daltonismo y para mantener contraste suficiente sobre fondo claro y oscuro.
Si los cambias, verifica el contraste con una herramienta como
[WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/)
(mínimo 3:1 frente al fondo) y comprueba que las dos series sigan siendo
distinguibles en escala de grises.

---

## Cambiar el logotipo

Reemplaza `assets/logo-nuble.png` por la nueva imagen, conservando el mismo
nombre. Idealmente cuadrada y de al menos 128 × 128 píxeles.

---

## Cambiar los créditos y la autoría

Todo está en `config.js`:

```js
desarrollo: [
  'Unidad de Gestión de Datos y Control Interno',
  'Departamento de Control de Gestión y Calidad Institucional'
],

autoria: {
  autor: 'Kurt Castro Ortega',
  desde: 2026
},
```

- `desarrollo` son las líneas de la columna «Desarrollo» del pie de página, de
  lo más específico a lo más general. El nombre de la institución se agrega
  solo al final.
- `autoria.autor` aparece como **«Diseño y desarrollo: Kurt Castro Ortega»**
  sobre esas líneas, y en **Ayuda → Acerca de la plataforma**, junto con la
  versión, el aviso «© 2026 SEREMI de Salud de Ñuble. Uso institucional
  interno.» y el correo de soporte. El rango de años se completa solo a partir
  de `desde` (en 2027 dirá «2026–2027»).
- La misma autoría queda en el código: `<meta name="author">` en `index.html`,
  y en `README.md` y `LICENSE`.

La plataforma es de titularidad de la institución y el aviso de derechos va a
su nombre; la autoría reconoce a quien la diseñó y desarrolló.

---

## Cambiar el correo de soporte

`config.js` → `soporte`.

---

## Actualizar las librerías

En `vendor/` están Chart.js (gráficos) y SheetJS (Excel). Se actualizan muy de
vez en cuando. Para hacerlo:

```bash
npm pack chart.js@latest
tar xzf chart.js-*.tgz
cp package/dist/chart.umd.js vendor/chart.umd.js
```

Después prueba localmente que los gráficos y la exportación sigan funcionando
antes de publicar.

---

## Si algo se rompe

1. **La página queda en blanco**: abre la consola del navegador (F12 → Consola).
   El mensaje de error indica el archivo y la línea. Lo más frecuente es una coma
   de más o de menos en un archivo JSON.
2. **Verifica los JSON** antes de publicar pegándolos en
   [jsonlint.com](https://jsonlint.com).
3. **Vuelve atrás**: en GitHub, pestaña **Actions**, abre el último despliegue que
   funcionó y usa **Re-run all jobs**.
4. El flujo de publicación valida sintaxis de JavaScript y de JSON antes de
   desplegar, así que un error de escritura no llega a producción.
