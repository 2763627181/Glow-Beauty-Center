"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/admin/primitives";

export default function PanelError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <EmptyState title="No se pudo cargar esta pantalla" text={`Revisa tu conexión e inténtalo de nuevo.${error.digest ? ` (código ${error.digest})` : ""}`}>
      <div><Button onClick={reset}>Reintentar</Button></div>
    </EmptyState>
  );
}
