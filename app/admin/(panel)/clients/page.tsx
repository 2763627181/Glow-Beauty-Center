import Link from "next/link";
import { Suspense } from "react";
import { ClientForm } from "@/components/admin/clients/ClientTools";
import { EmptyState, PageHead } from "@/components/admin/primitives";
import u from "@/components/admin/ui.module.css";
import { UrlSearch } from "@/components/admin/UrlSearch";
import { requireAccess } from "@/lib/auth";
import { allowed, can } from "@/lib/permissions";
import { listClients, PAGE_SIZE } from "@/lib/data/clients";
import { fmtDate, money } from "@/lib/format";

export const metadata = { title: "Clientes" };

export default async function ClientsPage({ searchParams }: PageProps<"/admin/clients">) {
  const s = await requireAccess("clients");
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const page = Math.max(1, Number(sp.page) || 1);
  const { rows, total } = await listClients(q, page);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const link = (p: number) => `/admin/clients?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) })}`;

  return (
    <>
      <PageHead title="Clientes" sub={`${total} en total`}>{can(s.role, "reports") && (<a className={u.link} href="/admin/clients/export" download>Exportar CSV</a>)}{allowed(s.role, "manageClients") && <ClientForm label="+ Nuevo cliente" />}</PageHead>
      <Suspense><UrlSearch placeholder="Buscar por nombre, teléfono o correo" label="Buscar clientes" /></Suspense>
      <div className={u.card} style={{ marginTop: 16 }}>
        {rows.length === 0 ? <EmptyState title="Sin resultados" text={q ? "Prueba con otro nombre o teléfono." : "Aún no hay clientes."} /> : (
          <div className={u.tableWrap}>
            <table className={`${u.table} ${u.stack}`}>
              <thead><tr><th>Cliente</th><th>WhatsApp</th><th>Correo</th><th>Última visita</th><th>Próxima cita</th><th className={u.num}>Visitas</th>{allowed(s.role, "seeMoney") && <th className={u.num}>Total gastado</th>}<th>Estado</th></tr></thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td data-label="Cliente"><Link className={u.link} href={`/admin/clients/${c.id}`}><strong>{c.first_name} {c.last_name}</strong></Link></td>
                    <td data-label="WhatsApp">{c.phone}</td>
                    <td data-label="Correo">{c.email ?? "—"}</td>
                    <td data-label="Última visita">{c.last_visit ? fmtDate(c.last_visit, { day: "numeric", month: "short", year: "numeric" }) : "—"}</td>
                    <td data-label="Próxima cita">{c.next_appointment ? fmtDate(c.next_appointment, { day: "numeric", month: "short" }) : "—"}</td>
                    <td data-label="Visitas" className={u.num}>{c.visits}</td>
                    {allowed(s.role, "seeMoney") && <td data-label="Total gastado" className={u.num}>{money(c.total_spent)}</td>}
                    <td data-label="Estado"><span className={`${u.badge} ${c.active ? u.green : u.gray}`}>{c.active ? "Activo" : "Inactivo"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <nav style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 16 }} aria-label="Paginación">
            {page > 1 && <Link className={u.link} href={link(page - 1)}>← Anterior</Link>}
            <span className={u.sub}>Página {page} de {pages}</span>
            {page < pages && <Link className={u.link} href={link(page + 1)}>Siguiente →</Link>}
          </nav>
        )}
      </div>
    </>
  );
}
