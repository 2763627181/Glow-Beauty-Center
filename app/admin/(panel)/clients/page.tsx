import Link from "next/link";
import { Suspense } from "react";
import { ClientForm } from "@/components/admin/clients/ClientTools";
import { ClientsTable } from "@/components/admin/clients/ClientsTable";
import { ExportMenu } from "@/components/admin/ExportMenu";
import { EmptyState, PageHead } from "@/components/admin/primitives";
import u from "@/components/admin/ui.module.css";
import { UrlSearch } from "@/components/admin/UrlSearch";
import { requireAccess } from "@/lib/auth";
import { allowed, can } from "@/lib/permissions";
import { listClients, PAGE_SIZE } from "@/lib/data/clients";

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
      <PageHead title="Clientes" sub={`${total} en total`}>{can(s.role, "reports") && <ExportMenu groups={[{ href: "/admin/clients/export" }]} />}{allowed(s.role, "manageClients") && <ClientForm label="+ Nuevo cliente" />}</PageHead>
      <Suspense><UrlSearch placeholder="Buscar por nombre, teléfono o correo" label="Buscar clientes" /></Suspense>
      <div className={u.card} style={{ marginTop: 16 }}>
        {rows.length === 0 ? <EmptyState title="Sin resultados" text={q ? "Prueba con otro nombre o teléfono." : "Aún no hay clientes."} /> : (
          <ClientsTable showMoney={allowed(s.role, "seeMoney")} canDelete={allowed(s.role, "deleteRecords")} rows={rows.map((c) => ({
            id: c.id, first_name: c.first_name, last_name: c.last_name, phone: c.phone, email: c.email, last_visit: c.last_visit, next_appointment: c.next_appointment,
            visits: c.visits, total_spent: Number(c.total_spent), active: c.active,
          }))} />
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
