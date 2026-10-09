import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminProvider } from "@/components/admin/AdminContext";
import { AdminShell, type NavItem } from "@/components/admin/AdminShell";
import { getSession } from "@/lib/auth";
import { loadAdminData } from "@/lib/data/admin";
import { can, type Area } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: { default: "Panel", template: "%s | Glow Admin" }, robots: { index: false, follow: false } };

const NAV: (NavItem & { area: Area })[] = [
  { href: "/admin", label: "Dashboard", area: "dashboard" },
  { href: "/admin/calendar", label: "Agenda", area: "agenda" },
  { href: "/admin/appointments", label: "Solicitudes y citas", area: "appointments" },
  { href: "/admin/appointments/board", label: "Tablero", area: "appointments" },
  { href: "/admin/clients", label: "Clientes", area: "clients" },
  { href: "/admin/services", label: "Servicios", area: "services" },
  { href: "/admin/staff", label: "Especialistas", area: "staff" },
  { href: "/admin/cash", label: "Caja", area: "cash" },
  { href: "/admin/sales", label: "Ventas", area: "sales" },
  { href: "/admin/payments", label: "Cobros", area: "payments" },
  { href: "/admin/payroll", label: "Nómina", area: "payroll" },
  { href: "/admin/reports", label: "Reportes", area: "reports" },
  { href: "/admin/promotions", label: "Promociones", area: "promotions" },
  { href: "/admin/gallery", label: "Galería", area: "gallery" },
  { href: "/admin/settings", label: "Configuración", area: "settings" },
  { href: "/admin/audit", label: "Auditoría", area: "audit" },
  { href: "/admin/users", label: "Usuarios y permisos", area: "users" },
];

export default async function PanelLayout({ children }: LayoutProps<"/admin">) {
  const session = await getSession();
  if (!session) redirect("/admin/logout");
  const items = NAV.filter((n) => can(session.role, n.area)).map(({ href, label }) => ({ href, label }));

  const [data, notifications] = await Promise.all([
    loadAdminData(session),
    session.role === "specialist"
      ? Promise.resolve([])
      : createClient().then((sb) => sb.from("notifications").select("*").order("created_at", { ascending: false }).limit(30)).then((r) => r.data ?? []),
  ]);
  return (
    <AdminProvider data={data}>
      <AdminShell items={items} user={{ name: session.fullName, role: session.role, email: session.email }} notifications={notifications}>
        {children}
      </AdminShell>
    </AdminProvider>
  );
}
