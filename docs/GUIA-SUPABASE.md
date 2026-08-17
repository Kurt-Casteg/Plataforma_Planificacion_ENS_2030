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
     (ej. `https://kurt-casteg.github.io/Mini_Plataforma/`).
   - **Redirect URLs**: agrega la misma dirección.

> Sin este paso, el enlace de acceso que llega por correo no devuelve a la
> plataforma.

---

## Paso 4 · Conectar la plataforma

1. En Supabase: **Project Settings** → **API**. Copia:
   - **Project URL** (algo como `https://abcdefghijk.supabase.co`)
   - **anon public** (una clave larga)
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

## Paso 5 · Asignar roles

La primera vez que cada persona inicia sesión se crea su perfil automáticamente
con el rol `equipo`. Luego, en Supabase → **SQL Editor**, asigna los roles:

```sql
-- Control de Gestión: ve y consolida todo
update public.perfiles
  set rol = 'control_gestion', departamento = 'dpto_control_gestion'
  where correo = 'kcasteg@redsalud.gob.cl';

-- Una jefatura: ve todo lo de su departamento
update public.perfiles
  set rol = 'jefatura', departamento = 'dpto_salud_publica'
  where correo = 'jefatura.sp@redsalud.gob.cl';

-- El resto: solo su propio trabajo
update public.perfiles
  set departamento = 'dpto_accion_sanitaria'
  where correo = 'persona@redsalud.gob.cl';
```

Los identificadores de departamento son los mismos de `data/catalogos.json`.

Qué ve cada rol:

| Rol | Puede ver | Puede editar |
|---|---|---|
| `equipo` | Sus propias actividades | Las suyas |
| `jefatura` | Todas las de su departamento | Las suyas |
| `control_gestion` | Todas | Todas |

---

## Paso 6 · Comprobar

1. Abre la plataforma. Arriba a la derecha dirá **«Sin sesión»**; haz clic ahí.
2. Escribe tu correo institucional → **Enviar enlace**.
3. Revisa tu correo y abre el enlace: vuelves a la plataforma ya identificado.
4. Guarda una actividad de prueba.
5. En Supabase → **Table Editor** → `actividades`: debe aparecer la fila.
6. Entra desde otro navegador con otra cuenta: **no** debe ver esa actividad
   (a menos que tenga rol `control_gestion`).

Ese último punto es la verificación importante: confirma que las reglas de
seguridad están activas.

---

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
