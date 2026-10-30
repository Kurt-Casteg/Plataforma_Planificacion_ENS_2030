-- =============================================================================
--  ACCESO SOLO PARA LA NÓMINA
--  Plataforma de Planificación · SEREMI de Salud de Ñuble
--
--  Deja entrar únicamente a las personas registradas en la nómina
--  (public.usuarios_autorizados). Un correo @redsalud.gob.cl o @minsal.cl que
--  no esté en la nómina ya no podrá crear su cuenta: al pedir el enlace verá
--  «Ese correo no está autorizado para acceder a la plataforma».
--
--  Cómo usarlo: Supabase → SQL Editor → pega este archivo completo → Run.
--  Se puede ejecutar más de una vez sin problema.
--
--  Requisito: haber ejecutado antes docs/esquema.sql (versión 3.5 o posterior).
--  El paso 1 lo comprueba y se detiene si falta.
-- =============================================================================


-- --- 1. Comprobar que el control de acceso está instalado ---------------------
-- Sin el trigger `al_registrar_usuario`, la base no revisa nada al crear una
-- cuenta y cerrar los dominios no tendría efecto. Mejor detenerse y avisar.

do $$
begin
  if not exists (
    select 1 from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where t.tgname = 'al_registrar_usuario' and n.nspname = 'auth' and c.relname = 'users'
  ) then
    raise exception 'Falta el control de acceso. Ejecuta primero docs/esquema.sql completo y luego vuelve a ejecutar este archivo.';
  end if;
end;
$$;


-- --- 2. Cerrar el acceso por dominio -------------------------------------------
-- Se borran TODOS los dominios autorizados en bloque (redsalud.gob.cl,
-- minsal.cl y cualquier otro, incluido el comodín '*'). Desde aquí, la única
-- puerta de entrada para una cuenta nueva es estar en la nómina.

delete from public.dominios_permitidos;


-- --- 3. Qué hacer con quien ya tiene cuenta sin estar en la nómina --------------
--
--  a) Si DEBE tener acceso: agrégala a docs/nomina.sql con su departamento y
--     perfiles, y ejecuta ese archivo. Su cuenta ya existe; con eso queda
--     regularizada.
--
--  b) Si NO debe tener acceso: elimina su cuenta. OJO: al eliminar la cuenta
--     se eliminan también su perfil y TODAS las actividades que registró
--     (la base las borra en cascada). Revisa primero la columna `actividades`
--     de la consulta del paso 4 y, si hace falta, expórtalas antes.
--
--     Quita los dos guiones del comienzo de la línea y cambia el correo:
--
--  delete from auth.users where lower(email) = lower('nombre.apellido@redsalud.gob.cl');
--
--     También se puede hacer desde Supabase → Authentication → Users → «Delete user».


-- --- 4. Personas que YA tienen cuenta sin estar en la nómina --------------------
-- Cerrar los dominios solo afecta a cuentas NUEVAS: quien ya entró alguna vez
-- sigue pudiendo entrar. Esta consulta muestra a esas personas y cuántas
-- actividades tienen cargadas, para decidir qué hacer con cada una.
--
-- Va al final a propósito: el SQL Editor de Supabase muestra solo el resultado
-- de la última consulta. Si dice «Success. No rows returned», no hay nadie en
-- esa situación y el acceso ya quedó cerrado.

select
  p.correo,
  p.nombre,
  coalesce(p.departamento, '(sin departamento)')            as departamento,
  p.roles,
  count(a.id)                                              as actividades,
  count(a.id) filter (where a.anio = 2027)                 as actividades_2027,
  u.created_at::date                                       as cuenta_creada,
  u.last_sign_in_at::date                                  as ultimo_ingreso
from public.perfiles p
join auth.users u on u.id = p.id
left join public.actividades a on a.propietario = p.id
where not exists (
  select 1 from public.usuarios_autorizados n
   where lower(n.correo) = lower(p.correo)
)
group by p.id, p.correo, p.nombre, p.departamento, p.roles, u.created_at, u.last_sign_in_at
order by actividades desc, p.correo;
