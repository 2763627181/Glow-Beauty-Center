import { InventoryBoard } from "@/components/admin/inventory/InventoryBoard";
import { EmptyState, PageHead } from "@/components/admin/primitives";
import u from "@/components/admin/ui.module.css";
import { requireAccess } from "@/lib/auth";
import { inventoryInstalled, listServicePicks, listSupplies } from "@/lib/data/inventory";

export const metadata = { title: "Inventario" };

export default async function InventoryPage() {
  await requireAccess("inventory");
  if (!(await inventoryInstalled())) {
    return (
      <>
        <PageHead title="Inventario" />
        <section className={u.card}>
          <EmptyState title="Falta instalar la actualización del Inventario" text="La base de datos todavía no tiene las tablas del inventario. Se instala una sola vez (archivo 20261014000019_inventario.sql en supabase/migrations) y no borra nada." />
        </section>
      </>
    );
  }
  const [supplies, services] = await Promise.all([listSupplies(), listServicePicks()]);
  return (
    <>
      <PageHead title="Inventario" sub="Productos que se usan en los servicios (shampoo, gel, pintura…): cuándo llegaron, cuándo se agotaron y cuánto se consumió por cliente." />
      <InventoryBoard supplies={supplies} services={services} />
    </>
  );
}
