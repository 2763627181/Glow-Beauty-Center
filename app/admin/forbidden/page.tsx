import Link from "next/link";
import { EmptyState } from "@/components/admin/primitives";

export default function Forbidden() {
  return (
    <main style={{ minHeight: "100svh", display: "grid", placeItems: "center", padding: 20 }}>
      <EmptyState title="Sin permiso" text="Tu rol no tiene acceso a esta sección.">
        <Link href="/admin" style={{ textDecoration: "underline" }}>Volver al panel</Link>
      </EmptyState>
    </main>
  );
}
