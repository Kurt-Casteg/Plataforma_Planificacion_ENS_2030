# Guía: activar la base de datos compartida (opcional)

Mientras esta función esté apagada, cada equipo guarda sus actividades en su
propio navegador y las comparte enviando un respaldo JSON. Funciona, pero obliga
a Control de Gestión a pedir, juntar e importar archivos.

Al activarla, cada persona inicia sesión con su correo institucional y sus
actividades quedan en una base de datos común: Control de Gestión ve el
consolidado en tiempo real, sin pedir nada.

**Costo:** $0. El plan gratuito de Supabase incluye 500 MB de base de datos y
50.000 usuarios activos al mes; esta plataforma usa una fracción mínima de eso.

**Tiempo estimado:** 20 minutos.

---

## Paso 1 · Crear el proyecto

1. Entra a [supabase.com](https://supabase.com) y crea una cuenta.
2. **New project**.
   - **Name**: `planificacion-seremi-nuble`
   - **Database password**: genera una y guárdala en un lugar seguro (no se usa
     en la plataforma, pero sirve para administrar la base).
   - **Region**: `South America (São Paulo)` — es la más cercana a Chile.
3. Espera un par de minutos mientras se aprovisiona.

---

## Paso 2 · Crear las tablas y las reglas de seguridad

1. En el menú lateral, **SQL Editor** → **New query**.
2. Abre el archivo `docs/esquema.sql` de esta plataforma, copia **todo** su
   contenido y pégalo.
3. **Run**.

Debe terminar con «Success». Esto crea:

- La tabla `perfiles` (quién es cada persona, de qué departamento y con qué rol).
- La tabla `actividades` (las actividades planificadas).
- Las políticas de **Row Level Security**, que son la protección real: se aplican
  dentro del servidor de base de datos, así que no se pueden saltar desde el
  navegador ni aunque alguien inspeccione el código.
- La vista `consolidado`, pensada para Control de Gestión, Excel o Power BI.

---

## Paso 3 · Configurar el acceso por correo

1. **Authentication** → **Providers** → **Email**.
2. Activa **Enable Email provider**.
3. Desactiva **Confirm email** solo si quieres que el primer ingreso sea
   inmediato; si lo dejas activo, la persona confirma su correo una vez.
4. **Authentication** → **URL Configuration**:
   - **Site URL**: la dirección pública de la plataforma
     (ej. `https://kurt-casteg.github.io/Plataforma_Planificacion_ENS_2030/`).
   - **Redirect URLs**: agrega la misma dirección.

> Sin este paso, el enlace de acceso que llega por correo no devuelve a la
> plataforma.

---

## Paso 4 · Conectar la plataforma

1. En Supabase: **Project Settings** → **API**. Copia:
   - **Project URL** (algo como `https://abcdefghijk.supabase.co`)
   - **anon public** (una clave larga)

> ⚠️ **El error más frecuente.** Copia la **Project URL**, que es solo el dominio.
> No copies la dirección de la API REST (`.../rest/v1/`) ni dejes una barra al
> final: la librería agrega ella misma `/auth/v1` y `/rest/v1`, así que una ruta
> de más produce peticiones a rutas dobles y Supabase responde
> **«Invalid path specified in request URL»** al intentar iniciar sesión.
>
> | Correcto | Incorrecto |
> |---|---|
> | `https://abcdefghijk.supabase.co` | `https://abcdefghijk.supabase.co/` |
> | | `https://abcdefghijk.supabase.co/rest/v1/` |
> | | `https://supabase.com/dashboard/project/abcdefghijk` |
>
> La plataforma corrige la URL automáticamente y avisa en la consola del
> navegador, pero conviene dejarla bien escrita en `config.js`.
2. Abre `config.js` en la plataforma y complétalo:

```js
nube: {
  habilitada: true,
  url: 'https://abcdefghijk.supabase.co',
  anonKey: 'eyJhbGciOi...',
  dominiosPermitidos: ['redsalud.gob.cl', 'minsal.cl']
}
```

3. Guarda, haz `git add . && git commit -m "Activar sincronización" && git push`.

> La clave `anon` es pública por diseño: viaja al navegador de cada persona.
> No es un secreto y no da acceso a nada por sí sola — quien decide qué puede
> leer o escribir cada usuario son las políticas del Paso 2.

---

## Paso 5 · Cargar la nómina de personas

La plataforma completa sola el nombre, el correo y el departamento de cada
persona a partir de su sesión. Para que sepa quién es quién, se carga la nómina.

1. Abre el archivo **`docs/nomina.sql`** de la plataforma.
2. Cópialo completo y pégalo en **SQL Editor** → **Run**.

Al final devuelve un resumen por departamento; si ves las 40 personas
distribuidas, quedó bien.

Ese archivo es la lista oficial: cuando alguien entre, se vaya, cambie de
departamento o de perfil, se edita ahí y se vuelve a ejecutar entero. Es seguro
repetirlo cuantas veces quieras — actualiza a quien ya existe, agrega a quien
falta y no duplica a nadie. Los cambios alcanzan también a quien ya tenga sesión
creada.

### Los tres perfiles

| Rol | Puede ver | Puede editar |
|---|---|---|
| `equipo` | Sus propias actividades | Las suyas |
| `jefatura` | Todas las de su departamento | Las suyas |
| `control_gestion` | Todas | Todas |

### Quien no esté en la nómina

Igual puede entrar, con perfil `equipo`. La plataforma deduce su nombre del
correo (`albert.mercado@…` → «Albert Mercado») y le pide elegir su departamento
una sola vez; después queda guardado en su perfil.

Si prefieres que solo entre gente de la nómina, avísame: es una política más en
la base de datos.

## Paso 6 · Comprobar

1. Abre la plataforma. Arriba a la derecha dirá **«Sin sesión»**; haz clic ahí.
2. Escribe tu correo institucional → **Enviar enlace**.
3. Revisa tu correo y abre el enlace: vuelves a la plataforma ya identificado.
4. En la sección **Identificación** deben aparecer solos tu nombre, tu correo y
   tu departamento, con la insignia «Desde tu sesión», y el código de actividad
   debe decir «Automático · N° 1».
5. Guarda una actividad de prueba. El aviso debe confirmar el código asignado.
6. En Supabase → **Table Editor** → `actividades`: debe aparecer la fila.
7. Entra desde otro navegador con otra cuenta: **no** debe ver esa actividad
   (a menos que tenga rol `control_gestion`).

El punto 7 es la verificación importante: confirma que las reglas de seguridad
están activas y que la clave pública de la plataforma no sirve para ver datos
ajenos.

## Consolidar y analizar

Para Control de Gestión, la vista `consolidado` entrega todo listo:

```sql
select * from public.consolidado where anio = 2026 order by departamento, codigo;
```

Desde ahí se puede:

- Descargar como CSV con el botón **Download** de Supabase.
- Conectar Power BI o Excel al endpoint PostgREST del proyecto.
- Consultar totales directamente:

```sql
select departamento,
       count(*)                    as actividades,
       sum(ejecuciones)            as ejecuciones,
       sum(presupuesto_total)      as presupuesto_miles
from public.consolidado
where anio = 2026
group by departamento
order by presupuesto_miles desc;
```

---

## Cómo desactivarla

Pon `habilitada: false` en `config.js` y publica. La plataforma vuelve al modo
local y nadie pierde nada: los datos siguen tanto en la base como en cada
navegador.

---

## Respaldos de la base

Supabase respalda automáticamente en el plan gratuito, pero conviene una copia
propia. Una vez al mes, en **SQL Editor**:

```sql
select * from public.actividades;
```

y usa **Download CSV**. Guarda el archivo en la carpeta institucional.

---

## Problemas frecuentes

**«Invalid path specified in request URL»**
La URL en `config.js` tiene una ruta o una barra de más. Debe ser solo
`https://xxxxx.supabase.co`. Ver el aviso del Paso 4.

**El enlace del correo no llega**
Revisa la carpeta de correo no deseado. Si tampoco está, verifica en
**Authentication** → **Providers** → **Email** que el proveedor esté activo.
El plan gratuito limita los correos por hora; si estás probando mucho, espera un
rato o configura un servidor SMTP propio en **Project Settings** → **Auth**.

**El enlace llega pero devuelve a una página en blanco o a localhost**
Falta registrar la dirección pública en **Authentication** → **URL Configuration**,
tanto en **Site URL** como en **Redirect URLs**. Debe coincidir exactamente con la
dirección donde está publicada la plataforma, incluida la barra final:
`https://kurt-casteg.github.io/Plataforma_Planificacion_ENS_2030/`

**«Solo se permiten correos de: …»**
El dominio del correo no está en `dominiosPermitidos` de `config.js`. Agrégalo o
deja la lista vacía (`[]`) para no restringir.

**Inicio de sesión correcto, pero no aparece ninguna actividad**
Es lo esperado la primera vez: cada persona ve solo lo suyo. Si eres Control de
Gestión y no ves el resto, falta asignarte el rol `control_gestion` (Paso 5).

**«new row violates row-level security policy»**
La sesión expiró o el perfil no se creó. Cierra sesión, vuelve a entrar, y
comprueba en **Table Editor** → `perfiles` que exista tu fila.
