import { CategoriesManager, ProductsManager } from "@/components/admin/services/CatalogManagers";
import { PageHead } from "@/components/admin/primitives";
import { ServiceRow } from "@/components/admin/services/ServiceRow";
import { TabNav } from "@/components/admin/TabNav";
import u from "@/components/admin/ui.module.css";
import { ButtonLink } from "@/components/ui/Button";
import { requireAccess } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Servicios" };
/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function ServicesAdmin({ searchParams }: PageProps<"/admin/services">) {
  await requireAccess("services");
  const sp = await searchParams;
  const tab = ["servicios", "categorias", "productos"].includes(String(sp.tab)) ? String(sp.tab) : "servicios";
  const sb = await createClient();
  const [{ data: cats }, { data: svcs }, { data: prods }] = await Promise.all([
    sb.from("service_categories").select("*").order("display_order"),
    sb.from("services").select("id,name,price,price_from,duration_minutes,active,featured,pending_review,category_id,display_order,service_variants(id)").order("display_order"),
    sb.from("products").select("*").order("display_order").order("name"),
  ]);
  return (
    <>
      <PageHead title="Servicios" sub="Precios, duraciones, categorías y productos. Todo lo que ve el cliente sale de aquí.">
        {tab === "servicios" && <ButtonLink size="sm" href="/admin/services/new">+ Nuevo servicio</ButtonLink>}
      </PageHead>
      <TabNav base="/admin/services" current={tab} tabs={[{ key: "servicios", label: `Servicios (${svcs?.length ?? 0})` }, { key: "categorias", label: `Categorías (${cats?.length ?? 0})` }, { key: "productos", label: `Productos (${prods?.length ?? 0})` }]} />

      {tab === "servicios" && (
        <div className={u.grid}>
          {(cats ?? []).map((c: any) => {
            const list = (svcs ?? []).filter((s: any) => s.category_id === c.id);
            return (
              <section key={c.id} className={u.card}>
                <h2>{c.name}{!c.active && <span className={`${u.badge} ${u.gray}`} style={{ marginLeft: 8 }}>Categoría oculta</span>}</h2>
                {list.length === 0 ? <p className={u.sub}>Sin servicios en esta categoría.</p> : (
                  <div className={u.tableWrap}>
                    <table className={`${u.table} ${u.stack}`}>
                      <thead><tr><th>Servicio</th><th className={u.num}>Precio</th><th>Duración</th><th>Estado</th><th><span className="sr-only">Acciones</span></th></tr></thead>
                      <tbody>{list.map((s: any) => <ServiceRow key={s.id} s={{ ...s, price: Number(s.price), variants: s.service_variants.length }} />)}</tbody>
                    </table>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
      {tab === "categorias" && (
        <CategoriesManager categories={(cats ?? []).map((c: any) => ({ id: c.id, name: c.name, description: c.description, image_url: c.image_url, active: c.active, count: (svcs ?? []).filter((s: any) => s.category_id === c.id).length }))} />
      )}
      {tab === "productos" && <ProductsManager products={(prods ?? []).map((p: any) => ({ id: p.id, name: p.name, price: Number(p.price), active: p.active }))} />}
    </>
  );
}
