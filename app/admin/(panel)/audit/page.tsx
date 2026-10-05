import { fmtDateTime } from "@/lib/format";
import Link from "next/link";
import { EmptyState, PageHead } from "@/components/admin/primitives";
import u from "@/components/admin/ui.module.css";
import { requireAccess } from "@/lib/auth";
import { ACTION_LABEL, ENTITY_LABEL, diffRecords, summarizeAudit } from "@/lib/domain/audit";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Auditoría" };
const SIZE = 40;
/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function AuditPage({ searchParams }: PageProps<"/admin/audit">) {
  await requireAccess("audit");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const entity = typeof sp.entity === "string" && sp.entity in ENTITY_LABEL ? sp.entity : "";
  const sb = await createClient();
  let q = sb.from("audit_logs").select("*", { count: "exact" }).order("created_at", { ascending: false }).range((page - 1) * SIZE, page * SIZE - 1);
  if (entity) q = q.eq("entity", entity);
  const [{ data, count }, { data: profiles }] = await Promise.all([q, sb.from("profiles").select("id,full_name")]);
  const who = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
  const pages = Math.max(1, Math.ceil((count ?? 0) / SIZE));
  const href = (p: number) => `/admin/audit?${new URLSearchParams({ ...(entity ? { entity } : {}), page: String(p) })}`;

  return (
    <>
      <PageHead title="Auditoría" sub="Registro de lo que se crea, edita, cobra, anula o elimina, y quién lo hizo." />
      <form className={u.filters}>
        <label className="sr-only" htmlFor="au-e">Filtrar por módulo</label>
        <select id="au-e" name="entity" defaultValue={entity}>
          <option value="">Todos los módulos</option>
          {Object.entries(ENTITY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <button className={`${u.badge} ${u.sage}`} style={{ minHeight: 42, padding: "0 16px", border: 0 }}>Filtrar</button>
      </form>
      <div className={u.card}>
        {!data?.length ? <EmptyState title="Sin movimientos" /> : (
          <div className={u.tableWrap}>
            <table className={`${u.table} ${u.stack}`}>
              <thead><tr><th>Cuándo</th><th>Quién</th><th>Acción</th><th>Módulo</th><th>Detalle</th></tr></thead>
              <tbody>
                {data.map((r: any) => (
                  <tr key={r.id}>
                    <td data-label="Cuándo">{fmtDateTime(r.created_at)}</td>
                    <td data-label="Quién">{r.user_id ? who.get(r.user_id) ?? "Usuario eliminado" : "Sistema / web"}</td>
                    <td data-label="Acción"><span className={`${u.badge} ${r.action === "delete" || r.action === "void_sale" ? u.red : r.action === "insert" ? u.green : u.gray}`}>{ACTION_LABEL[r.action] ?? r.action}</span></td>
                    <td data-label="Módulo">{ENTITY_LABEL[r.entity] ?? r.entity}</td>
                    <td data-label="Detalle">
                      <div style={{ fontSize: "0.88rem" }}>{summarizeAudit(r.action, r.before_data, r.after_data)}</div>
                      {(r.before_data || r.after_data) && (
                        <details style={{ marginTop: 4 }}>
                          <summary className={u.link} style={{ cursor: "pointer", fontSize: "0.8rem" }}>Ver datos</summary>
                          {r.action === "update" && diffRecords(r.before_data, r.after_data).map((d) => <div key={d.field} className={u.hint}>{d.field}: {d.from} → {d.to}</div>)}
                          <pre style={{ fontSize: "0.7rem", maxWidth: 520, overflow: "auto", background: "#faf7f3", padding: 8, borderRadius: 8 }}>{JSON.stringify(r.after_data ?? r.before_data, null, 1)}</pre>
                        </details>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <nav style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 16 }} aria-label="Paginación">
            {page > 1 && <Link className={u.link} href={href(page - 1)}>← Más recientes</Link>}
            <span className={u.sub}>Página {page} de {pages}</span>
            {page < pages && <Link className={u.link} href={href(page + 1)}>Más antiguos →</Link>}
          </nav>
        )}
      </div>
    </>
  );
}
