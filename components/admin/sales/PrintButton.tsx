"use client";

import { Button } from "@/components/ui/Button";

export function PrintButton() {
  return <Button size="sm" variant="secondary" onClick={() => window.print()}>Imprimir recibo</Button>;
}
