import { notFound } from "next/navigation";
import { SupplyDetail } from "@/components/admin/inventory/SupplyDetail";
import { PageHead } from "@/components/admin/primitives";
import { requireAccess } from "@/lib/auth";
import { getSupply, listServicePicks } from "@/lib/data/inventory";
import { plural } from "@/lib/domain/inventory";

export const metadata = { title: "Producto del inventario" };

export default async function SupplyPage({ params }: PageProps<"/admin/inventory/[id]">) {
  await requireAccess("inventory");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [supply, services] = await Promise.all([getSupply(id), listServicePicks()]);
  if (!supply) notFound();
  return (
    <>
      <PageHead title={supply.name} sub={`Inventario · se cuenta en ${plural(supply.unit, 2)}`} />
      <SupplyDetail supply={supply} services={services} />
    </>
  );
}
