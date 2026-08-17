# Guía de despliegue

Cómo publicar la plataforma en internet, gratis, y cómo actualizarla después.
Está escrita para seguirse paso a paso sin experiencia previa.

---

## Opción recomendada: GitHub Pages

Ya existe el repositorio `Kurt-Casteg/Mini_Plataforma`, así que se aprovecha ese.

### Paso 1 · Subir los archivos

Desde la carpeta de la plataforma, en una terminal:

```bash
git init                       # solo si la carpeta aún no es un repositorio
git remote add origin https://github.com/Kurt-Casteg/Mini_Plataforma.git
git add .
git commit -m "Nueva versión de la plataforma de planificación"
git branch -M main
git push -u origin main
```

> Si el repositorio ya tenía la versión anterior y quieres conservar su historial,
> reemplaza el contenido y haz `git add . && git commit`. El historial se mantiene.

### Paso 2 · Activar GitHub Pages

1. Entra al repositorio en github.com.
2. **Settings** → **Pages** (menú lateral izquierdo).
3. En **Source**, elige **GitHub Actions**.
4. Listo. No hay que elegir carpeta ni rama.

### Paso 3 · Esperar la publicación

1. Ve a la pestaña **Actions** del repositorio.
2. Verás el flujo «Desplegar en GitHub Pages» ejecutándose (1 a 2 minutos).
3. Cuando termine con un visto verde, la dirección será:

   `https://kurt-casteg.github.io/Mini_Plataforma/`

### Paso 4 · Actualizar en el futuro

Cada vez que cambies algo:

```bash
git add .
git commit -m "Descripción del cambio"
git push
```

El sitio se actualiza solo. Antes de publicar, el flujo verifica que el
JavaScript no tenga errores de sintaxis y que los catálogos JSON sean válidos;
si algo falla, no publica una versión rota.

---

## Alternativa: Netlify

Útil si más adelante quieres un dominio propio o cabeceras de seguridad
adicionales (GitHub Pages no permite configurar cabeceras HTTP).

1. Entra a [netlify.com](https://netlify.com) y crea una cuenta gratuita.
2. **Add new site** → **Import an existing project** → conecta GitHub y elige el
   repositorio.
3. Deja **Build command** vacío y **Publish directory** en `.` (un punto).
4. **Deploy**.

Para agregar cabeceras de seguridad, crea un archivo `_headers` en la raíz:

```
/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: geolocation=(), camera=(), microphone=()
```

---

## Alternativa: Cloudflare Pages

1. Entra a [pages.cloudflare.com](https://pages.cloudflare.com) y crea una cuenta.
2. **Create a project** → conecta GitHub → elige el repositorio.
3. **Framework preset**: None. **Build command**: vacío. **Output directory**: `/`.
4. **Save and Deploy**.

Las cabeceras se configuran igual, con un archivo `_headers` en la raíz.

---

## Qué NO debe subirse al repositorio

Nada sensible: la plataforma no guarda contraseñas ni claves privadas. La clave
`anonKey` de Supabase, si se activa la nube, **es pública por diseño** y puede ir
en `config.js` sin riesgo — la protección real está en las políticas de seguridad
del servidor (`docs/esquema.sql`).

Sí conviene evitar subir respaldos con datos reales (`respaldo-*.json`). Ya están
excluidos en `.gitignore`.

---

## Prueba antes de anunciar la dirección al equipo

Recorre esta lista con la dirección pública ya publicada:

- [ ] La página carga y se ven las dos pestañas de planes.
- [ ] En el Plan Nacional de Salud, al elegir un Objetivo Estratégico se cargan
      los temas, y al llegar al Resultado Esperado aparece su indicador oficial.
- [ ] Guardar una actividad de prueba funciona y aparece en el listado.
- [ ] Los gráficos se dibujan.
- [ ] «Exportar a Excel» descarga un archivo que abre correctamente.
- [ ] «Respaldar (JSON)» descarga y luego «Importar» lo recupera.
- [ ] Se ve bien en un teléfono.
- [ ] Recargar la página conserva las actividades.

---

## Preguntas frecuentes

**¿Dónde quedan guardados los datos?**
En el navegador de cada persona (almacenamiento local), a menos que se active la
sincronización en la nube. Por eso conviene que cada equipo genere un respaldo
JSON periódicamente y lo envíe a Control de Gestión, que puede importarlos todos
juntos para consolidar.

**¿Se pierden los datos si limpio el historial del navegador?**
Sí. Es la razón por la que existe el botón «Respaldar (JSON)» y por la que vale
la pena evaluar activar Supabase.

**¿Funciona sin internet?**
Sí. Las librerías vienen incluidas en el sitio (carpeta `vendor/`), así que una
vez cargada la página, todo funciona sin conexión.

**¿Y si la red institucional bloquea GitHub?**
La misma carpeta puede publicarse en cualquier servidor web interno: son archivos
estáticos, no necesitan PHP, Node ni base de datos.

**¿Cómo vuelvo a una versión anterior?**
En la pestaña **Actions** de GitHub, abre un despliegue anterior exitoso y usa
«Re-run all jobs». O bien `git revert` del commit problemático y `git push`.
