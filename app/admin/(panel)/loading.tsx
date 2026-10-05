import { Skeleton } from "@/components/admin/primitives";

export default function Loading() {
  return (
    <div style={{ display: "grid", gap: 16 }} aria-busy="true" aria-label="Cargando">
      <Skeleton h={40} w="min(100%, 280px)" />
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill,minmax(min(100%,200px),1fr))" }}>
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} h={110} />)}
      </div>
      <Skeleton h={260} />
    </div>
  );
}
