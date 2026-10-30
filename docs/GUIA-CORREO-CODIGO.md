# Ingreso con código de 6 dígitos y correo de la unidad

Desde la versión 3.11 la plataforma ya no envía un **enlace** para entrar: envía
un **código de 6 dígitos** que la persona escribe en la pantalla de ingreso.

Esta guía deja Supabase listo para eso. Son cuatro ajustes en el panel de
Supabase y se hacen **una sola vez**. Ninguno toca la base de datos ni las
actividades.

> **Por qué se cambió.** Los registros de Supabase mostraron dos problemas:
> el servicio de correo de prueba de Supabase solo envía unos pocos correos por
> hora (*email rate limit exceeded*) y solo a los miembros del proyecto; y los
> filtros de seguridad del correo institucional abren los enlaces para revisarlos,
> con lo que llegaban ya gastados (*Email link is invalid or has expired*). Un
> código no lo puede gastar ningún filtro, y un servidor de correo propio no
> tiene esos límites.

---

## Orden recomendado

1. **Paso 1** (correo de la unidad) y **paso 2** (límite de envíos).
2. **Paso 3** (duración y largo del código).
3. **Paso 4** (plantillas del correo) **y**, inmediatamente después, el
   `git push` de la versión 3.11.
4. **Paso 5**: probar.

Los pasos 4 y el `push` van juntos porque la plantilla decide qué trae el correo
(código o enlace) y la versión publicada decide qué pide la pantalla (código o
enlace). Mientras uno esté cambiado y el otro no, nadie puede entrar. Como los
equipos todavía no empiezan, basta con hacerlos seguidos.

---

## Paso 1 · Enviar desde el Gmail de la unidad (SMTP)

**Antes:** en la cuenta `controldegestionsereminuble@gmail.com`
- Activa la **verificación en dos pasos**:
  <https://myaccount.google.com/signinoptions/twosv>
- Crea una **contraseña de aplicación**:
  <https://myaccount.google.com/apppasswords> → nombre `Supabase Plataforma` →
  **Crear**. Copia la clave de 16 letras que aparece (Google la muestra una sola
  vez).

**En Supabase:** proyecto `planificacion-seremi-nuble` → **Authentication** →
**Emails** → pestaña **SMTP Settings** → activa **Enable custom SMTP** y completa:

| Campo | Valor |
|---|---|
| Sender email | `kcasteg@gmail.com` |
| Sender name | `Plataforma de Planificación · SEREMI de Salud de Ñuble` |
| Host | `smtp.gmail.com` |
| Port number | `465` |
| Minimum interval between emails being sent | `1` (o el valor que proponga) |
| Username | `kcasteg@gmail.com` |
| Password | la clave de 16 letras, **sin espacios** |

Pulsa **Save changes**.

> - El *Sender email* tiene que ser la misma cuenta de Gmail. Si se pone otra
>   dirección, Gmail la reemplaza o el correo cae en no deseado.
> - Gmail permite unos **500 correos al día** desde una cuenta personal: de sobra
>   para la nómina.
> - Si algún día se cambia la contraseña de esa cuenta de Google, la clave de
>   aplicación deja de servir y hay que crear otra y pegarla aquí.
> - La clave no se comparte por chat ni se guarda en el repositorio: va solo en
>   este campo de Supabase.

## Paso 2 · Subir el límite de envíos por hora

**Authentication** → **Rate Limits** → **Rate limit for sending emails** →
`100` por hora → **Save changes**.

Al activar el SMTP propio, Supabase parte en 30 por hora, que se queda corto si
la nómina completa entra la misma mañana. Con 100 alcanza para todos con margen.

Ahí mismo hay otros límites (por ejemplo, de verificaciones de código). No hace
falta tocarlos.

## Paso 3 · Duración y largo del código

**Authentication** → **Sign In / Providers** → **Email** →

| Campo | Valor |
|---|---|
| Email OTP Expiration | `3600` (1 hora) |
| Email OTP Length | `6` |

**Save**.

La pantalla de la plataforma dice «código de 6 dígitos» y «vence en 1 hora»: si
cambias estos valores, avísale al desarrollador para que el texto diga lo mismo.

## Paso 4 · Plantillas del correo

**Authentication** → **Emails** → pestaña **Templates**. Hay que cambiar **dos**
plantillas, porque Supabase usa una la primera vez que alguien entra (cuando se
crea su cuenta) y otra las veces siguientes. El contenido es el mismo.

### Plantilla «Magic Link»

**Subject:**

```
Tu código de acceso a la Plataforma de Planificación
```

**Message body** (reemplaza todo lo que haya):

```html
<div style="font-family: Arial, Helvetica, sans-serif; color: #1f2937; max-width: 480px;">
  <p style="font-size: 15px;">Hola:</p>
  <p style="font-size: 15px;">Tu código para ingresar a la Plataforma de Planificación de la SEREMI de Salud de Ñuble es:</p>
  <p style="font-size: 32px; font-weight: bold; letter-spacing: 6px; margin: 24px 0; color: #0a3f73;">{{ .Token }}</p>
  <p style="font-size: 14px;">Escríbelo en la pantalla de ingreso. Sirve una sola vez y vence en 1 hora.</p>
  <p style="font-size: 13px; color: #6b7280;">Si no pediste este código, ignora este correo: nadie puede entrar sin él.</p>
  <p style="font-size: 13px; color: #6b7280;">Departamento de Control de Gestión y Calidad Institucional</p>
</div>
```

### Plantilla «Confirm signup»

Mismo **Subject** y mismo **Message body** que la anterior.

**Save changes** en cada una.

> - La plantilla **no lleva enlaces** a propósito: así ningún filtro de
>   seguridad puede «usar» el acceso antes que la persona.
> - `{{ .Token }}` es donde Supabase pone el código. Tiene que quedar escrito
>   exactamente así, con las llaves y el punto.

## Paso 5 · Probar

Después del `git push` y de que GitHub Pages publique (uno o dos minutos):

1. Abre la plataforma en una **ventana privada** (Ctrl + Shift + N) y recarga
   con Ctrl + Shift + R. El pie de página debe decir **Versión 3.11.0**.
2. Escribe tu correo y pulsa **Enviarme un código de acceso**.
3. Revisa que el correo llegue **desde la cuenta de la unidad**, con el código.
   Si no aparece en unos minutos, revisa la carpeta de correo no deseado.
4. Escribe el código y pulsa **Entrar**.

Si algo falla, el mensaje en la pantalla de ingreso dice qué pasó (correo no
autorizado, demasiadas solicitudes, código vencido…). Para el detalle técnico:
Supabase → **Logs** → **Auth**.

---

## Cómo funciona para los equipos

- **Una vez por computador.** El código se pide solo para abrir sesión en un
  navegador. Después la sesión queda guardada y se renueva sola: al volver otro
  día, entran directo. Se vuelve a pedir si cierran sesión, cambian de
  computador o navegador, usan una ventana privada o borran los datos de
  navegación.
- **Cada código es aleatorio, de un solo uso y vence en 1 hora.** No es una
  contraseña: no hay nada que recordar.
- **Si no les llega o se les vence**, pulsan **Enviarme un código nuevo** en la
  misma pantalla. Hay que esperar 60 segundos entre una solicitud y otra (la
  pantalla muestra la cuenta regresiva). Al pedir uno nuevo, el anterior deja de
  servir.
- **Solo entra quien está en la nómina** (`docs/nomina.sql`). A cualquier otro
  correo, aunque sea @redsalud.gob.cl, la plataforma le responde que no está
  autorizado y no se envía nada.

## Si más adelante TI entrega el correo institucional

Basta con repetir el **paso 1** con los datos del servidor de correo
institucional (host, puerto, usuario y contraseña que entregue TI) y cambiar el
*Sender email*. Nada más cambia: ni la plataforma ni las plantillas.
