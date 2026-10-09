import { fmtDateTime } from "@/lib/format";
import { CalendarSync } from "@/components/admin/content/CalendarSync";
import { PaymentMethodsManager } from "@/components/admin/content/PaymentMethodsManager";
import { SiteContentForm } from "@/components/admin/content/SiteContentForm";
import { BlocksForm, BookingForm, BusinessForm, HoursForm } from "@/components/admin/content/SettingsForms";
import { WhatsAppTemplatesForm } from "@/components/admin/content/WhatsAppTemplatesForm";
import { PageHead } from "@/components/admin/primitives";
import { TabNav } from "@/components/admin/TabNav";
import u from "@/components/admin/ui.module.css";
import { requireAccess } from "@/lib/auth";
import { normalizeSettings } from "@/lib/domain/settings";
import { mergeTemplates } from "@/lib/domain/whatsappTemplates";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Configuración" };
const TABS = [
  { key: "negocio", label: "Negocio" }, { key: "sitio", label: "Sitio web" }, { key: "horarios", label: "Horarios y bloqueos" },
  { key: "reservas", label: "Reservas" }, { key: "pagos", label: "Métodos de pago" }, { key: "whatsapp", label: "WhatsApp" }, { key: "integraciones", label: "Integraciones" },
];

export default async function SettingsPage({ searchParams }: PageProps<"/admin/settings">) {
  await requireAccess("settings");
  const sp = await searchParams;
  const tab = TABS.some((t) => t.key === sp.tab) ? String(sp.tab) : "negocio";
  const sb = await createClient();
  const { data: rows } = await sb.from("business_settings").select("key,value");
  const map = Object.fromEntries((rows ?? []).map((r) => [r.key, r.value]));
  const settings = normalizeSettings(map);

  return (
    <>
      <PageHead title="Configuración" sub="Todo lo que ve el cliente en la web, y cómo funciona tu negocio, se edita aquí." />
      <TabNav base="/admin/settings" current={tab} tabs={TABS} />

      {tab === "negocio" && <BusinessForm initial={settings.business} />}
      {tab === "sitio" && <SiteContentForm initial={settings.content} />}
      {tab === "horarios" && <HorariosTab hours={settings.hours} />}
      {tab === "reservas" && <BookingForm booking={settings.booking} policies={settings.policies} />}
      {tab === "pagos" && <PagosTab />}
      {tab === "whatsapp" && <WhatsAppTemplatesForm initial={mergeTemplates(map.whatsapp_templates)} />}
      {tab === "integraciones" && <IntegracionesTab />}
    </>
  );
}

async function HorariosTab({ hours }: { hours: ReturnType<typeof normalizeSettings>["hours"] }) {
  const sb = await createClient();
  const [{ data: blocks }, { data: staff }] = await Promise.all([
    sb.from("schedule_blocks").select("*").gte("ends_at", new Date().toISOString()).order("starts_at"),
    sb.from("employees").select("id,full_name").eq("active", true).order("display_order"),
  ]);
  return (
    <div className={u.grid}>
      <HoursForm initial={hours} />
      <BlocksForm blocks={blocks ?? []} staff={staff ?? []} />
    </div>
  );
}

async function PagosTab() {
  const sb = await createClient();
  // `is_cash` existe cuando la actualización de la caja está instalada; si no, no se ofrece esa opción
  const full = await sb.from("payment_methods").select("key,label,active,is_cash").order("display_order").order("label");
  if (!full.error) return <PaymentMethodsManager methods={(full.data ?? []).map((m) => ({ key: m.key, label: m.label, active: m.active, isCash: !!m.is_cash }))} />;
  const { data } = await sb.from("payment_methods").select("key,label,active").order("display_order").order("label");
  return <PaymentMethodsManager methods={data ?? []} />;
}

async function IntegracionesTab() {
  const sb = await createClient();
  const { data: cal } = await sb.from("calendar_integrations").select("last_sync_at,last_error").eq("provider", "google").maybeSingle();
  const g = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN && process.env.GOOGLE_CALENDAR_ID);
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  return (
    <div className={u.grid}>
      <section className={u.card}>
        <h2>Google Calendar</h2>
        <p><span className={`${u.badge} ${g ? u.green : u.gold}`}>{g ? "Conectado (credenciales en el servidor)" : "No configurado"}</span></p>
        {g ? (
          <>
            <p className={u.sub}>Cada cita se envía al calendario del salón y se actualiza cuando cambia su estado: “Solicitud”, “CONFIRMADA”, “COMPLETADA” o “CANCELADA”.</p>
            <p className={u.sub}>Última sincronización: {cal?.last_sync_at ? fmtDateTime(cal.last_sync_at) : "aún no"}{cal?.last_error ? ` · último error: ${cal.last_error}` : ""}</p>
            <CalendarSync />
          </>
        ) : (
          <>
            <p className={u.sub}>Para conectarlo define estas variables de entorno <strong>solo en el servidor</strong> (archivo .env.local y en Vercel). Nunca se exponen al navegador:</p>
            <ul style={{ margin: "8px 0", paddingLeft: 18 }} className={u.sub}>
              <li><code>GOOGLE_CLIENT_ID</code> y <code>GOOGLE_CLIENT_SECRET</code>: credenciales OAuth de Google Cloud (API de Google Calendar activada).</li>
              <li><code>GOOGLE_REFRESH_TOKEN</code>: token de actualización de la cuenta dueña del calendario (se obtiene con OAuth Playground).</li>
              <li><code>GOOGLE_CALENDAR_ID</code>: el ID del calendario del salón (Configuración del calendario → Integrar calendario).</li>
            </ul>
            <p className={u.sub}>Los pasos detallados están en el archivo README del proyecto.</p>
          </>
        )}
      </section>
      <section className={u.card}>
        <h2>Sitio público</h2>
        <p className={u.sub}>{site ? <>Dirección configurada: <a className={u.link} href={site} target="_blank" rel="noopener">{site}</a>.</> : "Define NEXT_PUBLIC_SITE_URL con la dirección final de tu web para que los enlaces, el mapa del sitio y las vistas previas en redes funcionen."}</p>
        <p className={u.sub}>Mapa del sitio: <code>/sitemap.xml</code> · Robots: <code>/robots.txt</code>. Los cambios que guardas en este panel se publican de inmediato.</p>
      </section>
      <section className={u.card}>
        <h2>Avisos internos</h2>
        <p className={u.sub}>La campana avisa en tiempo real de nuevas solicitudes, cancelaciones y cambios, y cada 5 minutos revisa las citas que empiezan en menos de una hora y las ventas con saldo pendiente.</p>
      </section>
    </div>
  );
}
