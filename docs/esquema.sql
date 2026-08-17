-- =============================================================================
--  Esquema de la base de datos · Plataforma de Planificación
--  SEREMI de Salud de Ñuble
--
--  Se ejecuta UNA vez en el editor SQL de Supabase (SQL Editor → New query).
--  Solo es necesario si se activa la sincronización en la nube.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Perfiles: vincula cada cuenta con su departamento y su rol.
-- -----------------------------------------------------------------------------

create table if not exists public.perfiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  correo        text not null,
  nombre        text,
  departamento  text,
  rol           text not null default 'equipo'
                check (rol in ('equipo', 'jefatura', 'control_gestion')),
  creado_en     timestamptz not null default now()
);

comment on table  public.perfiles is 'Datos institucionales de cada cuenta.';
comment on column public.perfiles.rol is
  'equipo: ve y edita lo suyo · jefatura: ve todo su departamento · control_gestion: ve y consolida todo.';

-- Crea el perfil automáticamente al registrarse un usuario nuevo.
create or replace function public.crear_perfil()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.perfiles (id, correo)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists al_crear_usuario on auth.users;
create trigger al_crear_usuario
  after insert on auth.users
  for each row execute function public.crear_perfil();

-- -----------------------------------------------------------------------------
-- 2. Actividades: una fila por actividad planificada.
--    El detalle vive en JSONB, de modo que agregar campos al formulario NO
--    obliga a migrar la base de datos.
-- -----------------------------------------------------------------------------

create table if not exists public.actividades (
  id             uuid primary key,
  plan           text not null check (plan in ('pns', 'pgi')),
  anio           integer not null,
  departamento   text,
  propietario    uuid not null references auth.users (id) on delete cascade,
  datos          jsonb not null,
  creada_en      timestamptz not null default now(),
  actualizada_en timestamptz not null default now()
);

create index if not exists actividades_plan_anio_idx on public.actividades (plan, anio);
create index if not exists actividades_propietario_idx on public.actividades (propietario);
create index if not exists actividades_departamento_idx on public.actividades (departamento);
create index if not exists actividades_datos_idx on public.actividades using gin (datos);

-- Mantiene actualizada_en sin confiar en el cliente.
create or replace function public.tocar_actualizada_en()
returns trigger language plpgsql as $$
begin
  new.actualizada_en := now();
  return new;
end;
$$;

drop trigger if exists al_actualizar_actividad on public.actividades;
create trigger al_actualizar_actividad
  before update on public.actividades
  for each row execute function public.tocar_actualizada_en();

-- -----------------------------------------------------------------------------
-- 3. Row Level Security: la seguridad se aplica en el servidor.
--    Sin estas políticas, la clave pública del navegador daría acceso total.
-- -----------------------------------------------------------------------------

alter table public.perfiles     enable row level security;
alter table public.actividades  enable row level security;

-- Funciones auxiliares para no repetir subconsultas en cada política.
create or replace function public.mi_rol()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select rol from public.perfiles where id = auth.uid()), 'equipo');
$$;

create or replace function public.mi_departamento()
returns text language sql stable security definer set search_path = public as $$
  select (select departamento from public.perfiles where id = auth.uid());
$$;

-- --- Perfiles ---------------------------------------------------------------

drop policy if exists "ver mi perfil" on public.perfiles;
create policy "ver mi perfil" on public.perfiles
  for select using (id = auth.uid() or public.mi_rol() = 'control_gestion');

drop policy if exists "editar mi perfil" on public.perfiles;
create policy "editar mi perfil" on public.perfiles
  for update using (id = auth.uid())
  with check (id = auth.uid() and rol = public.mi_rol());  -- nadie se auto-asciende

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
  for insert with check (propietario = auth.uid());

drop policy if exists "editar mis actividades" on public.actividades;
create policy "editar mis actividades" on public.actividades
  for update using (propietario = auth.uid() or public.mi_rol() = 'control_gestion')
  with check (propietario = auth.uid() or public.mi_rol() = 'control_gestion');

drop policy if exists "eliminar mis actividades" on public.actividades;
create policy "eliminar mis actividades" on public.actividades
  for delete using (propietario = auth.uid() or public.mi_rol() = 'control_gestion');

-- -----------------------------------------------------------------------------
-- 4. Vista consolidada para Control de Gestión (y para Power BI / Excel).
-- -----------------------------------------------------------------------------

create or replace view public.consolidado as
select
  a.id,
  a.plan,
  a.anio,
  a.departamento,
  p.correo                                         as correo_responsable,
  a.datos ->> 'codigoActividad'                    as codigo,
  a.datos ->> 'nombreActividad'                    as actividad,
  a.datos ->> 'tipoActividad'                      as tipo,
  a.datos ->> 'objetivoEstrategico'                as objetivo_estrategico,
  a.datos ->> 'tema'                               as tema,
  a.datos ->> 'resultadoInmediato'                 as resultado_inmediato,
  (a.datos -> 'totales' ->> 'cronograma')::numeric   as ejecuciones,
  (a.datos -> 'totales' ->> 'presupuesto21')::numeric as presupuesto_st21,
  (a.datos -> 'totales' ->> 'presupuesto22')::numeric as presupuesto_st22,
  (a.datos -> 'totales' ->> 'presupuesto')::numeric   as presupuesto_total,
  a.creada_en,
  a.actualizada_en
from public.actividades a
left join public.perfiles p on p.id = a.propietario;

-- La vista hereda RLS de la tabla base.
alter view public.consolidado set (security_invoker = on);

-- -----------------------------------------------------------------------------
-- 5. Asignar roles (ejecutar manualmente tras el primer ingreso de cada persona)
-- -----------------------------------------------------------------------------

-- update public.perfiles
--   set rol = 'control_gestion', departamento = 'dpto_control_gestion'
--   where correo = 'nombre@redsalud.gob.cl';

-- update public.perfiles
--   set departamento = 'dpto_salud_publica'
--   where correo = 'otra.persona@redsalud.gob.cl';
