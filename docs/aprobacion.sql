-- =============================================================================
--  8b. CIRCUITO DE APROBACIÓN Y CONFIGURACIÓN DE LA PLATAFORMA   (versión 3.14)
--
--  Este bloque también está dentro de `esquema.sql`. Viene aparte para poder
--  aplicarlo solo, sin volver a ejecutar el esquema completo:
--  Supabase → SQL Editor → pegar este archivo → Run. Se puede ejecutar más de
--  una vez sin problema.
--
--  Qué agrega:
--    · `configuracion`: ajustes que Control de Gestión cambia desde la propia
--      plataforma («Más» → «Configuración»), sin tocar código: encender o apagar
--      el circuito de aprobación y el análisis del PAC, el plazo, los criterios
--      de holgura y el marco presupuestario.
--    · El ESTADO de cada actividad (borrador → revisión → observada/aprobada),
--      guardado dentro de `datos` y vigilado por el servidor: el navegador no
--      puede aprobarse a sí mismo ni editar lo ya aprobado.
--    · `decidir_actividades()`: la única vía para aprobar, observar o reabrir.
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

notify pgrst, 'reload schema';


-- --- Vista consolidada: agrega la columna «estado» -------------------------------
-- `create or replace` admite columnas nuevas al final sin borrar la vista.

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
  a.actualizada_en,
  coalesce(a.datos ->> 'estado', 'borrador')          as estado
from public.actividades a
left join public.perfiles p on p.id = a.propietario;

alter view public.consolidado set (security_invoker = on);
