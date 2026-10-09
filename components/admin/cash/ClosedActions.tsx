"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { reopenCash } from "@/lib/actions/admin/cash";
import { ExportMenu } from "../ExportMenu";
import { ReasonModal } from "./ReasonModal";
import c from "./cash.module.css";

/** Exportar, imprimir y (gerencia) reabrir el último cierre. */
export function ClosedActions({ sessionId, canReopen }: { sessionId: string; canReopen: boolean }) {
  const [reopen, setReopen] = useState(false);
  return (
    <>
      <span className={c.noprint}><ExportMenu groups={[{ href: `/admin/cash/${sessionId}/export` }]} /></span>
      <Button size="sm" variant="secondary" className={c.noprint} onClick={() => window.print()}>Imprimir</Button>
      {canReopen && <Button size="sm" variant="danger" className={c.noprint} onClick={() => setReopen(true)}>Reabrir cierre</Button>}
      {reopen && (
        <ReasonModal title="Reabrir cierre" confirmLabel="Reabrir caja" danger doneMessage="Caja reabierta" onClose={() => setReopen(false)}
          text="La caja vuelve a quedar abierta con lo que ya tenía y se podrá cerrar de nuevo. Lo cobrado en efectivo mientras estuvo cerrada vuelve a contar. Queda en Auditoría."
          run={(reason) => reopenCash(sessionId, reason)} />
      )}
    </>
  );
}
