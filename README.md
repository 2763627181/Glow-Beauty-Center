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
| **Caja** (abrir y cerrar, entradas y salidas de efectivo, producción por especialista) | ✔ | ✔ | ✔ | – |
| Anular un movimiento de caja y reabrir un cierre | ✔ | ✔ | – | – |
| **Nómina de pago** (crear, ajustar, pagar, volantes) | ✔ | ✔ | – | – |
| Anular ventas, reembolsar, eliminar registros, fusionar clientes | ✔ | ✔ | – | – |

## Qué se edita desde el panel

| Módulo | Qué puedes crear / editar / eliminar |
|---|---|
| **Servicios** | servicios (precio, duración, tiempos antes/después, comisión, foto, “desde”, destacado, consulta previa, especialistas que lo hacen), **variantes** (largo del cabello…), **complementos**, categorías (con foto), productos de venta; duplicar, ordenar, activar/ocultar. Los que ya tienen historial se archivan para no perder reportes |
| **Especialistas** | datos, foto, biografía, comisión, sueldo base, **cumpleaños** (día y mes; ese día llega una notificación), servicios (con «Marcar todos» por categoría), horario semanal con almuerzo, ausencias/vacaciones, orden, cuenta de acceso. Una especialista nueva nace con el horario del negocio y el panel avisa si le falta horario o servicios |
| **Caja** | turnos de caja (fondo inicial, cobros en efectivo con **vuelto**, tarjeta y transferencia que se cobran aparte, entradas y salidas de efectivo, pago a especialistas, cierre con diferencia), la producción de cada especialista con lo que **paga al salón**, y el reporte de cada cierre en Excel, PDF y CSV. Ver más abajo |
| **Nómina** | pago por período (quincena, mes, semana o fechas propias): ventas, **comisión**, propinas, sueldo base, bonos y descuentos de cada especialista; borrador editable → pagada (queda congelada); volante de pago y nómina completa en Excel, PDF y CSV. Ver más abajo |
| **Solicitudes, Tablero y Agenda** | todo el flujo de la cita (9 estados), arrastrar y soltar, reprogramar, varios servicios con especialistas distintos, notas, WhatsApp, citas manuales y clientes sin cita. **Sin límites desde el panel:** varias citas a la misma hora con la misma especialista, cualquier especialista para cualquier servicio y citas a horas que ya pasaron (el panel solo avisa; la agenda muestra las simultáneas una al lado de la otra). **Varias especialistas por servicio:** en *Nueva cita* y *Cliente sin cita* marcas una o varias por servicio (por ejemplo, manicure con Esther y Santa, y pedicure con otra) y puedes marcar «al mismo tiempo que el servicio anterior»; al editar, «+ Otra especialista» suma una al servicio |
| **Clientes** | alta, edición, notas privadas, historial, desactivar, **fusionar duplicados**, exportar a Excel, PDF o CSV |
| **Ventas y Cobros** | cobro con pagos divididos, propina y descuento, venta rápida de mostrador, abonos, anular, reembolsar, recibo imprimible |
| **Promociones** | combos con precio especial, fechas e imagen; el descuento se aplica solo al reservar |
| **Galería** | subir fotos (se reducen automáticamente), título, categoría, portada, orden, ocultar, eliminar |
| **Configuración** | datos del negocio y redes · **textos e imágenes de toda la web** (portada, secciones, pasos, “Nosotros”, páginas de Servicios/Reservar/Contacto, SEO) · horarios, feriados y bloqueos · reglas de reserva (incluye **cuántas citas al mismo tiempo** acepta la web por especialista) y políticas · métodos de pago · plantillas de WhatsApp · integraciones |
| **Usuarios y permisos** | crear cuentas, cambiar rol, restablecer contraseña, desactivar, eliminar |
| **Exportaciones** | botón **Exportar** en *Solicitudes y citas*, *Clientes* y *Reportes* (gerente o super admin): **Excel** (.xlsx con formato, filtros y totales), **PDF** con la marca del negocio, o **CSV** simple. Ver más abajo |
| **Eliminar** | gerencia y super admin pueden eliminar **citas, solicitudes, clientes y ventas**, uno por uno (botón «Eliminar» en cada fila, tarjeta del Tablero y ficha) o varios a la vez (casillas + «Eliminar seleccionados»), incluso con historial: un cliente con citas o ventas se borra marcando «Borrar también su historial», y una cita completada se lleva su venta y sus pagos. Antes de borrar el diálogo cuenta exactamente qué se va (citas, ventas, pagos y dinero) y, si hay dinero o son varios, pide marcar «Entiendo que no se puede deshacer». Al borrar una venta puedes eliminar también su cita o dejarla «confirmada» para cobrarla de nuevo. La campana tiene «Borrar leídas» y «Borrar todas» (también recepción). Todo queda en Auditoría |
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

## Caja

*Caja* (menú; super admin, gerente y recepción). Es la pantalla del día a día: se **abre** con el efectivo que hay en la gaveta (sugiere lo que se contó al cerrar la vez anterior), se cobra, y se **cierra** contando el efectivo.

- **Cobrar:** en *Por cobrar* aparecen las citas de hoy (y las que siguen en servicio) y las ventas con saldo; *Cobrar* abre el cobro, donde se pueden cambiar los servicios y sus montos, el descuento y la propina. También está *+ Nueva venta* para productos o servicios sin cita.
- **Efectivo con vuelto:** en la fila de efectivo se escribe lo que **entregó el cliente** (o se toca un atajo: «Exacto», 1,800, 2,000…). El sistema calcula lo cobrado y el **vuelto** (servicio de 1,700 con 2,000 → cobra 1,700, devuelve 300), lo deja a la vista en una pantalla que no desaparece sola, y guarda lo recibido: se ve en el recibo y en el reporte. El vuelto no entra a la caja: solo cuenta lo cobrado.
- **Tarjeta, transferencia y otros:** se cobran **aparte** (datáfono o banco). Aquí solo se registra cuánto fue, con qué método y su referencia o aprobación; no entran al efectivo de la caja, no tienen vuelto y salen en el reporte como «Cobrado aparte». Qué métodos son efectivo se decide en *Configuración → Métodos de pago* («Es efectivo»).
- **Para cobrar en efectivo la caja debe estar abierta** (hay un botón para abrirla en el mismo aviso). Solo puede haber una caja abierta a la vez. Tarjeta y transferencia se pueden registrar con la caja cerrada.
- **Efectivo cobrado con la caja cerrada** (por ejemplo, desde una pestaña vieja): no se pierde; la pantalla de Caja lo avisa («Efectivo cobrado fuera de la caja») para contarlo al abrir. No se considera lo cobrado antes de usar la caja por primera vez.
- **Entradas y salidas de efectivo:** *Salida de efectivo* (pago a una especialista, entrega de propina, compra, gasto, retiro u otro) y *Entrada de efectivo* (dinero que se agrega). Una salida no puede ser mayor que el efectivo que hay. Gerencia puede **anular** un movimiento con motivo (el dinero vuelve); queda en Auditoría.
- **Producción por especialista:** de lo vendido en el turno, lo que se **queda ella** y lo que **paga al salón** según su porcentaje (en su ficha: *Comisión %* y *Paga al salón %* son lo mismo visto al revés — si paga el 15 %, su comisión es 85 %). También lo ya **entregado desde la caja** y lo que **falta por entregar**, con un botón *Pagar* que prepara la salida. Los servicios sin porcentaje configurado se avisan y no se reparten.
- **Efectivo que debe haber** = fondo inicial + efectivo cobrado + entradas − efectivo reembolsado − salidas. Un reembolso en efectivo sale de la caja del momento en que se devuelve el dinero, aunque el cobro sea de otro día; uno de tarjeta o transferencia no toca el efectivo.
- **Cerrar caja:** se cuenta el efectivo (hay un contador de billetes y monedas) y se compara con lo que debe haber; si hay **diferencia** (faltante o sobrante) la nota es obligatoria. El cierre guarda una **foto del reporte**: lo que se cobre o anule después ya no la cambia. Gerencia puede **reabrir el último cierre** si se contó mal (con motivo; lo cobrado en efectivo mientras estuvo cerrada vuelve a contar).
- **Reporte de cada cierre** (*Caja → Cierres anteriores → Ver*): cuadre, cobros con cliente, venta, recibido y vuelto, entradas y salidas, producción y cobrado por método; imprimir o exportar a Excel, PDF y CSV.
- La actualización de la base de datos es `supabase/migrations/20261008000016_caja.sql` (no borra nada y se puede volver a ejecutar). Sin ella la pantalla lo avisa y el panel sigue funcionando como antes.

## Nómina de pago

*Nómina* (menú, solo gerente y super admin) → **+ Nueva nómina**: eliges el período (quincena anterior, mes anterior, semana anterior o fechas propias) y se crea un **borrador** con un volante por especialista activa.

- **Comisión** = Σ (importe de cada servicio o producto vendido × % de comisión). Se usa el % de la propia venta y, si no tiene, el de la especialista (la misma regla del reporte de comisiones). Cuentan las ventas cobradas por completo (se puede incluir también las pendientes); las reembolsadas **nunca** cuentan.
- **Propinas:** se reparten entre quienes atendieron cada venta, en proporción a lo que vendió cada una (se pueden dejar fuera).
- **Neto a pagar** = sueldo base + comisión + propinas + bonos − descuentos. El sueldo base se copia de la ficha de la especialista; bonos, descuentos y una nota se escriben en cada volante (adelantos, faltas, tardanzas…).
- **Recalcular** vuelve a leer las ventas (conserva lo que escribiste). **Marcar como pagada** pide fecha, forma de pago y referencia y **congela** la nómina: ya no cambia aunque después se anule una venta (la base de datos lo impide). **Reabrir** permite corregirla a propósito (queda en Auditoría).
- No se le paga dos veces el mismo día a la misma especialista: una nómina cuyo período se cruza con otra donde ya está se rechaza con un mensaje claro. Quincenas seguidas (1–15 y 16–30) no chocan.
- **Exportar:** nómina completa (hoja de pago por especialista + detalle de las ventas que originan cada comisión) y **volante de pago** de cada una en PDF o Excel, con la marca del negocio.

## Eliminar registros

Los botones de eliminar los ven solo super administrador y gerencia (recepción y especialistas no). El borrado es **definitivo**: se llevan lo que dependía del registro (cita → su venta y pagos; venta → artículos y pagos; cliente con historial → sus citas, ventas y pagos) y ese dinero deja de aparecer en ventas, cobros, reportes y nómina. Si prefieres conservar el historial de un cliente, desactívalo o fusiónalo con otro en su ficha.

Por dentro, la migración 15 instala funciones atómicas (`delete_appointments`, `delete_sales`, `delete_clients`, `clear_notifications`, `describe_deletion`): una sola transacción y cada fila borrada queda en Auditoría con quien la borró. Si todavía no están instaladas, el panel hace lo mismo por la API de Supabase (en varios pasos y anotando en Auditoría un resumen con el usuario), así que **funciona igual**; se recomienda aplicar la migración (SQL Editor de Supabase) para tener la versión atómica.

## Cómo funcionan las reservas

- La clienta elige servicios (puede combinar cabello + uñas + spa), especialista o “sin preferencia”, día y hora. Solo ve horarios **realmente libres**: se calculan con el horario de cada especialista, almuerzos, ausencias, feriados, bloqueos, citas existentes, duración y tiempos de preparación.
- Un combo entre varias especialistas se agenda **en secuencia** (cada servicio con su especialista, uno tras otro).
- **Citas al mismo tiempo, sin límite por defecto:** recepción y gerencia pueden agendar todas las que quieran a la misma hora con la misma especialista, asignar a **cualquier** especialista activa a cualquier servicio (en el selector salen primero las que lo tienen marcado y aparte el resto del equipo) y registrar o mover citas a horas que ya pasaron. El panel solo avisa. En la **web** también: cada especialista acepta todas las solicitudes que lleguen a la misma hora (*Configuración → Reservas → «Citas al mismo tiempo por especialista»*: **0 = sin límite**, que es el valor por defecto; si prefieres un tope, pon de 1 a 10). La web sigue respetando el horario de cada especialista, los feriados y bloqueos, la anticipación mínima y que el servicio esté marcado a la especialista; la anticipación mínima se puede poner en 0 en esa misma pantalla. Si defines un tope, la base de datos lo comprueba al guardar (con candado por especialista). Hay honeypot anti-bots y un máximo de solicitudes abiertas por teléfono.
- **Varias especialistas por servicio y servicios al mismo tiempo:** en el paso *¿Con quién prefieres?* la clienta responde por cada servicio: «cualquier especialista disponible» o las que prefiera (puede marcar varias: todas lo atienden a la vez). Con dos o más servicios puede marcar «Quiero que me atiendan al mismo tiempo» (manicure con una especialista y pedicure con otra a la vez; la cita dura lo del servicio más largo). La web solo ofrece horas en que **todas** las elegidas están libres a la vez. Por dentro, cada especialista de un servicio queda con su propia línea de la cita (misma hora, mismo equipo): así la agenda, la venta, las comisiones y la nómina siguen exactos; el precio del servicio se reparte en partes iguales entre ellas (se puede ajustar al editar) y en pantallas, WhatsApp, Google Calendar y exportaciones se muestra como un solo servicio con todas sus especialistas.
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
- **Especialistas de ejemplo:** en una instalación nueva, la semilla `supabase/seed/02_demo.sql` crea a *Ana (demo)* y *Carla (demo)* solo para que la reserva tenga disponibilidad. En el salón real **ya se eliminaron** (junto con las citas y ventas de prueba que las usaban). Para quitarlas en otra instalación: crea a tus especialistas reales y borra los datos demo con `supabase/seed/99_remove_demo.sql` (citas, ventas y clientes demo incluidos); si ya hay citas o ventas reales asignadas a ellas la base lo impide: reasígnalas, cancélalas o bórralas antes. `npm run verify:db` no necesita las demo (las crea dentro de su transacción y la revierte).
- **Imágenes huérfanas** (fotos reemplazadas o quitadas): `npm run cleanup:storage` las lista; `npm run cleanup:storage -- --delete` borra las de más de un día.
- Para cambiar la contraseña de alguien: *Usuarios y permisos → Contraseña*. Cada persona cambia la suya en *Mi cuenta*.

## Pruebas

| Comando | Qué hace |
|---|---|
| `npm test` | pruebas unitarias (motor de disponibilidad con citas simultáneas, equipos y servicios al mismo tiempo, agenda en carriles, cumpleaños, nómina, caja (vuelto, efectivo esperado, producción), reportes, líneas de cita, búsqueda, exportaciones a Excel/PDF/CSV, evento de Calendar, validaciones) |
| `npm run typecheck` · `npm run lint` | TypeScript y ESLint |
| `npm run verify:db` | 288 verificaciones de la base de datos (permisos por rol, ventas, pagos, caja, vuelto, citas simultáneas y tope opcional de la web, eliminar registros, panel sin límites de especialista ni de fecha, cumpleaños, horarios por defecto, nómina, autoservicio…) dentro de una transacción que se revierte: no deja datos; sirve también con la base real |
| `npm run e2e` | pruebas de extremo a extremo con un navegador real (Playwright): web pública y reserva, todo el panel, permisos por rol, escritura tecla por tecla, tiempo real, subida de fotos y descarga de las exportaciones |
| `npm run e2e:gcal` | sincronización con Google Calendar contra un servidor simulado |
| `npm run e2e:a11y` | escaneo de accesibilidad (axe) de la web y del panel |

> Las suites nuevas `simultaneas`, `nomina`, `equipos` y `caja` (`node e2e/run-all.mjs simultaneas nomina equipos caja`) son **seguras con la base real**: solo crean y borran filas propias («E2E …», ventas de enero de 2020) y limpian hasta su rastro en Auditoría. Las demás sí modifican datos:
>
> ⚠ Las pruebas **E2E escriben y borran datos** en la base de `.env.local` y cambian (y restauran) algunos ajustes. Úsalas con un proyecto de Supabase de pruebas, no durante la operación real. Las suites antiguas (`public`, `admin-a/b/c`, `roles`…) usan las especialistas demo de la semilla, así que solo corren en un proyecto con datos demo; `simultaneas`, `nomina`, `equipos`, `exports` y `a11y` no las necesitan. La primera vez, `npx playwright install chromium`. Con la web corriendo (`npm run build && npm start`) ejecuta `npm run e2e`; crea y borra solas los usuarios `tmp-*@glow.test`.

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
