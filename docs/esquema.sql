-- =============================================================================
--  Esquema de la base de datos · Plataforma de Planificación
--  SEREMI de Salud de Ñuble
--
--  Se ejecuta en el editor SQL de Supabase (SQL Editor → New query).
--  Es IDEMPOTENTE: puede volver a ejecutarse sobre una base existente sin
--  borrar datos ni duplicar nada. Ejecútalo completo cada vez que se actualice.
--
--  Nota de seguridad: la clave "anon" de la plataforma es pública por diseño y
--  viaja al navegador de cada persona. Lo único que impide que alguien la use
--  para leer o alterar datos ajenos son las políticas de Row Level Security de
--  este archivo, que se aplican DENTRO del servidor de base de datos. Por eso
--  aquí no se confía en ningún valor enviado por el navegador: el departamento,
--  el propietario, los perfiles y el correo se fijan del lado del servidor.
-- =============================================================================


-- =============================================================================
--  1. PERFILES
--
--  Una cuenta puede tener VARIOS perfiles y usar uno a la vez.
--
--    roles       lista de perfiles a los que la persona tiene derecho.
--                Solo la asigna el administrador (nómina o editor SQL).
--    rol_activo  el que está en uso ahora mismo. La persona lo cambia desde
--                la plataforma, pero solo puede elegir dentro de `roles`.
--
--  El cambio de perfil NO es cosmético: `mi_rol()` devuelve `rol_activo`, y
--  todas las políticas de seguridad consultan esa función. Alguien que tenga
--  Control de Gestión y esté usando Observador es, para la base de datos, un
--  observador: sus intentos de escribir se rechazan aquí, no en el navegador.
--
--  Perfiles disponibles:
--    equipo           ve y edita solo lo suyo
--    jefatura         ve todo su departamento, edita solo lo suyo
--    control_gestion  ve y edita todo; consolida; mantiene la nómina
--    observador       ve todo, no modifica nada
-- =============================================================================

create table if not exists public.perfiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  correo        text not null,
  nombre        text,
  departamento  text,
  roles         text[] not null default array['equipo']::text[],
  rol_activo    text,
  creado_en     timestamptz not null default now()
);

-- Columnas agregadas después de la primera versión.
alter table public.perfiles add column if not exists nombre     text;
alter table public.perfiles add column if not exists roles      text[];
alter table public.perfiles add column if not exists rol_activo text;

-- --- Migración desde la versión de un solo perfil ------------------------------
-- Las bases creadas con el esquema anterior tienen una columna `rol` de texto.
-- Se traslada a la lista y se elimina. Correr esto dos veces no hace nada la
-- segunda vez: cuando la columna ya no existe, el bloque se salta entero.

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'perfiles' and column_name = 'rol'
  ) then
    execute 'update public.perfiles set roles = array[rol] where roles is null';
    execute 'update public.perfiles set rol_activo = rol where rol_activo is null';
  end if;
end $$;

update public.perfiles set roles = array['equipo']::text[]
 where roles is null or cardinality(roles) = 0;

-- El primero de la lista es el perfil con el que se entra.
update public.perfiles set rol_activo = roles[1]
 where rol_activo is null or not (rol_activo = any (roles));

alter table public.perfiles alter column roles set default array['equipo']::text[];
alter table public.perfiles alter column roles set not null;

alter table public.perfiles drop constraint if exists perfiles_roles_validos;
alter table public.perfiles add constraint perfiles_roles_validos check (
  cardinality(roles) between 1 and 4
  and roles <@ array['equipo', 'jefatura', 'control_gestion', 'observador']::text[]
);

-- `rol_activo` NO lleva restricción de tabla a propósito. La coherencia con
-- `roles` la mantiene el trigger de la sección 4, que lo corrige en vez de
-- rechazar la operación. Si fuera una restricción, recortarle la lista de
-- perfiles a alguien desde el editor SQL fallaría hasta que el administrador
-- acordara además, a mano, cambiarle el perfil activo.
alter table public.perfiles drop constraint if exists perfiles_rol_activo_valido;

-- Ya migrada: la columna de un solo perfil desaparece.
alter table public.perfiles drop column if exists rol;

comment on column public.perfiles.roles is
  'Perfiles a los que la cuenta tiene derecho. Solo los asigna el administrador. El primero es el de entrada.';
comment on column public.perfiles.rol_activo is
  'Perfil en uso. La persona lo cambia desde la plataforma, siempre dentro de `roles`.';


-- =============================================================================
--  2. FUNCIONES INTERNAS DE SEGURIDAD
--
--  Viven en el esquema `privado`, NO en `public`, y la razón es concreta:
--  PostgREST publica como API REST todo lo que hay en los esquemas expuestos,
--  así que una función en `public` queda disponible en /rest/v1/rpc/<nombre>
--  para cualquiera que tenga la clave anon. Estas son plomería interna de las
--  políticas de seguridad y no tienen por qué ser un punto de entrada.
--
--  IMPORTANTE — no revocar el permiso de ejecución:
--  PostgreSQL comprueba el privilegio EXECUTE de estas funciones al evaluar las
--  políticas, con la identidad de quien consulta. Si se les revoca EXECUTE a
--  `anon` y `authenticated`, TODA consulta falla con «permission denied for
--  function» y nadie puede entrar. Sacarlas del esquema expuesto quita el
--  endpoint sin tocar el permiso, que es lo que hay que hacer.
--
--  Todas llevan `set search_path = ''` y referencias calificadas: así no
--  dependen del search_path de quien las invoca, que en una función SECURITY
--  DEFINER es una vía de escalada conocida.
-- =============================================================================

create schema if not exists privado;

comment on schema privado is
  'Funciones internas de seguridad. Queda FUERA de los esquemas expuestos por la API: nada de aquí es invocable desde el navegador.';

-- El navegador no debe poder ni mirar qué hay aquí dentro.
revoke all on schema privado from public;
grant usage on schema privado to anon, authenticated;

-- Perfil que rige AHORA para quien hace la consulta. Si el perfil activo no
-- está entre los suyos (dato viejo, lista recortada por el administrador), se
-- cae al primero de la lista en vez de conceder nada.
create or replace function privado.mi_rol()
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select case
              when p.rol_activo is not null and p.rol_activo = any (p.roles) then p.rol_activo
              else p.roles[1]
            end
       from public.perfiles p
      where p.id = auth.uid()),
    'equipo'
  );
$$;

-- Todos los perfiles a los que la cuenta tiene derecho.
create or replace function privado.mis_roles()
returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select roles from public.perfiles where id = auth.uid()),
    array['equipo']::text[]
  );
$$;

create or replace function privado.mi_departamento()
returns text language sql stable security definer set search_path = '' as $$
  select (select departamento from public.perfiles where id = auth.uid());
$$;

-- Un único lugar donde se decide quién puede modificar datos. Las políticas de
-- escritura la consultan, así que agregar mañana otro perfil de solo lectura es
-- editar esta función y nada más.
create or replace function privado.puede_escribir()
returns boolean language sql stable security definer set search_path = '' as $$
  select privado.mi_rol() <> 'observador';
$$;

-- ¿Ve el trabajo de toda la institución?
create or replace function privado.ve_todo()
returns boolean language sql stable security definer set search_path = '' as $$
  select privado.mi_rol() in ('control_gestion', 'observador');
$$;

-- Nombre legible a partir del correo, para quien no esté en la nómina:
-- albert.mercado@… → "Albert Mercado".
create or replace function privado.nombre_desde_correo(p_correo text)
returns text language sql immutable set search_path = '' as $$
  select initcap(replace(replace(split_part(coalesce(p_correo, ''), '@', 1), '.', ' '), '_', ' '));
$$;

grant execute on all functions in schema privado to anon, authenticated;


-- =============================================================================
--  3. PERSONAS AUTORIZADAS
--     Se precarga desde la planilla institucional. Cuando alguien entra por
--     primera vez, su perfil se completa solo a partir de esta tabla.
-- =============================================================================

create table if not exists public.usuarios_autorizados (
  correo        text primary key,
  nombre        text,
  departamento  text,
  roles         text[] not null default array['equipo']::text[],
  cargado_en    timestamptz not null default now()
);

alter table public.usuarios_autorizados add column if not exists roles text[];

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'usuarios_autorizados' and column_name = 'rol'
  ) then
    execute 'update public.usuarios_autorizados set roles = array[rol] where roles is null';
  end if;
end $$;

update public.usuarios_autorizados set roles = array['equipo']::text[]
 where roles is null or cardinality(roles) = 0;

alter table public.usuarios_autorizados alter column roles set default array['equipo']::text[];
alter table public.usuarios_autorizados alter column roles set not null;

alter table public.usuarios_autorizados drop constraint if exists autorizados_roles_validos;
alter table public.usuarios_autorizados add constraint autorizados_roles_validos check (
  cardinality(roles) between 1 and 4
  and roles <@ array['equipo', 'jefatura', 'control_gestion', 'observador']::text[]
);

alter table public.usuarios_autorizados drop column if exists rol;

comment on table public.usuarios_autorizados is
  'Nómina institucional. Al primer ingreso, el perfil de la persona se completa desde aquí.';

-- Contiene la nómina completa (nombres, correos, departamentos): solo Control
-- de Gestión puede consultarla. Un observador ve las actividades de todos, pero
-- no la lista de quién tiene acceso ni con qué perfil. El resto la usa
-- indirectamente, a través del trigger de creación de perfil, que corre con
-- privilegios elevados.
alter table public.usuarios_autorizados enable row level security;

drop policy if exists "control de gestión ve la nómina" on public.usuarios_autorizados;
create policy "control de gestión ve la nómina" on public.usuarios_autorizados
  for select using (privado.mi_rol() = 'control_gestion');

drop policy if exists "control de gestión edita la nómina" on public.usuarios_autorizados;
create policy "control de gestión edita la nómina" on public.usuarios_autorizados
  for all using (privado.mi_rol() = 'control_gestion')
  with check (privado.mi_rol() = 'control_gestion');


-- =============================================================================
--  3b. QUIÉN PUEDE REGISTRARSE
--
--  Hasta la versión 3.4 esta restricción vivía SOLO en el navegador: un `if`
--  en `js/core/nube.js` comparaba el dominio del correo antes de pedir el
--  enlace de acceso. Eso no es una restricción, es una cortesía: cualquiera
--  que abriera la consola del navegador y llamara directamente a la API de
--  Supabase se registraba igual, con cualquier correo.
--
--  Aquí queda del lado del servidor, que es el único lugar donde una regla de
--  acceso significa algo. Hay dos caminos posibles (hoy se usa solo el 2: la
--  tabla de dominios está vacía, ver más abajo):
--
--    1. El dominio del correo está en `dominios_permitidos`  → entra la
--       institución completa sin tener que enumerar a nadie.
--    2. El correo exacto está en `usuarios_autorizados`      → la excepción
--       nominal, persona por persona.
--
--  Nótese que la excepción NO es una lista aparte: es la misma nómina que ya
--  define nombre, departamento y perfiles. Autorizar a alguien de fuera es el
--  mismo gesto que dar de alta a cualquier funcionario, y no requiere tocar
--  código ni desplegar el sitio.
-- =============================================================================

create table if not exists public.dominios_permitidos (
  dominio     text primary key,
  nota        text,
  cargado_en  timestamptz not null default now()
);

comment on table public.dominios_permitidos is
  'Dominios de correo que pueden registrarse sin estar en la nómina. Un registro con dominio = ''*'' desactiva la restricción por completo.';

-- Sin semilla, a propósito. Desde la versión 3.10.1 la plataforma funciona
-- SOLO CON LA NÓMINA: puede crear cuenta únicamente quien esté en
-- `usuarios_autorizados`, aunque tenga correo institucional. Así nadie ajeno a
-- la planificación carga actividades por su cuenta.
--
-- Antes este archivo insertaba redsalud.gob.cl y minsal.cl aquí. Se quitó para
-- que volver a ejecutar el esquema no reabra el acceso por dominio sin que
-- nadie lo note. Si algún día se quiere abrir un dominio completo:
--
--   insert into public.dominios_permitidos (dominio, nota)
--   values ('redsalud.gob.cl', 'Correo institucional de la red asistencial');
--
-- Para cerrar el acceso en una base que ya tenía los dominios cargados, ver
-- docs/acceso-solo-nomina.sql.

-- Solo Control de Gestión ve y edita esta lista: es una llave de acceso, no un
-- catálogo. El trigger que la consulta corre con privilegios elevados, así que
-- no necesita que nadie más pueda leerla.
alter table public.dominios_permitidos enable row level security;

drop policy if exists "control de gestión ve los dominios" on public.dominios_permitidos;
create policy "control de gestión ve los dominios" on public.dominios_permitidos
  for select using (privado.mi_rol() = 'control_gestion');

drop policy if exists "control de gestión edita los dominios" on public.dominios_permitidos;
create policy "control de gestión edita los dominios" on public.dominios_permitidos
  for all using (privado.mi_rol() = 'control_gestion')
  with check (privado.mi_rol() = 'control_gestion');


-- --- ¿Este correo puede registrarse? -------------------------------------------
--
-- Todo en minúsculas a ambos lados: los correos llegan como los escribió la
-- persona y «Nombre.Apellido@Redsalud.gob.cl» debe valer lo mismo que su
-- versión en minúsculas.

create or replace function privado.correo_autorizado(p_correo text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    -- Excepción nominal: está en la nómina institucional.
    exists (
      select 1 from public.usuarios_autorizados u
       where lower(u.correo) = lower(trim(coalesce(p_correo, '')))
    )
    -- O su dominio está autorizado en bloque.
    or exists (
      select 1 from public.dominios_permitidos d
       where d.dominio = '*'
          or lower(d.dominio) = lower(split_part(trim(coalesce(p_correo, '')), '@', 2))
    );
$$;


-- --- El portero -----------------------------------------------------------------
--
-- Va en BEFORE INSERT sobre auth.users, así que corta el registro ANTES de que
-- exista la cuenta: no queda ningún rastro de la persona rechazada.
--
-- Solo afecta a cuentas NUEVAS. Quien ya tiene cuenta creada sigue entrando con
-- normalidad aunque su correo dejara de estar autorizado, porque en ese caso
-- Supabase no inserta nada: solo envía el enlace. Para quitarle el acceso a
-- alguien hay que eliminar su cuenta, no basta con sacarlo de la nómina.
--
-- Ojo: esto también aplica a las cuentas creadas a mano desde el panel de
-- Supabase. Si hace falta crear una, primero se agrega el correo a la nómina.

create or replace function privado.exigir_correo_autorizado()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not privado.correo_autorizado(new.email) then
    raise exception 'El correo % no está autorizado para registrarse.', new.email
      using errcode = 'insufficient_privilege',
            hint = 'Solicita la autorización al Departamento de Control de Gestión.';
  end if;
  return new;
end;
$$;

drop trigger if exists al_registrar_usuario on auth.users;
create trigger al_registrar_usuario
  before insert on auth.users
  for each row execute function privado.exigir_correo_autorizado();


-- =============================================================================
--  4. ALTA AUTOMÁTICA Y PROTECCIÓN DEL PERFIL
-- =============================================================================

-- --- Creación automática del perfil al registrarse -----------------------------

create or replace function privado.crear_perfil()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  autorizado public.usuarios_autorizados%rowtype;
  v_roles    text[];
begin
  select * into autorizado
    from public.usuarios_autorizados
   where lower(correo) = lower(new.email);

  v_roles := coalesce(autorizado.roles, array['equipo']::text[]);

  insert into public.perfiles (id, correo, nombre, departamento, roles, rol_activo)
  values (
    new.id,
    new.email,
    -- Si está en la nómina se usa su nombre oficial; si no, se deduce del correo.
    coalesce(nullif(autorizado.nombre, ''), privado.nombre_desde_correo(new.email)),
    nullif(autorizado.departamento, ''),
    v_roles,
    v_roles[1]
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists al_crear_usuario on auth.users;
create trigger al_crear_usuario
  after insert on auth.users
  for each row execute function privado.crear_perfil();


-- --- Permisos del rol de autenticación ------------------------------------------
--
-- Quien inserta en `auth.users` no es la persona que se registra, sino el rol
-- interno de Supabase `supabase_auth_admin`. PostgreSQL exige que ese rol pueda
-- EJECUTAR las funciones de los triggers —aunque sean `security definer`— y el
-- esquema `privado` solo concede USAGE a `anon` y `authenticated`.
--
-- Sin estas líneas, el alta de cualquier persona nueva falla con «permission
-- denied for schema privado», incluidas las que sí están autorizadas. Es el
-- mismo mecanismo que apareció al mover las funciones de seguridad fuera de
-- `public`: PostgreSQL comprueba el permiso contra el rol que EJECUTA la
-- operación, no contra el dueño de la función.
--
-- Va aquí, y no junto a cada función, porque a esta altura del archivo ya
-- existen todas. El bloque se salta solo si el rol no existe, para que este
-- archivo siga pudiendo ejecutarse en una base PostgreSQL corriente.

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    execute 'grant usage on schema privado to supabase_auth_admin';
    execute 'grant execute on function privado.exigir_correo_autorizado() to supabase_auth_admin';
    execute 'grant execute on function privado.correo_autorizado(text) to supabase_auth_admin';
    execute 'grant execute on function privado.crear_perfil() to supabase_auth_admin';
    execute 'grant execute on function privado.nombre_desde_correo(text) to supabase_auth_admin';
  end if;
end $$;


-- --- Nadie se asigna perfiles a sí mismo ---------------------------------------
-- Un trigger es más robusto que una condición en la política: reescribe los
-- campos protegidos en vez de rechazar la operación, así la persona sí puede
-- actualizar lo que le corresponde (su departamento y su perfil activo).
--
-- La distinción clave está en `rol_activo`: cambiarlo es una operación
-- LEGÍTIMA de cualquier persona sobre su propia fila, pero solo hacia un perfil
-- que ya tenga en `roles`. Ahí está toda la seguridad del selector: la lista de
-- perfiles la fija el administrador y el navegador no puede tocarla.

create or replace function privado.proteger_perfil()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_activo text;
begin
  -- --- Protección frente al navegador ---------------------------------------
  -- auth.uid() es NULL cuando la sentencia viene del editor SQL de Supabase o
  -- de la clave de servicio. En ese caso quien manda es el administrador y no
  -- se restringe nada: es la vía por la que se asignan los perfiles.
  if tg_op = 'UPDATE' and auth.uid() is not null then

    -- Se mira el perfil ACTIVO, no los que la persona podría usar: quien tiene
    -- Control de Gestión pero está usando Observador no administra nada
    -- mientras dure ese modo. Es lo que hace del selector una restricción real.
    select case
             when p.rol_activo is not null and p.rol_activo = any (p.roles) then p.rol_activo
             else p.roles[1]
           end
      into v_activo
      from public.perfiles p
     where p.id = auth.uid();

    if coalesce(v_activo, 'equipo') <> 'control_gestion' then
      -- Identidad y lista de perfiles: intocables desde el navegador.
      new.id     := old.id;
      new.correo := old.correo;
      new.roles  := old.roles;

      -- Perfil activo: se acepta solo si pertenece a la lista asignada. Si no,
      -- se deja el anterior en silencio; el cliente vuelve a leer la fila y
      -- muestra lo que quedó, así que nadie ve un estado que no es real.
      if new.rol_activo is null or not (new.rol_activo = any (old.roles)) then
        new.rol_activo := old.rol_activo;
      end if;
    end if;
  end if;

  -- --- Coherencia, venga de donde venga la sentencia --------------------------
  -- Vale también para el administrador: si le recorta la lista a alguien y su
  -- perfil activo deja de estar en ella, se ajusta al primero de la nueva lista
  -- en lugar de dejar la fila en un estado imposible.
  --
  -- Una lista vacía se corrige al perfil MÍNIMO, nunca a uno amplio: si algo
  -- llega mal, que falle hacia el lado que no concede permisos.
  if new.roles is null or cardinality(new.roles) = 0 then
    new.roles := array['equipo']::text[];
  end if;
  if new.rol_activo is null or not (new.rol_activo = any (new.roles)) then
    new.rol_activo := new.roles[1];
  end if;

  return new;
end;
$$;

drop trigger if exists al_actualizar_perfil on public.perfiles;
create trigger al_actualizar_perfil
  before insert or update on public.perfiles
  for each row execute function privado.proteger_perfil();


-- =============================================================================
--  5. ACTIVIDADES
--     El detalle vive en JSONB: agregar campos al formulario no obliga a
--     migrar la base de datos.
-- =============================================================================

create table if not exists public.actividades (
  id             uuid primary key,
  plan           text not null check (plan in ('pns', 'pgi')),
  anio           integer not null check (anio between 2020 and 2100),
  departamento   text,
  propietario    uuid not null references auth.users (id) on delete cascade,
  datos          jsonb not null,
  creada_en      timestamptz not null default now(),
  actualizada_en timestamptz not null default now()
);

create index if not exists actividades_plan_anio_idx      on public.actividades (plan, anio);
create index if not exists actividades_propietario_idx    on public.actividades (propietario);
create index if not exists actividades_departamento_idx   on public.actividades (departamento);
create index if not exists actividades_datos_idx          on public.actividades using gin (datos);


-- --- El servidor fija propietario, departamento y fecha ------------------------
-- El navegador puede enviar cualquier cosa: aquí se corrige. Esto impide que
-- alguien atribuya actividades a otro departamento o a otra persona.

create or replace function privado.normalizar_actividad()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_depto text;
  v_rol   text;
begin
  new.actualizada_en := now();

  -- Sin sesión de usuario (editor SQL, clave de servicio, importación masiva)
  -- se respeta lo que envía el administrador.
  if auth.uid() is null then
    return new;
  end if;

  v_rol := privado.mi_rol();

  -- Las políticas de más abajo ya rechazan la escritura de un observador. Esto
  -- es una segunda barrera con un mensaje legible: un rechazo de RLS llega al
  -- navegador como «new row violates row-level security policy», que no le dice
  -- nada a nadie.
  if v_rol = 'observador' then
    raise exception 'El perfil Observador es de solo lectura: no puede crear ni modificar actividades'
      using errcode = 'P0001';
  end if;

  select departamento into v_depto
    from public.perfiles where id = auth.uid();

  if tg_op = 'INSERT' then
    -- El propietario es siempre quien inserta (salvo Control de Gestión,
    -- que puede cargar en nombre de otro al consolidar).
    if v_rol <> 'control_gestion' then
      new.propietario := auth.uid();
    end if;
  else
    -- En una edición, el propietario y la fecha de creación no se tocan.
    if v_rol <> 'control_gestion' then
      new.propietario := old.propietario;
    end if;
    new.creada_en := old.creada_en;
  end if;

  -- El departamento lo manda el perfil, no el formulario.
  if v_rol <> 'control_gestion' and v_depto is not null and v_depto <> '' then
    new.departamento := v_depto;
    new.datos := jsonb_set(new.datos, '{departamento}', to_jsonb(v_depto), true);
  end if;

  return new;
end;
$$;

-- La primera versión del esquema usaba esta función; ahora su trabajo lo hace
-- normalizar_actividad(). Se elimina para no dejar objetos sin uso en la base.
drop trigger if exists al_actualizar_actividad on public.actividades;
drop function if exists public.tocar_actualizada_en();
drop trigger if exists al_guardar_actividad on public.actividades;
create trigger al_guardar_actividad
  before insert or update on public.actividades
  for each row execute function privado.normalizar_actividad();


-- =============================================================================
--  6. CORRELATIVO AUTOMÁTICO POR DEPARTAMENTO
--     Un contador por (plan, año, departamento). La reserva es atómica, así
--     que dos personas guardando a la vez nunca obtienen el mismo número.
-- =============================================================================

create table if not exists public.correlativos (
  plan          text not null,
  anio          integer not null,
  departamento  text not null,
  ultimo        integer not null default 0,
  primary key (plan, anio, departamento)
);

comment on table public.correlativos is
  'Contador de códigos de actividad. Solo se accede a través de reservar_codigo().';

-- Sin políticas: la tabla queda cerrada a todo el mundo. La única vía de acceso
-- es la función de abajo, que corre con privilegios elevados y devuelve un
-- número, nunca datos de nadie.
alter table public.correlativos enable row level security;

-- Esta SÍ vive en `public` y SÍ es invocable desde el navegador: es la única
-- función pensada como API. El linter de Supabase la marcará como «SECURITY
-- DEFINER ejecutable por usuarios autenticados», y es correcto que lo haga —
-- conviene que avise. Es deliberado, y está acotada: exige sesión, valida el
-- plan y el año, rechaza a los perfiles de solo lectura, toma el departamento
-- del perfil y nunca de un parámetro, y devuelve un número, jamás datos.
create or replace function public.reservar_codigo(p_plan text, p_anio integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_depto  text;
  v_codigo integer;
begin
  if auth.uid() is null then
    raise exception 'Sesión no iniciada';
  end if;
  if p_plan not in ('pns', 'pgi') then
    raise exception 'Plan no válido: %', p_plan;
  end if;
  if p_anio is null or p_anio < 2020 or p_anio > 2100 then
    raise exception 'Año no válido: %', p_anio;
  end if;

  -- Un observador no registra actividades, así que tampoco consume numeración:
  -- de otro modo dejaría huecos en la serie de su departamento con solo abrir
  -- el formulario.
  if not privado.puede_escribir() then
    raise exception 'El perfil Observador es de solo lectura: no puede reservar códigos'
      using errcode = 'P0001';
  end if;

  -- El departamento se toma del perfil, no de un parámetro: nadie puede
  -- consumir la numeración de otro departamento.
  select departamento into v_depto from public.perfiles where id = auth.uid();
  v_depto := nullif(v_depto, '');

  -- Sin departamento no hay serie a la que pertenecer. Se rechaza en vez de
  -- abrir una serie "sin_departamento" que después habría que reconciliar.
  if v_depto is null then
    raise exception 'Tu perfil no tiene departamento asignado' using errcode = 'P0001';
  end if;

  insert into public.correlativos as c (plan, anio, departamento, ultimo)
  values (p_plan, p_anio, v_depto, 1)
  on conflict (plan, anio, departamento)
  do update set ultimo = c.ultimo + 1
  returning c.ultimo into v_codigo;

  return v_codigo;
end;
$$;

revoke all on function public.reservar_codigo(text, integer) from public, anon;
grant execute on function public.reservar_codigo(text, integer) to authenticated;

-- Alinea el contador con lo que ya existe, para no repetir códigos ya usados.
insert into public.correlativos (plan, anio, departamento, ultimo)
select a.plan,
       a.anio,
       a.departamento,
       max((a.datos ->> 'codigoActividad')::integer)
  from public.actividades a
 where a.datos ->> 'codigoActividad' ~ '^[0-9]+$'
   and coalesce(a.departamento, '') <> ''
 group by 1, 2, 3
on conflict (plan, anio, departamento)
do update set ultimo = greatest(public.correlativos.ultimo, excluded.ultimo);


-- =============================================================================
--  7. ROW LEVEL SECURITY
--
--  Quién ve qué y quién escribe qué, según el perfil ACTIVO:
--
--    perfil            lee                        escribe
--    ----------------  -------------------------  ------------------------
--    equipo            lo suyo                    lo suyo
--    jefatura          su departamento            lo suyo
--    control_gestion   todo                       todo
--    observador        todo                       nada
--
--  «Escribe nada» incluye sus propias actividades: quien tiene los perfiles
--  Equipo y Observador y está usando Observador no puede editar ni siquiera lo
--  que él mismo cargó. Por eso las políticas de escritura empiezan por
--  puede_escribir() en vez de confiar en `propietario = auth.uid()`.
-- =============================================================================

alter table public.perfiles    enable row level security;
alter table public.actividades enable row level security;

-- --- Perfiles ---------------------------------------------------------------

-- El observador ve los perfiles porque la vista consolidada los usa para poner
-- nombre y correo al responsable de cada actividad, que de todos modos ya viene
-- dentro de las actividades que puede leer. La nómina completa (sección 3) sigue
-- reservada a Control de Gestión.
drop policy if exists "ver mi perfil" on public.perfiles;
create policy "ver mi perfil" on public.perfiles
  for select using (
    id = auth.uid()
    or privado.ve_todo()
    or (privado.mi_rol() = 'jefatura' and departamento = privado.mi_departamento())
  );

-- Un observador SÍ puede actualizar su propia fila: es la vía por la que cambia
-- de perfil y sale del modo de solo lectura. El trigger proteger_perfil() limita
-- esa actualización al departamento y al perfil activo, y solo hacia un perfil
-- que ya tenga asignado.
drop policy if exists "editar mi perfil" on public.perfiles;
create policy "editar mi perfil" on public.perfiles
  for update using (id = auth.uid() or privado.mi_rol() = 'control_gestion')
  with check  (id = auth.uid() or privado.mi_rol() = 'control_gestion');

-- No hay política de INSERT ni de DELETE: los perfiles solo los crea el trigger
-- de registro y se eliminan en cascada al borrar la cuenta.

-- --- Actividades ------------------------------------------------------------

drop policy if exists "leer actividades" on public.actividades;
create policy "leer actividades" on public.actividades
  for select using (
    propietario = auth.uid()
    or privado.ve_todo()
    or (privado.mi_rol() = 'jefatura' and departamento = privado.mi_departamento())
  );

drop policy if exists "crear actividades" on public.actividades;
create policy "crear actividades" on public.actividades
  for insert with check (
    privado.puede_escribir()
    and (propietario = auth.uid() or privado.mi_rol() = 'control_gestion')
  );

drop policy if exists "editar mis actividades" on public.actividades;
create policy "editar mis actividades" on public.actividades
  for update using (
    privado.puede_escribir()
    and (propietario = auth.uid() or privado.mi_rol() = 'control_gestion')
  )
  with check (
    privado.puede_escribir()
    and (propietario = auth.uid() or privado.mi_rol() = 'control_gestion')
  );

drop policy if exists "eliminar mis actividades" on public.actividades;
create policy "eliminar mis actividades" on public.actividades
  for delete using (
    privado.puede_escribir()
    and (propietario = auth.uid() or privado.mi_rol() = 'control_gestion')
  );


-- =============================================================================
--  7b. LIMPIEZA DE LA VERSIÓN ANTERIOR
--
--  Hasta la versión 3 estas funciones vivían en `public` y quedaban publicadas
--  como API REST. Ahora están en `privado`; las copias viejas se eliminan aquí,
--  DESPUÉS de recrear las políticas: mientras una política dependa de ellas,
--  PostgreSQL se niega a borrarlas.
--
--  Correr esto dos veces no molesta: la segunda no encuentra nada que borrar.
-- =============================================================================

drop function if exists public.mi_rol();
drop function if exists public.mis_roles();
drop function if exists public.mi_departamento();
drop function if exists public.puede_escribir();
drop function if exists public.ve_todo();
drop function if exists public.nombre_desde_correo(text);
drop function if exists public.crear_perfil();
drop function if exists public.proteger_perfil();
drop function if exists public.normalizar_actividad();


-- =============================================================================
--  8. VISTA CONSOLIDADA (Control de Gestión, Excel, Power BI)
-- =============================================================================

-- Se elimina antes de crearla: «create or replace view» solo permite AGREGAR
-- columnas al final, nunca renombrarlas ni reordenarlas. Al incorporar la
-- columna «responsable» delante de «correo_responsable», reemplazarla falla con
-- «cannot change name of view column». Una vista no contiene datos, así que
-- borrarla y volver a crearla no pierde nada.
drop view if exists public.consolidado;

create view public.consolidado as
select
  a.id,
  a.plan,
  a.anio,
  a.departamento,
  p.nombre                                            as responsable,
  p.correo                                            as correo_responsable,
  a.datos ->> 'codigoActividad'                       as codigo,
  a.datos ->> 'nombreActividad'                       as actividad,
  a.datos ->> 'tipoActividad'                         as tipo,
  a.datos ->> 'objetivoEstrategico'                   as objetivo_estrategico,
  a.datos ->> 'tema'                                  as tema,
  a.datos ->> 'resultadoInmediato'                    as resultado_inmediato,
  (a.datos -> 'totales' ->> 'cronograma')::numeric    as ejecuciones,
  (a.datos -> 'totales' ->> 'presupuesto21')::numeric as presupuesto_st21,
  (a.datos -> 'totales' ->> 'presupuesto22')::numeric as presupuesto_st22,
  (a.datos -> 'totales' ->> 'presupuesto')::numeric   as presupuesto_total,
  a.creada_en,
  a.actualizada_en,
  coalesce(a.datos ->> 'estado', 'borrador')          as estado
from public.actividades a
left join public.perfiles p on p.id = a.propietario;

-- Hereda las políticas de la tabla base: cada quien ve solo lo que le toca.
alter view public.consolidado set (security_invoker = on);


-- =============================================================================
--  8b. CIRCUITO DE APROBACIÓN Y CONFIGURACIÓN DE LA PLATAFORMA   (versión 3.14)
--
--  Configuración que Control de Gestión cambia desde la interfaz, estado de
--  cada actividad vigilado por el servidor y la función para aprobar, observar
--  o reabrir. El mismo bloque está suelto en `docs/aprobacion.sql`.
-- =============================================================================

-- --- Configuración --------------------------------------------------------------

create table if not exists public.configuracion (
  clave            text primary key,
  valor            jsonb not null,
  actualizada_en   timestamptz not null default now(),
  actualizada_por  uuid references auth.users (id) on delete set null
);

comment on table public.configuracion is
  'Ajustes de la plataforma que Control de Gestión cambia desde la interfaz. Todos los usuarios con sesión los leen; solo Control de Gestión los modifica.';

alter table public.configuracion enable row level security;

drop policy if exists "leer configuracion" on public.configuracion;
create policy "leer configuracion" on public.configuracion
  for select to authenticated using (true);

drop policy if exists "control de gestión edita la configuracion" on public.configuracion;
create policy "control de gestión edita la configuracion" on public.configuracion
  for all to authenticated
  using (privado.mi_rol() = 'control_gestion')
  with check (privado.mi_rol() = 'control_gestion');

-- Valores iniciales. `on conflict do nothing`: volver a ejecutar este archivo no
-- pisa lo que Control de Gestión ya haya configurado.
insert into public.configuracion (clave, valor) values
  ('aprobacion',   '{"activa": true, "plazo": null}'),
  ('analisis_pac', '{"activo": true, "holgura": [], "marco": {}}')
on conflict (clave) do nothing;

create or replace function privado.sellar_configuracion()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.actualizada_en := now();
  new.actualizada_por := auth.uid();
  return new;
end;
$$;

drop trigger if exists al_cambiar_configuracion on public.configuracion;
create trigger al_cambiar_configuracion
  before insert or update on public.configuracion
  for each row execute function privado.sellar_configuracion();

-- ¿Está encendido el circuito? Sin la fila, apagado: ante la duda, que la
-- plataforma funcione como antes y no bloquee a nadie.
create or replace function privado.aprobacion_activa()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select (valor ->> 'activa')::boolean from public.configuracion where clave = 'aprobacion'),
    false
  );
$$;


-- --- Bitácora de revisión ---------------------------------------------------------
--
-- `datos.revision` la escribe SOLO el servidor: quién envió, quién decidió,
-- cuándo, la última observación y el historial completo. Lo que mande el
-- navegador en ese campo se descarta.

create or replace function privado.anotar_revision(
  p_rev jsonb, p_estado text, p_nombre text, p_observacion text
)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v        jsonb := coalesce(p_rev, '{}'::jsonb);
  v_ahora  text  := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  v_evento jsonb;
begin
  v_evento := jsonb_build_object('estado', p_estado, 'en', v_ahora, 'por', coalesce(p_nombre, ''));
  if p_observacion is not null then
    v_evento := v_evento || jsonb_build_object('observacion', p_observacion);
  end if;

  v := v || jsonb_build_object('historial', coalesce(v -> 'historial', '[]'::jsonb) || jsonb_build_array(v_evento));

  if p_estado = 'revision' then
    v := v || jsonb_build_object('enviadaEn', v_ahora, 'enviadaPor', coalesce(p_nombre, ''));
  elsif p_estado in ('aprobada', 'observada') then
    v := v || jsonb_build_object('decididaEn', v_ahora, 'decididaPor', coalesce(p_nombre, ''));
  end if;
  if p_estado = 'observada' then
    v := v || jsonb_build_object('observacion', p_observacion);
  end if;
  return v;
end;
$$;


-- --- El estado lo vigila el servidor ------------------------------------------
--
-- Con el circuito encendido, y para todo perfil que no sea Control de Gestión:
--   · Una actividad APROBADA no se modifica ni se elimina: la jefatura la reabre.
--   · Nadie se aprueba ni se observa a sí mismo: eso solo pasa por
--     `decidir_actividades()`, que es la que levanta la marca de decisión.
--   · El equipo sí mueve su actividad entre borrador y revisión.
-- Con el circuito apagado lo aprobado se puede editar, pero nadie puede
-- marcarse «aprobada» a sí mismo; el estado se guarda igual, para que nada se
-- pierda si se vuelve a encender.

create or replace function privado.controlar_estado()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_rol      text;
  v_nombre   text;
  v_antes    text;
  v_despues  text;
  v_rev      jsonb;
begin
  -- Editor SQL o clave de servicio: manda el administrador. Una decisión que
  -- viene de decidir_actividades() ya se validó allá.
  if auth.uid() is null or coalesce(current_setting('planificacion.decision', true), '') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  v_rol := privado.mi_rol();

  if tg_op = 'DELETE' then
    if privado.aprobacion_activa() and v_rol <> 'control_gestion'
       and coalesce(old.datos ->> 'estado', 'borrador') = 'aprobada' then
      raise exception 'Esta actividad está aprobada y no se puede eliminar. Si hay que quitarla, pide a tu jefatura que la reabra.'
        using errcode = 'P0001';
    end if;
    return old;
  end if;

  -- Un upsert sobre una actividad que ya existe pasa primero por aquí como
  -- INSERT y después como UPDATE: las reglas se aplican en el UPDATE, que es
  -- el que conoce el estado anterior.
  if tg_op = 'INSERT' and exists (select 1 from public.actividades where id = new.id) then
    return new;
  end if;

  v_antes   := case when tg_op = 'UPDATE' then coalesce(old.datos ->> 'estado', 'borrador') end;
  v_despues := coalesce(nullif(new.datos ->> 'estado', ''), 'borrador');
  if v_despues not in ('borrador', 'revision', 'observada', 'aprobada') then
    v_despues := 'borrador';
  end if;

  if v_rol <> 'control_gestion' then
    -- El bloqueo de lo aprobado rige solo con el circuito encendido.
    if v_antes = 'aprobada' and privado.aprobacion_activa() then
      raise exception 'Esta actividad ya fue aprobada por la jefatura y no se puede modificar. Si hay que cambiarla, pide que la reabran.'
        using errcode = 'P0001';
    end if;
    -- Aprobarse u observarse a sí mismo no se permite nunca, ni con el circuito
    -- apagado: así, al volver a encenderlo, cada «aprobada» es de verdad.
    if v_despues in ('aprobada', 'observada') and v_despues is distinct from v_antes then
      raise exception 'Solo la jefatura puede aprobar u observar actividades.'
        using errcode = 'P0001';
    end if;
  end if;

  v_rev := case when tg_op = 'UPDATE' then coalesce(old.datos -> 'revision', '{}'::jsonb) else '{}'::jsonb end;
  if v_despues is distinct from v_antes and not (v_antes is null and v_despues = 'borrador') then
    select nombre into v_nombre from public.perfiles where id = auth.uid();
    v_rev := privado.anotar_revision(v_rev, v_despues, v_nombre, null);
  end if;

  new.datos := jsonb_set(jsonb_set(new.datos, '{estado}', to_jsonb(v_despues), true), '{revision}', v_rev, true);
  return new;
end;
$$;

-- El nombre empieza igual que el de normalizar_actividad y es más largo: los
-- triggers corren en orden alfabético, así que este va después.
drop trigger if exists al_guardar_actividad_estado on public.actividades;
create trigger al_guardar_actividad_estado
  before insert or update on public.actividades
  for each row execute function privado.controlar_estado();

drop trigger if exists al_eliminar_actividad on public.actividades;
create trigger al_eliminar_actividad
  before delete on public.actividades
  for each row execute function privado.controlar_estado();


-- --- Aprobar, observar y reabrir ---------------------------------------------
--
-- La jefatura decide sobre las actividades de SU departamento; Control de
-- Gestión, sobre cualquiera. Recibe una lista de ids para poder aprobar varias
-- de una vez, y todo o nada: si una no corresponde, no se aplica ninguna.

create or replace function public.decidir_actividades(
  p_ids uuid[], p_decision text, p_observacion text default null
)
returns setof public.actividades
language plpgsql security definer set search_path = '' as $$
declare
  v_rol      text := privado.mi_rol();
  v_depto    text := privado.mi_departamento();
  v_nombre   text;
  v_destino  text;
  v_antes    text;
  v_obs      text := nullif(trim(coalesce(p_observacion, '')), '');
  r          public.actividades;
begin
  if auth.uid() is null then
    raise exception 'Sesión no iniciada.' using errcode = '42501';
  end if;
  if not privado.aprobacion_activa() then
    raise exception 'El circuito de aprobación está desactivado.' using errcode = 'P0001';
  end if;
  if v_rol not in ('jefatura', 'control_gestion') then
    raise exception 'Solo la jefatura o Control de Gestión pueden aprobar, observar o reabrir actividades.'
      using errcode = '42501';
  end if;
  if p_decision not in ('aprobar', 'observar', 'reabrir') then
    raise exception 'Decisión no válida: %', p_decision using errcode = '22023';
  end if;
  if p_decision = 'observar' and v_obs is null then
    raise exception 'Escribe la observación para el equipo.' using errcode = '22023';
  end if;

  v_destino := case p_decision when 'aprobar' then 'aprobada' when 'observar' then 'observada' else 'borrador' end;
  select nombre into v_nombre from public.perfiles where id = auth.uid();

  perform set_config('planificacion.decision', 'on', true);

  for r in select * from public.actividades where id = any (p_ids) order by id for update loop
    if v_rol = 'jefatura' and r.departamento is distinct from v_depto then
      raise exception 'La actividad «%» no es de tu departamento.', r.datos ->> 'nombreActividad'
        using errcode = '42501';
    end if;
    v_antes := coalesce(r.datos ->> 'estado', 'borrador');
    if p_decision in ('aprobar', 'observar') and v_antes <> 'revision' and v_rol <> 'control_gestion' then
      raise exception 'La actividad «%» no está enviada a revisión.', r.datos ->> 'nombreActividad'
        using errcode = 'P0001';
    end if;
    if p_decision = 'reabrir' and v_antes <> 'aprobada' then
      raise exception 'La actividad «%» no está aprobada: no hay nada que reabrir.', r.datos ->> 'nombreActividad'
        using errcode = 'P0001';
    end if;

    update public.actividades
       set datos = jsonb_set(
             jsonb_set(datos, '{estado}', to_jsonb(v_destino), true),
             '{revision}',
             privado.anotar_revision(datos -> 'revision', v_destino, v_nombre,
                                     case when p_decision = 'observar' then v_obs end),
             true)
     where id = r.id
     returning * into r;
    return next r;
  end loop;

  perform set_config('planificacion.decision', 'off', true);
end;
$$;

revoke all on function public.decidir_actividades(uuid[], text, text) from public, anon;
grant execute on function public.decidir_actividades(uuid[], text, text) to authenticated;

-- Las funciones de `privado` creadas en este bloque, igual que las anteriores.
grant execute on function privado.aprobacion_activa() to anon, authenticated;
grant execute on function privado.anotar_revision(jsonb, text, text, text) to authenticated;
grant execute on function privado.controlar_estado() to authenticated;
grant execute on function privado.sellar_configuracion() to authenticated;


-- --- Para apagar el circuito sin la interfaz ------------------------------------
--
-- Lo normal es hacerlo desde la plataforma («Más» → «Configuración»). Si hiciera
-- falta desde aquí:
--
--   update public.configuracion set valor = jsonb_set(valor, '{activa}', 'false') where clave = 'aprobacion';
--
-- Los estados se conservan: si se vuelve a encender, todo sigue donde estaba.


-- =============================================================================
--  9. NÓMINA DE PERSONAS
--
--  La lista de quién puede usar la plataforma NO vive aquí, sino en el archivo
--  `nomina.sql`. Están separados a propósito: este archivo define la estructura
--  y se ejecuta rara vez; la nómina cambia cada vez que entra o se mueve
--  alguien, y se ejecuta sola.
--
--  Siguiente paso: abre `docs/nomina.sql` y ejecútalo en el SQL Editor.
-- =============================================================================


-- =============================================================================
--  10. REFRESCAR LA CACHÉ DE LA API
--
--  PostgREST (la capa que atiende las llamadas del navegador) guarda en memoria
--  la lista de tablas y funciones. Si no se le avisa, una función recién creada
--  responde 404 aunque exista en la base: «Could not find the function
--  public.reservar_codigo in the schema cache».
-- =============================================================================

notify pgrst, 'reload schema';
