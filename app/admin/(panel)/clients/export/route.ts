import { getSession } from "@/lib/auth";
import { toCSV } from "@/lib/domain/reports";
import { todayISO } from "@/lib/format";
import { can } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const s = await getSession();
  if (!s || !can(s.role, "reports")) return new Response("Prohibido", { status: 403 });
  const sb = await createClient();
  const [{ data: clients }, { data: stats }] = await Promise.all([
    sb.from("clients").select("id,first_name,last_name,phone,email,active,created_at").order("created_at", { ascending: false }).limit(20000),
    sb.from("client_stats").select("client_id,visits,total_spent,last_visit,cancellations,no_shows").limit(20000),
  ]);
  const st = new Map((stats ?? []).map((x) => [x.client_id, x]));
  const day = (iso?: string | null) => (iso ? iso.slice(0, 10) : "");
  const rows: (string | number)[][] = [
    ["Nombre", "Apellido", "WhatsApp", "Correo", "Estado", "Visitas", "Total gastado", "Cancelaciones", "No asistió", "Última visita", "Cliente desde"],
    ...(clients ?? []).map((c) => { const x = st.get(c.id); return [c.first_name, c.last_name, c.phone, c.email ?? "", c.active ? "Activo" : "Inactivo", x?.visits ?? 0, Number(x?.total_spent ?? 0), x?.cancellations ?? 0, x?.no_shows ?? 0, day(x?.last_visit), day(c.created_at)]; }),
  ];
  return new Response(toCSV(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="glow-clientes-${todayISO()}.csv"` } });
}
