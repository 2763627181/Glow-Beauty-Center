import { getSession } from "@/lib/auth";
import { fetchAll } from "@/lib/data/paginate";
import { clientsDoc, type ClientExportRow } from "@/lib/export/docs";
import { parseFormat } from "@/lib/export/model";
import { exportContext, exportResponse } from "@/lib/export/server";
import { can } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;
const LIMIT = 30000;

/** Clientes en Excel, PDF o CSV (`?format=xlsx|pdf|csv`). */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s || !can(s.role, "reports")) return new Response("Prohibido", { status: 403 });
  try {
    const sb = await createClient();
    const [clients, stats] = await Promise.all([
      fetchAll((from, to) => sb.from("clients").select("id,first_name,last_name,phone,email,active,created_at").order("created_at", { ascending: false }).order("id").range(from, to), LIMIT),
      fetchAll((from, to) => sb.from("client_stats").select("client_id,visits,total_spent,last_visit,next_appointment,cancellations,no_shows").order("client_id").range(from, to), LIMIT),
    ]);
    const by = new Map(stats.map((x) => [x.client_id, x]));
    const rows: ClientExportRow[] = clients.map((c) => {
      const x = by.get(c.id);
      return {
        first_name: c.first_name, last_name: c.last_name, phone: c.phone, email: c.email, active: c.active, created_at: c.created_at,
        visits: x?.visits ?? 0, total_spent: Number(x?.total_spent ?? 0), last_visit: x?.last_visit ?? null, next_appointment: x?.next_appointment ?? null,
        cancellations: x?.cancellations ?? 0, no_shows: x?.no_shows ?? 0,
      };
    });
    return await exportResponse(clientsDoc(rows, await exportContext()), parseFormat(new URL(req.url).searchParams.get("format")));
  } catch (e) {
    console.error("export clientes", e);
    return new Response("No se pudo generar el archivo.", { status: 500 });
  }
}
