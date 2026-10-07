# Glow Beauty Center — web pública, reservas y administración

Plataforma completa para un salón de belleza en República Dominicana: sitio web, reservas en línea con disponibilidad real, catálogo, WhatsApp, Google Calendar y un panel de administración (agenda, tablero Kanban, clientes, especialistas, cobros y ventas, reportes, galería, promociones y configuración).

- **Idioma / moneda / zona horaria:** español (es-DO) · RD$ · America/Santo_Domingo.
- **Todo el contenido sale de la base de datos** y se edita desde el panel: servicios, precios, fotos, textos de la web, horarios, políticas, plantillas de WhatsApp, métodos de pago… No hay precios ni servicios escritos en el código.

## Tecnología

Next.js 16 (App Router) · React 19 · TypeScript · CSS Modules (sin Tailwind) · Motion · Supabase (Postgres, Auth, Storage, Realtime, RLS) · Google Calendar API · Vercel.

## Requisitos

Node.js **20.9 o superior**, una cuenta de Supabase (gratuita sirve para empezar) y, para publicar, una cuenta de Vercel.

## Puesta en marcha (local)

```bash
cd glow
npm install
cp .env.example .env.local      # en Windows: copy .env.example .env.local
```

1. **Supabase** → crea un proyecto. En *Authentication → Sign In / Providers* deja **Email** activado y **desactiva “Allow new users to sign up”** (el personal se crea desde el panel; nadie debe poder registrarse solo).
2. Rellena `.env.local` (tabla más abajo).
3. **Base de datos** — aplica las migraciones **en este orden** y luego el catálogo:

   ```bash
   node --env-file=.env.local scripts/db.mjs \
     supabase/migrations/20261001000001_schema.sql \
     supabase/migrations/20261001000002_functions.sql \
     supabase/migrations/20261001000003_rls.sql \
     supabase/migrations/20261001000004_client_stats.sql \
     supabase/migrations/20261001000005_storage_limits.sql \
     supabase/migrations/20261001000006_user_fk_set_null.sql \
     supabase/migrations/20261002000007_scheduling_model.sql \
     supabase/migrations/20261002000008_features.sql \
     supabase/migrations/20261002000009_hardening.sql \
     supabase/migrations/20261002000010_clients_and_self_service.sql \
     supabase/seed/01_catalog.sql
   # opcional, solo para probar: especialistas y citas de ejemplo
   node --env-file=.env.local scripts/db.mjs supabase/seed/02_demo.sql
   ```

   `01_catalog.sql` carga el catálogo real. **Dos servicios llegaron sin nombre confirmado** (keratina RD$ 2,500 y “2,500 + secado”): quedan en estado *Nombre por confirmar*, inactivos y **no se publican**. Desde *Servicios* les pones el nombre correcto y los activas.
4. **Primer administrador** — en Supabase → *Authentication → Users → Add user* (con *Auto Confirm User*). El **primer** usuario que existe se convierte automáticamente en **super administrador**; los siguientes los creas desde *Usuarios y permisos*.
5. `npm run dev` → web en <http://localhost:3000> · panel en <http://localhost:3000/admin/login>.

> **“HTTP ERROR 431” en localhost:** son cookies acumuladas de otros proyectos en `localhost`. Abre <http://127.0.0.1:3000> o una ventana de incógnito.
>
> **`npm run dev` dice que no encuentra `package.json`:** estás en la carpeta equivocada; el proyecto vive dentro de la subcarpeta `glow`.
>
> **Carpeta dentro de OneDrive:** OneDrive intenta sincronizar `node_modules` y `.next` (decenas de miles de archivos) y puede volver lento o bloquear el servidor de desarrollo. Lo ideal es mover el proyecto fuera de OneDrive (por ejemplo `C:\dev\glow`) o excluir esas dos carpetas de la sincronización.

### Variables de entorno

| Variable | Dónde | Para qué |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | local + Vercel | URL del proyecto |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | local + Vercel | clave pública (anon/publishable) |
| `SUPABASE_SERVICE_ROLE_KEY` | local + Vercel, **solo servidor** | reservas públicas, cuentas del personal. Nunca llega al navegador |
| `DATABASE_URL` | solo local | scripts de migración / verificación / limpieza (no se usa en Vercel) |
| `NEXT_PUBLIC_WHATSAPP_NUMBER` | local + Vercel | respaldo del WhatsApp (el definitivo se edita en *Configuración → Negocio*) |
| `NEXT_PUBLIC_SITE_URL` | local + Vercel | dirección pública (SEO, mapa del sitio, vistas previas). En producción, el dominio real |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_CALENDAR_ID` | opcional, **solo servidor** | Google Calendar (ver más abajo) |
| `CRON_SECRET` | opcional | solo si tu proyecto no tiene `pg_cron` (ver *Avisos internos*) |

`.env.local` está en `.gitignore`: nunca se sube al repositorio.

## Roles y permisos

Los permisos se **imponen en la base de datos** (RLS y funciones SQL), no solo escondiendo botones.

| | Super admin | Gerente | Recepción | Especialista |
|---|:-:|:-:|:-:|:-:|
| Dashboard, Reportes, Servicios, Especialistas, Promociones, Galería, Configuración, Auditoría | ✔ | ✔ | – | – |
| Usuarios y permisos | ✔ | – | – | – |
| Agenda, Solicitudes y citas, Tablero | ✔ | ✔ | ✔ | solo **sus** citas |
| Crear / editar / reprogramar / cancelar citas | ✔ | ✔ | ✔ | – |
| Iniciar y completar un servicio | ✔ | ✔ | ✔ | solo los suyos |
| Clientes | ✔ | ✔ | crear y editar | solo lectura de los suyos, **sin montos** |
| Cobrar, ventas rápidas, ver ventas y cobros | ✔ | ✔ | ✔ | – |
| **Nómina de pago** (crear, ajustar, pagar, volantes) | ✔ | ✔ | – | – |
| Anular ventas, reembolsar, eliminar registros, fusionar clientes | ✔ | ✔ | – | – |

## Qué se edita desde el panel

| Módulo | Qué puedes crear / editar / eliminar |
|---|---|
| **Servicios** | servicios (precio, duración, tiempos antes/después, comisión, foto, “desde”, destacado, consulta previa, especialistas que lo hacen), **variantes** (largo del cabello…), **complementos**, categorías (con foto), productos de venta; duplicar, ordenar, activar/ocultar. Los que ya tienen historial se archivan para no perder reportes |
| **Especialistas** | datos, foto, biografía, comisión, sueldo base, **cumpleaños** (día y mes; ese día llega una notificación), servicios (con «Marcar todos» por categoría), horario semanal con almuerzo, ausencias/vacaciones, orden, cuenta de acceso. Una especialista nueva nace con el horario del negocio y el panel avisa si le falta horario o servicios |
| **Nómina** | pago por período (quincena, mes, semana o fechas propias): ventas, **comisión**, propinas, sueldo base, bonos y descuentos de cada especialista; borrador editable → pagada (queda congelada); volante de pago y nómina completa en Excel, PDF y CSV. Ver más abajo |
| **Solicitudes, Tablero y Agenda** | todo el flujo de la cita (9 estados), arrastrar y soltar, reprogramar, varios servicios con especialistas distintos, notas, WhatsApp, citas manuales y clientes sin cita. **Se pueden agendar varias citas a la misma hora con la misma especialista** (el panel avisa, pero deja guardar; la agenda las muestra una al lado de la otra) |
| **Clientes** | alta, edición, notas privadas, historial, desactivar, **fusionar duplicados**, exportar a Excel, PDF o CSV |
| **Ventas y Cobros** | cobro con pagos divididos, propina y descuento, venta rápida de mostrador, abonos, anular, reembolsar, recibo imprimible |
| **Promociones** | combos con precio especial, fechas e imagen; el descuento se aplica solo al reservar |
| **Galería** | subir fotos (se reducen automáticamente), título, categoría, portada, orden, ocultar, eliminar |
| **Configuración** | datos del negocio y redes · **textos e imágenes de toda la web** (portada, secciones, pasos, “Nosotros”, páginas de Servicios/Reservar/Contacto, SEO) · horarios, feriados y bloqueos · reglas de reserva (incluye **cuántas citas al mismo tiempo** acepta la web por especialista) y políticas · métodos de pago · plantillas de WhatsApp · integraciones |
| **Usuarios y permisos** | crear cuentas, cambiar rol, restablecer contraseña, desactivar, eliminar |
| **Exportaciones** | botón **Exportar** en *Solicitudes y citas*, *Clientes* y *Reportes* (gerente o super admin): **Excel** (.xlsx con formato, filtros y totales), **PDF** con la marca del negocio, o **CSV** simple. Ver más abajo |
| **Auditoría** | quién hizo qué y cuándo (filtros por módulo y usuario) |

Lo que se guarda aquí se publica en la web **al instante** (no hay que esperar).

## Exportar a Excel, PDF y CSV

Cada exportación sale del mismo documento, así que los tres formatos siempre coinciden. Usan los filtros de la pantalla (rango, estado, búsqueda) y el nombre, la dirección, el teléfono y el **logo** del negocio (el logo se toma de *Configuración → Negocio* si es PNG o JPG).

| Desde | Qué trae |
|---|---|
| **Solicitudes y citas** | indicadores (por atender, completadas, canceladas, ingresos esperados, cobrado, por cobrar); listado de citas con estado en color, cliente, servicios, especialistas, origen, subtotal, descuento, propina, total, pagado y pendiente; resumen por estado, por especialista y por servicio |
| **Clientes** | indicadores; listado con visitas, total gastado, ticket promedio, cancelaciones, última visita y próxima cita; **mejores clientes** (los 20 que más gastan) y **clientes para reactivar** (activos que no vienen hace más de 90 días) |
| **Reportes → Reporte completo** | ingresos, ticket promedio, cobrado, propinas, descuentos y conversión; ventas por día, por servicio, por categoría, por especialista (con comisión estimada) y por método de pago; mejores clientes; citas por estado y días y horas con más demanda |
| **Reportes → Ventas detalladas** | una fila por venta (cliente, servicios, especialistas, descuento, propina, total, pagado, pendiente, estado y métodos de pago) y el detalle de cada artículo con su comisión |

- **Excel:** una hoja «Resumen» (con enlaces a las demás) y una hoja por tabla, con encabezado fijo, filtros, fechas y montos como datos reales (se pueden ordenar y sumar), totales con fórmula y configuración lista para imprimir. Las citas canceladas o que no asistieron no entran en los totales.
- **PDF:** portada con indicadores, tablas con encabezado de color, estados en color, barras de porcentaje, totales y «Página X de Y». Muestra hasta 2,500 filas por tabla; el Excel y el CSV traen todo.
- **CSV:** una tabla limpia para importar en otros programas (el reporte completo trae todas las secciones). Va con BOM para que Excel respete las tildes y protegido contra fórmulas maliciosas.
- Los reportes y listados leen **todas** las filas del período (antes Supabase los cortaba en 1,000).

## Nómina de pago

*Nómina* (menú, solo gerente y super admin) → **+ Nueva nómina**: eliges el período (quincena anterior, mes anterior, semana anterior o fechas propias) y se crea un **borrador** con un volante por especialista activa.

- **Comisión** = Σ (importe de cada servicio o producto vendido × % de comisión). Se usa el % de la propia venta y, si no tiene, el de la especialista (la misma regla del reporte de comisiones). Cuentan las ventas cobradas por completo (se puede incluir también las pendientes); las reembolsadas **nunca** cuentan.
- **Propinas:** se reparten entre quienes atendieron cada venta, en proporción a lo que vendió cada una (se pueden dejar fuera).
- **Neto a pagar** = sueldo base + comisión + propinas + bonos − descuentos. El sueldo base se copia de la ficha de la especialista; bonos, descuentos y una nota se escriben en cada volante (adelantos, faltas, tardanzas…).
- **Recalcular** vuelve a leer las ventas (conserva lo que escribiste). **Marcar como pagada** pide fecha, forma de pago y referencia y **congela** la nómina: ya no cambia aunque después se anule una venta (la base de datos lo impide). **Reabrir** permite corregirla a propósito (queda en Auditoría).
- No se le paga dos veces el mismo día a la misma especialista: una nómina cuyo período se cruza con otra donde ya está se rechaza con un mensaje claro. Quincenas seguidas (1–15 y 16–30) no chocan.
- **Exportar:** nómina completa (hoja de pago por especialista + detalle de las ventas que originan cada comisión) y **volante de pago** de cada una en PDF o Excel, con la marca del negocio.

## Cómo funcionan las reservas

- La clienta elige servicios (puede combinar cabello + uñas + spa), especialista o “sin preferencia”, día y hora. Solo ve horarios **realmente libres**: se calculan con el horario de cada especialista, almuerzos, ausencias, feriados, bloqueos, citas existentes, duración y tiempos de preparación.
- Un combo entre varias especialistas se agenda **en secuencia** (cada servicio con su especialista, uno tras otro).
- **Citas al mismo tiempo:** recepción y gerencia pueden agendar todas las que quieran a la misma hora con la misma especialista (el panel solo avisa). En la **web**, cada especialista acepta hasta *N* solicitudes simultáneas (*Configuración → Reservas → «Citas al mismo tiempo por especialista»*, de 1 a 10, por defecto 2; 1 = una a la vez). El tope lo comprueba la base de datos al guardar (con candado por especialista), así que ni dos clientas a la vez pueden pasarse. Hay honeypot anti-bots y un máximo de solicitudes abiertas por teléfono.
- **«No hay horarios disponibles»:** la web solo ofrece horas de especialistas **activas, visibles en reservas, con horario semanal guardado y con ese servicio asignado**. Si falta algo de eso, el panel lo avisa (etiquetas «Sin horario», «Sin servicios» en *Especialistas* y «Nadie lo realiza» en *Servicios*) y la web explica qué servicio no tiene quien lo haga en vez de mostrar un calendario vacío.
- Los teléfonos dominicanos (809/829/849) se normalizan para no duplicar clientes.
- Al completar una cita se genera la **venta** en una sola operación, idempotente (no se duplica aunque se repita el clic).
- Autoservicio: con el número de solicitud + teléfono la clienta consulta y cancela su cita en *Mi cita* (`/booking/manage`), hasta el límite de horas que defines en *Configuración → Reservas*.
- Estados: solicitud → contactando → contactado → confirmado → en espera → en servicio → completado (o cancelado / no asistió). Cada cambio queda en el historial.

## WhatsApp

El botón flotante, los botones de las tarjetas y los mensajes del panel usan el número de *Configuración → Negocio* (ahora **+1 829 619 8257**). Los mensajes de confirmación / recordatorio / libre son plantillas editables con las variables `{nombre} {servicios} {fecha} {hora} {total} {negocio}`.

## Google Calendar (opcional)

Cada cita se crea en el calendario del salón y se actualiza al cambiar de estado, reprogramarse o cancelarse (y se borra si eliminas la cita). Si Google falla, la reserva **nunca** se afecta: el error queda en *Configuración → Integraciones*. Pasos para conectarlo:

1. [Google Cloud Console](https://console.cloud.google.com) → crea un proyecto → **APIs y servicios → Biblioteca → Google Calendar API → Habilitar**.
2. **Pantalla de consentimiento OAuth**: tipo *Externo*, agrega tu correo de Google como usuario de prueba y **publícala (“En producción”)**. En modo *Prueba* Google caduca el token a los 7 días.
3. **Credenciales → Crear credenciales → ID de cliente de OAuth** (aplicación web). En *URI de redireccionamiento autorizados* pon `https://developers.google.com/oauthplayground`. Copia el *Client ID* y el *Client secret*.
4. Abre [OAuth Playground](https://developers.google.com/oauthplayground) → engranaje ⚙ → marca **Use your own OAuth credentials** y pega tus credenciales → en el paso 1 elige el alcance `https://www.googleapis.com/auth/calendar.events` → *Authorize APIs* con la cuenta dueña del calendario → paso 2 *Exchange authorization code for tokens* → copia el **Refresh token**.
5. ID del calendario: Google Calendar → ⋮ junto al calendario → *Configuración e uso compartido* → *Integrar el calendario* → **ID del calendario** (para el principal sirve `primary`).
6. Guarda `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` y `GOOGLE_CALENDAR_ID` en `.env.local` y en Vercel; reinicia. En *Configuración → Integraciones* debe decir **Conectado**; con “Enviar citas pendientes” subes las que ya existían.

> Probado contra un servidor simulado de Google (`npm run e2e:gcal`): crear, actualizar, reintentar si borraron el evento a mano, cancelar, eliminar y fallo de Google. Con tus credenciales reales haz una reserva de prueba para confirmar el último paso.

## Publicar en Vercel

1. Sube el proyecto a GitHub (la carpeta ya es un repositorio git: `git add . && git commit` y `git remote add origin …`).
2. Vercel → **Add New → Project** → importa el repositorio (detecta Next.js solo).
3. En *Environment Variables* agrega todas las de la tabla **menos `DATABASE_URL`**. Pon `NEXT_PUBLIC_SITE_URL` con tu dominio final (`https://tudominio.com`).
4. **Deploy**. Después añade tu dominio en *Settings → Domains*; si cambias `NEXT_PUBLIC_SITE_URL`, vuelve a desplegar.
5. En Supabase → *Authentication → URL Configuration*, pon el dominio en **Site URL**.
6. Elige para Vercel una región cercana al proyecto de Supabase (y a República Dominicana, p. ej. `iad1`).

### Avisos internos (“cita en menos de 1 hora”, “pago pendiente”, “hoy cumple años …”)

Los genera `pg_cron` dentro de Supabase cada 5 minutos (la migración 08 lo programa). Si tu proyecto no tiene `pg_cron`, define `CRON_SECRET` y programa una llamada cada 5 min a `GET /api/cron/reminders` con la cabecera `Authorization: Bearer <CRON_SECRET>` (en Vercel Pro, con *Cron Jobs*).

## Seguridad

- **Row Level Security** en todas las tablas; funciones sensibles solo para `service_role` o con control de rol; reservas públicas y consultas con rate-limit + restricciones en BD; sin datos privados en la web pública (empleados: solo columnas públicas).
- **Claves:** `SUPABASE_SERVICE_ROLE_KEY` y las de Google solo existen en el servidor. Si alguna se expone, rótala: Supabase → *Project Settings → API Keys* (service role) y *Database → Reset database password*; actualiza `.env.local` y Vercel.
- **Desactiva el registro público** en Supabase (paso 1 de la puesta en marcha). Aunque alguien se registrara, una cuenta sin perfil del personal no puede ver ni hacer nada (verificado), pero no hay razón para permitirlo.
- Cabeceras de seguridad (HSTS, nosniff, referrer, permissions-policy), panel con `noindex` y `no-store`, JSON-LD escapado, exportaciones CSV protegidas contra inyección de fórmulas, subidas limitadas a imágenes de 5 MB.
- No publiques datos bancarios, cédulas ni fotos con información privada en la galería o en los textos.

## Operación y mantenimiento

- **Respaldos:** los planes de pago de Supabase incluyen copias diarias. En el plan gratuito exporta periódicamente: *Clientes*, *Citas* y *Reportes* desde el panel (Excel o CSV), y/o `pg_dump "$DATABASE_URL" -Fc -f respaldo.dump`.
- **Fotos del salón:** la portada de la web, la página “Nosotros”, la imagen que sale al compartir el enlace por WhatsApp/redes y las primeras fotos de la galería son las **fotos reales del local** de la carpeta `Img del negocio/`. Se publicaron con `node --env-file=.env.local scripts/upload-business-photos.mjs` (se puede repetir sin duplicar; si cambias los archivos de la carpeta, vuelve a correrlo). También puedes cambiarlas cuando quieras desde el panel (*Configuración → Sitio web* y *Galería*).
- **Fotos de ejemplo:** los servicios, las categorías y el resto de la galería traen fotos de stock para que la web luzca completa desde el primer día. Reemplázalas por las tuyas desde *Servicios*, *Servicios → Categorías* y *Galería* (puedes ocultar o eliminar las de ejemplo una por una).
- **Conexión a la base de datos desde tu computadora:** si `npm run verify:db` o los scripts fallan con `ENOTFOUND`/`ETIMEDOUT`, tu red no tiene IPv6 o bloquea el puerto 5432. Usa en `DATABASE_URL` el *Session pooler* de Supabase (Connect → Session pooler: host `aws-0-<región>.pooler.supabase.com`, usuario `postgres.<ref>`). La web publicada no usa `DATABASE_URL`.
- **Especialistas de ejemplo:** *Ana (demo)* y *Carla (demo)* existen solo para que la reserva tenga disponibilidad. Crea a tus especialistas reales (servicios + horario) y luego elimina las demo desde *Especialistas*. `supabase/seed/99_remove_demo.sql` borra de golpe todos los datos demo (citas, ventas y clientes incluidos); si ya hay citas reales asignadas a las demo, reasígnalas o cancélalas antes.
- **Imágenes huérfanas** (fotos reemplazadas o quitadas): `npm run cleanup:storage` las lista; `npm run cleanup:storage -- --delete` borra las de más de un día.
- Para cambiar la contraseña de alguien: *Usuarios y permisos → Contraseña*. Cada persona cambia la suya en *Mi cuenta*.

## Pruebas

| Comando | Qué hace |
|---|---|
| `npm test` | pruebas unitarias (motor de disponibilidad con citas simultáneas, agenda en carriles, cumpleaños, nómina, reportes, líneas de cita, búsqueda, exportaciones a Excel/PDF/CSV, evento de Calendar, validaciones) |
| `npm run typecheck` · `npm run lint` | TypeScript y ESLint |
| `npm run verify:db` | 157 verificaciones de la base de datos (permisos por rol, ventas, pagos, citas simultáneas y tope de la web, cumpleaños, horarios por defecto, nómina, autoservicio…) dentro de una transacción que se revierte: no deja datos; sirve también con la base real |
| `npm run e2e` | pruebas de extremo a extremo con un navegador real (Playwright): web pública y reserva, todo el panel, permisos por rol, escritura tecla por tecla, tiempo real, subida de fotos y descarga de las exportaciones |
| `npm run e2e:gcal` | sincronización con Google Calendar contra un servidor simulado |
| `npm run e2e:a11y` | escaneo de accesibilidad (axe) de la web y del panel |

> Las suites nuevas `simultaneas` y `nomina` (`node e2e/run-all.mjs simultaneas nomina`) son **seguras con la base real**: solo crean y borran filas propias («E2E …», ventas de enero de 2020) y limpian hasta su rastro en Auditoría. Las demás sí modifican datos:
>
> ⚠ Las pruebas **E2E escriben y borran datos** en la base de `.env.local` y cambian (y restauran) algunos ajustes. Úsalas con un proyecto de Supabase de pruebas, no durante la operación real. Necesitan los datos demo y, la primera vez, `npx playwright install chromium`. Con la web corriendo (`npm run build && npm start`) ejecuta `npm run e2e`; crea y borra solas los usuarios `tmp-*@glow.test`.

## Estructura

```
app/
  (public)/        web pública: inicio, servicios, reservar, mi cita, galería, nosotros, contacto
  admin/           login y panel (layout con permisos por rol)
  api/             disponibilidad y respaldo de cron
components/        public/ · admin/ · ui/
lib/
  domain/          reglas puras con pruebas (disponibilidad, reportes, estados, contenido del sitio…)
  data/            lecturas (cacheadas las públicas, con purga instantánea al guardar en el panel)
  actions/         Server Actions (reservas, panel)
  integrations/    Google Calendar
  supabase/        clientes (servidor, navegador, público, admin)
supabase/
  migrations/      esquema, funciones, RLS, endurecimiento
  seed/            catálogo real, datos demo
scripts/           migraciones, verificación de BD, limpieza de almacenamiento, publicar fotos del salón, usuarios de prueba
e2e/               pruebas de navegador
Img del negocio/   fotos originales del local (se publican con scripts/upload-business-photos.mjs)
proxy.ts           protege /admin (sesión)
```

## Fuera de alcance de esta versión

Facturación fiscal (NCF / ITBIS), pagos en línea, avisos automáticos por correo o SMS, varias sucursales y traducción del texto a inglés (la fecha, el idioma y la moneda están centralizados, pero los textos están en español).
