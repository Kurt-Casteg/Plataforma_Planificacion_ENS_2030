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
--  el propietario, el rol y el correo se fijan del lado del servidor.
-- =============================================================================


-- =============================================================================
--  1. PERFILES
--     Un perfil por cuenta. Define qué ve y qué puede editar cada persona.
-- =============================================================================

create table if not exists public.perfiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  correo        text not null,
  nombre        text,
  departamento  text,
  rol           text not null default 'equipo'
                check (rol in ('equipo', 'jefatura', 'control_gestion')),
  creado_en     timestamptz not null default now()
);

-- Columnas agregadas después de la primera versión.
alter table public.perfiles add column if not exists nombre text;

comment on column public.perfiles.rol is
  'equipo: ve y edita lo suyo · jefatura: ve todo su departamento · control_gestion: ve y consolida todo.';


-- =============================================================================
--  2. FUNCIONES AUXILIARES DE SEGURIDAD
--     Se declaran antes de cualquier política que las use.
-- =============================================================================

create or replace function public.mi_rol()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select rol from public.perfiles where id = auth.uid()), 'equipo');
$$;

create or replace function public.mi_departamento()
returns text language sql stable security definer set search_path = public as $$
  select (select departamento from public.perfiles where id = auth.uid());
$$;


-- =============================================================================
--  3. PERSONAS AUTORIZADAS
--     Se precarga desde la planilla institucional. Cuando alguien entra por
--     primera vez, su perfil se completa solo a partir de esta tabla.
-- =============================================================================

create table if not exists public.usuarios_autorizados (
  correo        text primary key,
  nombre        text,
  departamento  text,
  rol           text not null default 'equipo'
                check (rol in ('equipo', 'jefatura', 'control_gestion')),
  cargado_en    timestamptz not null default now()
);

comment on table public.usuarios_autorizados is
  'Nómina institucional. Al primer ingreso, el perfil de la persona se completa desde aquí.';

-- Contiene la nómina completa (nombres, correos, departamentos): solo Control
-- de Gestión puede consultarla. El resto la usa indirectamente, a través del
-- trigger de creación de perfil, que corre con privilegios elevados.
alter table public.usuarios_autorizados enable row level security;

drop policy if exists "control de gestión ve la nómina" on public.usuarios_autorizados;
create policy "control de gestión ve la nómina" on public.usuarios_autorizados
  for select using (public.mi_rol() = 'control_gestion');

drop policy if exists "control de gestión edita la nómina" on public.usuarios_autorizados;
create policy "control de gestión edita la nómina" on public.usuarios_autorizados
  for all using (public.mi_rol() = 'control_gestion')
  with check (public.mi_rol() = 'control_gestion');


-- =============================================================================
--  4. ALTA AUTOMÁTICA Y PROTECCIÓN DEL PERFIL
-- =============================================================================

-- --- Nombre legible a partir del correo ---------------------------------------
-- Para quien no esté en la nómina: albert.mercado@… → "Albert Mercado".

create or replace function public.nombre_desde_correo(p_correo text)
returns text
language sql
immutable
as $$
  select initcap(replace(replace(split_part(coalesce(p_correo, ''), '@', 1), '.', ' '), '_', ' '));
$$;


-- --- Creación automática del perfil al registrarse -----------------------------

create or replace function public.crear_perfil()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  autorizado public.usuarios_autorizados%rowtype;
begin
  select * into autorizado
    from public.usuarios_autorizados
   where lower(correo) = lower(new.email);

  insert into public.perfiles (id, correo, nombre, departamento, rol)
  values (
    new.id,
    new.email,
    -- Si está en la nómina se usa su nombre oficial; si no, se deduce del correo.
    coalesce(nullif(autorizado.nombre, ''), public.nombre_desde_correo(new.email)),
    nullif(autorizado.departamento, ''),
    coalesce(autorizado.rol, 'equipo')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists al_crear_usuario on auth.users;
create trigger al_crear_usuario
  after insert on auth.users
  for each row execute function public.crear_perfil();


-- --- Nadie modifica su propio rol, correo ni identidad -------------------------
-- Antes esto dependía de una condición en la política. Un trigger es más
-- robusto: reescribe los campos protegidos en vez de rechazar la operación,
-- así el usuario sí puede actualizar lo que le corresponde (su departamento).

create or replace function public.proteger_perfil()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rol text;
begin
  -- auth.uid() es NULL cuando la sentencia viene del editor SQL de Supabase o
  -- de la clave de servicio. En ese caso quien manda es el administrador y no
  -- se restringe nada: es la vía por la que se asignan los roles.
  if auth.uid() is null then
    return new;
  end if;

  select rol into v_rol from public.perfiles where id = auth.uid();

  if coalesce(v_rol, 'equipo') <> 'control_gestion' then
    new.id     := old.id;
    new.correo := old.correo;
    new.rol    := old.rol;
  end if;

  return new;
end;
$$;

drop trigger if exists al_actualizar_perfil on public.perfiles;
create trigger al_actualizar_perfil
  before update on public.perfiles
  for each row execute function public.proteger_perfil();


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

create or replace function public.normalizar_actividad()
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

  select departamento, rol into v_depto, v_rol
    from public.perfiles where id = auth.uid();
  v_rol := coalesce(v_rol, 'equipo');

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

drop trigger if exists al_actualizar_actividad on public.actividades;
drop trigger if exists al_guardar_actividad on public.actividades;
create trigger al_guardar_actividad
  before insert or update on public.actividades
  for each row execute function public.normalizar_actividad();


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

create or replace function public.reservar_codigo(p_plan text, p_anio integer)
returns integer
language plpgsql
security definer
set search_path = public
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
-- =============================================================================

alter table public.perfiles    enable row level security;
alter table public.actividades enable row level security;

-- --- Perfiles ---------------------------------------------------------------

drop policy if exists "ver mi perfil" on public.perfiles;
create policy "ver mi perfil" on public.perfiles
  for select using (
    id = auth.uid()
    or public.mi_rol() = 'control_gestion'
    or (public.mi_rol() = 'jefatura' and departamento = public.mi_departamento())
  );

drop policy if exists "editar mi perfil" on public.perfiles;
create policy "editar mi perfil" on public.perfiles
  for update using (id = auth.uid() or public.mi_rol() = 'control_gestion')
  with check  (id = auth.uid() or public.mi_rol() = 'control_gestion');
  -- El trigger proteger_perfil() impide que alguien se cambie el rol o el correo.

-- No hay política de INSERT ni de DELETE: los perfiles solo los crea el trigger
-- de registro y se eliminan en cascada al borrar la cuenta.

-- --- Actividades ------------------------------------------------------------

drop policy if exists "leer actividades" on public.actividades;
create policy "leer actividades" on public.actividades
  for select using (
    propietario = auth.uid()
    or public.mi_rol() = 'control_gestion'
    or (public.mi_rol() = 'jefatura' and departamento = public.mi_departamento())
  );

drop policy if exists "crear actividades" on public.actividades;
create policy "crear actividades" on public.actividades
  for insert with check (
    propietario = auth.uid() or public.mi_rol() = 'control_gestion'
  );

drop policy if exists "editar mis actividades" on public.actividades;
create policy "editar mis actividades" on public.actividades
  for update using (propietario = auth.uid() or public.mi_rol() = 'control_gestion')
  with check  (propietario = auth.uid() or public.mi_rol() = 'control_gestion');

drop policy if exists "eliminar mis actividades" on public.actividades;
create policy "eliminar mis actividades" on public.actividades
  for delete using (propietario = auth.uid() or public.mi_rol() = 'control_gestion');


-- =============================================================================
--  8. VISTA CONSOLIDADA (Control de Gestión, Excel, Power BI)
-- =============================================================================

create or replace view public.consolidado as
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
  a.actualizada_en
from public.actividades a
left join public.perfiles p on p.id = a.propietario;

-- Hereda las políticas de la tabla base: cada quien ve solo lo que le toca.
alter view public.consolidado set (security_invoker = on);


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
