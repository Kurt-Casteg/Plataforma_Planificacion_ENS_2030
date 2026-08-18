-- =============================================================================
--  Nómina institucional · Plataforma de Planificación
--  SEREMI de Salud de Ñuble
--
--  Define quién puede usar la plataforma y con qué perfil. De aquí salen el
--  nombre, el correo y el departamento que la plataforma completa sola en la
--  sección Identificación.
--
--  CÓMO USARLO
--    1. Ejecuta primero `esquema.sql` (crea las tablas). Basta una vez.
--    2. Pega este archivo completo en Supabase → SQL Editor → Run.
--    3. Cada vez que alguien entre, cambie de departamento o de perfil, edita
--       la lista de abajo y vuelve a ejecutarlo entero.
--
--  Es seguro repetirlo: actualiza a quien ya existe, agrega a quien falta y no
--  duplica a nadie. Los cambios alcanzan también a quien ya tenga sesión creada.
--
--  PERFILES
--    equipo           ve y edita solo sus propias actividades
--    jefatura         además ve todas las de su departamento
--    control_gestion  ve y edita todo; consolida
--
--  Total en esta versión: 40 personas en 10 departamentos.
-- =============================================================================

insert into public.usuarios_autorizados (correo, nombre, departamento, rol) values

  -- Departamento Control de Gestión (3)
  ('albert.mercado@redsalud.gob.cl', 'Albert Mercado', 'dpto_control_gestion', 'control_gestion'),
  ('juana.sanmartin@redsalud.gob.cl', 'Juana San Martin', 'dpto_control_gestion', 'control_gestion'),
  ('kurt.castro@redsalud.gob.cl', 'Kurt Castro', 'dpto_control_gestion', 'control_gestion'),

  -- Departamento de Acción Sanitaria (8)
  ('marcela.cuadra@redsalud.gob.cl', 'Marcela Cuadra', 'dpto_accion_sanitaria', 'jefatura'),
  ('denisse.munozh@redsalud.gob.cl', 'Denisse Muñoz', 'dpto_accion_sanitaria', 'equipo'),
  ('jacqueline.montecinos@redsalud.gob.cl', 'Jacqueline Montecinos', 'dpto_accion_sanitaria', 'equipo'),
  ('luis.bascunan@redsalud.gob.cl', 'Luis Bascuñan', 'dpto_accion_sanitaria', 'equipo'),
  ('pablo.alegria@redsalud.gob.cl', 'Pablo Alegria', 'dpto_accion_sanitaria', 'equipo'),
  ('paola.blasco@redsalud.gob.cl', 'Paola Blasco', 'dpto_accion_sanitaria', 'equipo'),
  ('paula.godoy@redsalud.gob.cl', 'Paula Godoy', 'dpto_accion_sanitaria', 'equipo'),
  ('ricardo.espinoza@redsalud.gob.cl', 'Ricardo Espinoza', 'dpto_accion_sanitaria', 'equipo'),

  -- Departamento de Salud Pública (14)
  ('gustavo.rojas.m@redsalud.gob.cl', 'Gustavo Rojas', 'dpto_salud_publica', 'jefatura'),
  ('andrea.alarcon@redsalud.gob.cl', 'Andrea Alarcon', 'dpto_salud_publica', 'equipo'),
  ('claudia.dospital@redsalud.gob.cl', 'Claudia Dospital', 'dpto_salud_publica', 'equipo'),
  ('constanza.fuentesc@redsalud.gob.cl', 'Constanza Fuentes', 'dpto_salud_publica', 'equipo'),
  ('cristian.ortegam@redsalud.gob.cl', 'Cristian Ortega', 'dpto_salud_publica', 'equipo'),
  ('david.carter@redsalud.gob.cl', 'David Carter', 'dpto_salud_publica', 'equipo'),
  ('estrella.aranda@redsalud.gob.cl', 'Estrella Aranda', 'dpto_salud_publica', 'equipo'),
  ('jessica.inzunza@redsalud.gob.cl', 'Jessica Inzunza', 'dpto_salud_publica', 'equipo'),
  ('lucy.cardenas@redsalud.gob.cl', 'Lucy Cardenas', 'dpto_salud_publica', 'equipo'),
  ('nicole.contreras@redsalud.gob.cl', 'Nicole Contreras', 'dpto_salud_publica', 'equipo'),
  ('nicole.junodl@redsalud.gob.cl', 'Nicole Junod', 'dpto_salud_publica', 'equipo'),
  ('roberto.carillanca@redsalud.gob.cl', 'Roberto Carillanca', 'dpto_salud_publica', 'equipo'),
  ('victor.cadiz@redsalud.gob.cl', 'Victor Cadiz', 'dpto_salud_publica', 'equipo'),
  ('yeleni.ponce@redsalud.gob.cl', 'Yeleni Ponce', 'dpto_salud_publica', 'equipo'),

  -- Departamento Jurídico (2)
  ('omar.blanchait@redsalud.gob.cl', 'Omar Blanchait', 'dpto_juridico', 'jefatura'),
  ('daniela.jimenezc@redsalud.gob.cl', 'Daniela Jimenez', 'dpto_juridico', 'equipo'),

  -- Departamento de Administración y Finanzas (7)
  ('rodrigo.otarola@redsalud.gob.cl', 'Rodrigo Otarola', 'dpto_administracion_finanzas', 'jefatura'),
  ('claudia.sanmartin@redsalud.gob.cl', 'Claudia San Martin', 'dpto_administracion_finanzas', 'equipo'),
  ('daniela.osorio.n@redsalud.gob.cl', 'Daniela Osorio', 'dpto_administracion_finanzas', 'equipo'),
  ('fernando.pinilla@redsalud.gob.cl', 'Fernando Pinilla', 'dpto_administracion_finanzas', 'equipo'),
  ('jaime.camposh@redsalud.gob.cl', 'Jaime Campos', 'dpto_administracion_finanzas', 'equipo'),
  ('viviana.acevedom@redsalud.gob.cl', 'Viviana Acevedo', 'dpto_administracion_finanzas', 'equipo'),
  ('yasmin.atenas@redsalud.gob.cl', 'Yasmin Atenas', 'dpto_administracion_finanzas', 'equipo'),

  -- Comunicaciones (2)
  ('rafael.davilam@redsalud.gob.cl', 'Rafael Dávila', 'comunicaciones', 'jefatura'),
  ('florencia.gonzalez@redsalud.gob.cl', 'Florencia Gonzalez', 'comunicaciones', 'equipo'),

  -- COMPIN (1)
  ('jose.torresq@redsalud.gob.cl', 'Jose Torres', 'compin', 'jefatura'),

  -- Laboratorio de Salud Pública (1)
  ('marcelapaz.sanchez@redsalud.gob.cl', 'Marcela Sanchez', 'laboratorio_salud_publica', 'jefatura'),

  -- Emergencias y Desastres (1)
  ('claudio.lobos.c@redsalud.gob.cl', 'Claudio Lobos', 'emergencias_desastres', 'equipo'),

  -- Unidad de Salud Ocupacional (1)
  ('angelo.labra@redsalud.gob.cl', 'Angelo Labra', 'unidad_salud_ocupacional', 'equipo')

on conflict (correo) do update
  set nombre       = excluded.nombre,
      departamento = excluded.departamento,
      rol          = excluded.rol;


-- Aplica los datos a quien YA había iniciado sesión antes de estar en la lista
-- (o antes de que cambiara su departamento o su perfil).
update public.perfiles p
   set nombre       = coalesce(nullif(u.nombre, ''), p.nombre),
       departamento = coalesce(nullif(u.departamento, ''), p.departamento),
       rol          = u.rol
  from public.usuarios_autorizados u
 where lower(p.correo) = lower(u.correo);


-- Comprobación: debe devolver el resumen por departamento.
select departamento,
       count(*)                                          as personas,
       count(*) filter (where rol = 'jefatura')          as jefaturas,
       count(*) filter (where rol = 'control_gestion')   as control_gestion
  from public.usuarios_autorizados
 group by departamento
 order by personas desc, departamento;
