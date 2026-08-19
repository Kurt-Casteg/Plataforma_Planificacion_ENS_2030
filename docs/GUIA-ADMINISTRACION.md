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

En la exportación a Excel, el PAC ocupa **su propia hoja**, con una fila por
compra y el código, ítem y asignación del clasificador. El Plan Anual de Compras
es una entrega distinta del plan de actividades, así que queda lista para enviar
a Adquisiciones sin recortar nada.

---

## Agregar, cambiar o quitar personas

La sección Identificación se completa sola con los datos de la sesión. Esos
datos salen de **`docs/nomina.sql`**, que es la lista oficial de quién usa la
plataforma y con qué perfil.

**Para agregar, mover o cambiar el perfil de alguien:**

1. Abre `docs/nomina.sql` y edita la lista. Cada línea es una persona:

   ```sql
   ('nombre.apellido@redsalud.gob.cl', 'Nombre Apellido', 'dpto_salud_publica', 'equipo'),
   ```

   Los identificadores de departamento son los de `data/catalogos.json`
   (columna `id`), no el nombre completo. Los perfiles válidos son `equipo`,
   `jefatura` y `control_gestion`.

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
