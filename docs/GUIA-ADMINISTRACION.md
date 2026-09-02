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

## Cambiar el año del ciclo de planificación

Abre `config.js` y cambia el número:

```js
anio: 2027,
```

Eso actualiza títulos, nombres de archivos exportados y el año con el que se
guardan las actividades en la nube.

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

El archivo es `data/ens-2026.json`. Su estructura es un árbol:

```
objetivosEstrategicos[]
  └── temas[]
        └── objetivosImpacto[]
              └── resultadosEsperados[]
                    └── resultadosInmediatos[]
```

Cada nivel tiene `codigo` y `nombre` (los temas solo `nombre`).

Cuando MINSAL publique los lineamientos del año siguiente:

1. Copia `ens-2026.json` a `ens-2027.json` y edítalo, o pide que se genere desde
   la planilla oficial.
2. En `js/core/catalogos.js`, cambia el nombre del archivo en `cargarENS`.
3. Haz lo mismo con `indicadores-re-2026.json` si cambian los indicadores.

> Conserva el archivo del año anterior. Las actividades ya registradas guardan
> los códigos, y poder volver a consultarlos evita confusiones.

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

## Sobre el Plan Anual de Compras (PAC)

- El bloque aparece dentro del **Subtítulo 22** y solo si se activa el
  interruptor. Es deliberado: el PAC solo aplica a bienes y servicios de consumo.
- Una actividad puede tener **varias compras**. Cada una lleva su propio
  clasificador, porque en el PAC cada línea se imputa por separado.
- **Obligatorios**: clasificador, producto y monto. Cantidad y fechas quedan
  sugeridos: si faltan, la compra se marca «Faltan N datos» y se avisa al
  guardar, pero no bloquea. Así se puede completar por etapas.
- **Las dos fechas** significan cosas distintas y el formulario lo explica en un
  cuadro: la *fecha de compra o contratación* es cuándo se presenta la solicitud
  de compra; la *fecha de ejecución*, cuándo se realiza la actividad con esos
  insumos ya disponibles. La primera debe ir antes que la segunda, con el margen
  que necesite el proceso de adquisición.
- La plataforma **compara** la suma de las compras con el total del subtítulo 22
  y avisa si no cuadran. Es solo un aviso: durante la estimación es normal que
  todavía no calce.
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

En la exportación a Excel, el PAC ocupa **su propia hoja**, con una fila por
compra y el código, ítem y asignación del clasificador. El Plan Anual de Compras
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

## Perfiles: qué puede hacer cada uno

| Perfil | Ve | Modifica |
|---|---|---|
| `equipo` | sus propias actividades | sus propias actividades |
| `jefatura` | todo su departamento | sus propias actividades |
| `control_gestion` | toda la institución | toda la institución; consolida; mantiene la nómina |
| `observador` | toda la institución | **nada** |

Solo `control_gestion` ve el botón **«Exportar informe»**, el informe consolidado
de ambos planes y del PAC (ver más abajo).

El **Observador** consulta, filtra, ve el panel de análisis, exporta a Excel, CSV
y JSON, e imprime. No ve el formulario de registro ni los botones de editar,
duplicar o eliminar, y tampoco puede importar ni vaciar un plan. Está pensado
para cargos directivos y para Finanzas: gente que necesita el panorama completo
sin riesgo de alterar el trabajo de los equipos.

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
solo con el código: la plataforma lo reconstruye desde `data/ens-2026.json` en el
momento de abrir el detalle. Por eso, si se actualiza ese archivo, las
actividades ya registradas pasan a mostrar los textos nuevos sin necesidad de
volver a guardarlas.

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
  código, responsable, correo, tipo de actividad, componente transversal,
  descripción, medio de verificación; o alguna observación del PAC.
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

## Cambiar los créditos del pie de página

`config.js` → `desarrollo`. Es una lista de líneas, de lo más específico a lo
más general:

```js
desarrollo: [
  'Creado por la Unidad de Gestión de Datos y Control Interno',
  'Departamento de Control de Gestión y Calidad Institucional'
],
```

El nombre de la institución se agrega solo al final, así que no hay que
repetirlo. Agrega o quita líneas según cambie la orgánica.

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
