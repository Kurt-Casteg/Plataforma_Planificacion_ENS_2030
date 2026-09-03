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
--    control_gestion  ve y edita todo; consolida; mantiene esta nómina
--    observador       ve todo, no modifica nada (solo lectura)
--
--  UNA PERSONA PUEDE TENER VARIOS PERFILES
--  Cada línea lleva una LISTA de perfiles y en la plataforma aparece un
--  selector para alternar entre ellos sin volver a iniciar sesión:
--
--    array['control_gestion']                 un solo perfil, sin selector
--    array['control_gestion', 'observador']   dos perfiles, con selector
--
--  El PRIMERO de la lista es con el que se entra. El cambio de perfil no es
--  cosmético: la base de datos aplica el que esté activo, así que alguien en
--  modo Observador no puede escribir aunque tenga Control de Gestión.
--
--  Total en esta versión: 40 personas en 10 departamentos.
-- =============================================================================

insert into public.usuarios_autorizados (correo, nombre, departamento, roles) values

  -- Departamento Control de Gestión (3)
  ('albert.mercado@redsalud.gob.cl', 'Albert Mercado', 'dpto_control_gestion', array['control_gestion']),
  ('juana.sanmartin@redsalud.gob.cl', 'Juana San Martin', 'dpto_control_gestion', array['control_gestion']),
  ('kurt.castro@redsalud.gob.cl', 'Kurt Castro', 'dpto_control_gestion', array['control_gestion']),

  -- Departamento de Acción Sanitaria (8)
  ('marcela.cuadra@redsalud.gob.cl', 'Marcela Cuadra', 'dpto_accion_sanitaria', array['jefatura']),
  ('denisse.munozh@redsalud.gob.cl', 'Denisse Muñoz', 'dpto_accion_sanitaria', array['equipo']),
  ('jacqueline.montecinos@redsalud.gob.cl', 'Jacqueline Montecinos', 'dpto_accion_sanitaria', array['equipo']),
  ('luis.bascunan@redsalud.gob.cl', 'Luis Bascuñan', 'dpto_accion_sanitaria', array['equipo']),
  ('pablo.alegria@redsalud.gob.cl', 'Pablo Alegria', 'dpto_accion_sanitaria', array['equipo']),
  ('paola.blasco@redsalud.gob.cl', 'Paola Blasco', 'dpto_accion_sanitaria', array['equipo']),
  ('paula.godoy@redsalud.gob.cl', 'Paula Godoy', 'dpto_accion_sanitaria', array['equipo']),
  ('ricardo.espinoza@redsalud.gob.cl', 'Ricardo Espinoza', 'dpto_accion_sanitaria', array['equipo']),

  -- Departamento de Salud Pública (14)
  ('gustavo.rojas.m@redsalud.gob.cl', 'Gustavo Rojas', 'dpto_salud_publica', array['jefatura']),
  ('andrea.alarcon@redsalud.gob.cl', 'Andrea Alarcon', 'dpto_salud_publica', array['equipo']),
  ('claudia.dospital@redsalud.gob.cl', 'Claudia Dospital', 'dpto_salud_publica', array['equipo']),
  ('constanza.fuentesc@redsalud.gob.cl', 'Constanza Fuentes', 'dpto_salud_publica', array['equipo']),
  ('cristian.ortegam@redsalud.gob.cl', 'Cristian Ortega', 'dpto_salud_publica', array['equipo']),
  ('david.carter@redsalud.gob.cl', 'David Carter', 'dpto_salud_publica', array['equipo']),
  ('estrella.aranda@redsalud.gob.cl', 'Estrella Aranda', 'dpto_salud_publica', array['equipo']),
  ('jessica.inzunza@redsalud.gob.cl', 'Jessica Inzunza', 'dpto_salud_publica', array['equipo']),
  ('lucy.cardenas@redsalud.gob.cl', 'Lucy Cardenas', 'dpto_salud_publica', array['equipo']),
  ('nicole.contreras@redsalud.gob.cl', 'Nicole Contreras', 'dpto_salud_publica', array['equipo']),
  ('nicole.junodl@redsalud.gob.cl', 'Nicole Junod', 'dpto_salud_publica', array['equipo']),
  ('roberto.carillanca@redsalud.gob.cl', 'Roberto Carillanca', 'dpto_salud_publica', array['equipo']),
  ('victor.cadiz@redsalud.gob.cl', 'Victor Cadiz', 'dpto_salud_publica', array['equipo']),
  ('yeleni.ponce@redsalud.gob.cl', 'Yeleni Ponce', 'dpto_salud_publica', array['equipo']),

  -- Departamento Jurídico (2)
  ('omar.blanchait@redsalud.gob.cl', 'Omar Blanchait', 'dpto_juridico', array['jefatura']),
  ('daniela.jimenezc@redsalud.gob.cl', 'Daniela Jimenez', 'dpto_juridico', array['equipo']),

  -- Departamento de Administración y Finanzas (7)
  ('rodrigo.otarola@redsalud.gob.cl', 'Rodrigo Otarola', 'dpto_administracion_finanzas', array['jefatura']),
  ('claudia.sanmartin@redsalud.gob.cl', 'Claudia San Martin', 'dpto_administracion_finanzas', array['equipo']),
  ('daniela.osorio.n@redsalud.gob.cl', 'Daniela Osorio', 'dpto_administracion_finanzas', array['equipo']),
  ('fernando.pinilla@redsalud.gob.cl', 'Fernando Pinilla', 'dpto_administracion_finanzas', array['equipo']),
  ('jaime.camposh@redsalud.gob.cl', 'Jaime Campos', 'dpto_administracion_finanzas', array['equipo']),
  ('viviana.acevedom@redsalud.gob.cl', 'Viviana Acevedo', 'dpto_administracion_finanzas', array['equipo']),
  ('yasmin.atenas@redsalud.gob.cl', 'Yasmin Atenas', 'dpto_administracion_finanzas', array['equipo']),

  -- Comunicaciones (2)
  ('rafael.davilam@redsalud.gob.cl', 'Rafael Dávila', 'comunicaciones', array['jefatura']),
  ('florencia.gonzalez@redsalud.gob.cl', 'Florencia Gonzalez', 'comunicaciones', array['equipo']),

  -- COMPIN (1)
  ('jose.torresq@redsalud.gob.cl', 'Jose Torres', 'compin', array['jefatura']),

  -- Laboratorio de Salud Pública (1)
  ('marcelapaz.sanchez@redsalud.gob.cl', 'Marcela Sanchez', 'laboratorio_salud_publica', array['jefatura']),

  -- Emergencias y Desastres (1)
  ('claudio.lobos.c@redsalud.gob.cl', 'Claudio Lobos', 'emergencias_desastres', array['equipo']),

  -- Unidad de Salud Ocupacional (1)
  ('angelo.labra@redsalud.gob.cl', 'Angelo Labra', 'unidad_salud_ocupacional', array['equipo'])

  -- ---------------------------------------------------------------------------
  -- EXCEPCIONES: correos que NO son @redsalud.gob.cl ni @minsal.cl
  --
  -- Esta lista es también la lista de excepciones. Un correo que aparezca aquí
  -- puede registrarse aunque su dominio no esté autorizado; uno que no aparezca
  -- y venga de otro dominio, la base de datos lo rechaza antes de crear la
  -- cuenta. No hay que tocar código ni desplegar el sitio.
  --
  -- Quita el `--` de las líneas siguientes, completa los datos y agrega una coma
  -- al final de la línea anterior (la de Angelo Labra).
  --
  --   ('nombre.apellido@gmail.com', 'Nombre Apellido', 'dpto_control_gestion',
  --    array['equipo', 'control_gestion'])
  --
  -- Recuerda que el PRIMER perfil de la lista es con el que entra: con
  -- array['equipo', 'control_gestion'] la persona empieza como Equipo y cambia
  -- desde el selector de la cabecera. Si prefieres que entre directo a Control
  -- de Gestión, invierte el orden.
  --
  -- Piénsalo dos veces antes de dar `control_gestion` a un correo externo: ese
  -- perfil ve y edita las actividades de toda la institución, administra esta
  -- misma nómina y la lista de dominios autorizados.
  -- ---------------------------------------------------------------------------

on conflict (correo) do update
  set nombre       = excluded.nombre,
      departamento = excluded.departamento,
      roles        = excluded.roles;


-- Aplica los datos a quien YA había iniciado sesión antes de estar en la lista
-- (o antes de que cambiara su departamento o su perfil).
update public.perfiles p
   set nombre       = coalesce(nullif(u.nombre, ''), p.nombre),
       departamento = coalesce(nullif(u.departamento, ''), p.departamento),
       roles        = u.roles,
       -- Si tenía un perfil activo que sigue en su lista, se le respeta: no hay
       -- por qué sacarlo del modo en que estaba trabajando. Si ya no aplica,
       -- vuelve al primero de la lista nueva.
       rol_activo   = case when p.rol_activo = any (u.roles) then p.rol_activo
                           else u.roles[1] end
  from public.usuarios_autorizados u
 where lower(p.correo) = lower(u.correo);


-- Comprobación: debe devolver el resumen por departamento.
select departamento,
       count(*)                                                     as personas,
       count(*) filter (where 'jefatura'        = any (roles))      as jefaturas,
       count(*) filter (where 'control_gestion' = any (roles))      as control_gestion,
       count(*) filter (where 'observador'      = any (roles))      as observadores,
       count(*) filter (where cardinality(roles) > 1)               as con_varios_perfiles
  from public.usuarios_autorizados
 group by departamento
 order by personas desc, departamento;
