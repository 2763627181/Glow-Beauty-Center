import { uniqueDescriptions } from "@/lib/domain/serviceLines";
import Link from "next/link";
import { Suspense } from "react";
import { EmptyState, PageHead, PayBadge } from "@/components/admin/primitives";
import { QuickSale } from "@/components/admin/sales/QuickSale";
import u from "@/components/admin/ui.module.css";
import { UrlSearch } from "@/components/admin/UrlSearch";
import { requireAccess } from "@/lib/auth";
import { applyClientSearch, cleanTerm } from "@/lib/data/client-search";
import { drToISO, fmtDate, money } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Ventas" };
const SIZE = 30;
const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function SalesPage({ searchParams }: PageProps<"/admin/sales">) {
  await requireAccess("sales");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const status = typeof sp.status === "string" ? sp.status : "";
  const search = typeof sp.q === "string" ? sp.q.trim() : "";
  const from = isDay(sp.from) ? sp.from : "";
  const to = isDay(sp.to) ? sp.to : "";

  const sb = await createClient();
  const { data: methods } = await sb.from("payment_methods").select("key,label");
  const label = new Map((methods ?? []).map((m) => [m.key, m.label]));

  let q = sb.from("sales")
    .select("id,sale_number,completed_at,subtotal,discount,total,payment_status,voided_at,client:clients(first_name,last_name),employee:employees(full_name),sale_items(description,team_id),payments(method,status)", { count: "exact" })
    .order("completed_at", { ascending: false }).range((page - 1) * SIZE, page * SIZE - 1);
  if (["pendiente", "parcial", "pagado", "reembolsado"].includes(status)) q = q.eq("payment_status", status);
  if (from) q = q.gte("completed_at", drToISO(from, "00:00"));
  if (to) q = q.lt("completed_at", new Date(new Date(drToISO(to, "00:00")).getTime() + 864e5).toISOString());
  if (search) {
    const { data: cl } = await applyClientSearch(sb.from("clients").select("id"), search).limit(100);
    const ids = (cl ?? []).map((c) => c.id);
    const term = cleanTerm(search);
    q = q.or([ids.length ? `client_id.in.(${ids.join(",")})` : null, `sale_number.ilike.%${term}%`].filter(Boolean).join(","));
  }
  const { data, count } = await q;
  const pages = Math.max(1, Math.ceil((count ?? 0) / SIZE));
  const keep = (extra: Record<string, string>) => `/admin/sales?${new URLSearchParams({ ...(status ? { status } : {}), ...(search ? { q: search } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}), ...extra })}`;

  return (
    <>
      <PageHead title="Ventas" sub={`${count ?? 0} registradas`}>
        <QuickSale />
      </PageHead>
      <div className={u.filters}>
        {["", "pendiente", "parcial", "pagado", "reembolsado"].map((s) => (
          <Link key={s} href={`/admin/sales?${new URLSearchParams({ ...(s ? { status: s } : {}), ...(search ? { q: search } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) })}`}
            className={`${u.badge} ${status === s ? u.pink : u.gray}`} style={{ minHeight: 36, padding: "0 14px", display: "inline-flex", alignItems: "center" }}>{s ? s[0].toUpperCase() + s.slice(1) : "Todas"}</Link>
        ))}
        <Suspense><UrlSearch placeholder="Buscar por cliente, teléfono o GBC-…" /></Suspense>
        <form style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {status && <input type="hidden" name="status" value={status} />}{search && <input type="hidden" name="q" value={search} />}
          <label className="sr-only" htmlFor="s-from">Desde</label><input id="s-from" type="date" name="from" defaultValue={from} />
          <label className="sr-only" htmlFor="s-to">Hasta</label><input id="s-to" type="date" name="to" defaultValue={to} />
          <button className={`${u.badge} ${u.sage}`} style={{ minHeight: 40, padding: "0 14px", border: 0 }}>Filtrar fechas</button>
          {(from || to) && <Link className={u.link} href={keep({ from: "", to: "" }).replace(/&?(from|to)=/g, "")}>Quitar fechas</Link>}
        </form>
      </div>
      <div className={u.card}>
        {!data?.length ? <EmptyState title="Sin ventas" text={search || from || to || status ? "No hay ventas con estos filtros." : "Las ventas de citas se crean solas al completarlas; también puedes registrar una venta rápida."} /> : (
          <div className={u.tableWrap}>
            <table className={`${u.table} ${u.stack}`}>
              <thead><tr><th>Número</th><th>Fecha</th><th>Cliente</th><th>Servicios</th><th>Especialista</th><th className={u.num}>Subtotal</th><th className={u.num}>Desc.</th><th className={u.num}>Total</th><th>Método</th><th>Estado</th></tr></thead>
              <tbody>
                {data.map((s: any) => (
                  <tr key={s.id}>
                    <td data-label="Número"><Link className={u.link} href={`/admin/sales/${s.id}`}>{s.sale_number}</Link></td>
                    <td data-label="Fecha">{fmtDate(s.completed_at, { day: "numeric", month: "short" })}</td>
                    <td data-label="Cliente">{s.client ? `${s.client.first_name} ${s.client.last_name}` : "Mostrador"}</td>
                    <td data-label="Servicios">{uniqueDescriptions(s.sale_items).join(", ")}</td>
                    <td data-label="Especialista">{s.employee?.full_name ?? "—"}</td>
                    <td data-label="Subtotal" className={u.num}>{money(s.subtotal)}</td>
                    <td data-label="Desc." className={u.num}>{Number(s.discount) ? `−${money(s.discount)}` : "—"}</td>
                    <td data-label="Total" className={u.num}><strong>{money(s.total)}</strong></td>
                    <td data-label="Método">{[...new Set(s.payments.filter((p: any) => p.status === "pagado").map((p: any) => label.get(p.method) ?? p.method))].join(", ") || "—"}</td>
                    <td data-label="Estado"><PayBadge status={s.payment_status} />{s.voided_at && <span className={`${u.badge} ${u.red}`} style={{ marginLeft: 6 }}>Anulada</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <nav style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 16 }} aria-label="Paginación">
            {page > 1 && <Link className={u.link} href={keep({ page: String(page - 1) })}>← Anterior</Link>}
            <span className={u.sub}>Página {page} de {pages}</span>
            {page < pages && <Link className={u.link} href={keep({ page: String(page + 1) })}>Siguiente →</Link>}
          </nav>
        )}
      </div>
    </>
  );
}
