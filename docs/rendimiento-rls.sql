-- =============================================================================
--  RENDIMIENTO DE LAS REGLAS DE ACCESO (RLS)                    (versión 3.14.1)
--
--  Supabase → SQL Editor → pegar este archivo → Run. Se puede ejecutar más de
--  una vez. No cambia QUIÉN ve o edita qué: solo CUÁNTAS veces se calcula.
--
--  Antes, cada regla preguntaba por el perfil de la persona (su rol, su
--  departamento) una vez POR CADA ACTIVIDAD revisada. Envolver esas llamadas en
--  `(select ...)` hace que Postgres las calcule UNA vez por consulta y reutilice
--  el resultado. Es lo que recomienda el Performance Advisor de Supabase
--  («Auth RLS Initialization Plan»).
--
--  Prueba con 40 personas y 780 actividades (copia local, mismo esquema):
--    · cargar el listado de un equipo: de 38 ms a 1,4 ms;
--    · capacidad máxima: de ~51 a ~990 consultas por segundo.
-- =============================================================================

-- --- Actividades ----------------------------------------------------------------

alter policy "leer actividades" on public.actividades
  using (
    propietario = (select auth.uid())
    or (select privado.ve_todo())
    or ((select privado.mi_rol()) = 'jefatura' and departamento = (select privado.mi_departamento()))
  );

alter policy "crear actividades" on public.actividades
  with check (
    (select privado.puede_escribir())
    and (propietario = (select auth.uid()) or (select privado.mi_rol()) = 'control_gestion')
  );

alter policy "editar mis actividades" on public.actividades
  using (
    (select privado.puede_escribir())
    and (propietario = (select auth.uid()) or (select privado.mi_rol()) = 'control_gestion')
  )
  with check (
    (select privado.puede_escribir())
    and (propietario = (select auth.uid()) or (select privado.mi_rol()) = 'control_gestion')
  );

alter policy "eliminar mis actividades" on public.actividades
  using (
    (select privado.puede_escribir())
    and (propietario = (select auth.uid()) or (select privado.mi_rol()) = 'control_gestion')
  );

-- --- Perfiles -------------------------------------------------------------------

alter policy "ver mi perfil" on public.perfiles
  using (
    id = (select auth.uid())
    or (select privado.ve_todo())
    or ((select privado.mi_rol()) = 'jefatura' and departamento = (select privado.mi_departamento()))
  );

alter policy "editar mi perfil" on public.perfiles
  using (id = (select auth.uid()) or (select privado.mi_rol()) = 'control_gestion')
  with check (id = (select auth.uid()) or (select privado.mi_rol()) = 'control_gestion');

notify pgrst, 'reload schema';
