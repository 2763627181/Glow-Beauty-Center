"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { syncUpcomingToCalendar } from "@/lib/actions/admin/integrations";
import { useToast } from "../overlay";

export function CalendarSync() {
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  return (
    <Button size="sm" variant="secondary" disabled={pending} onClick={() => start(async () => {
      const r = await syncUpcomingToCalendar();
      if (!r.ok) return toast(r.error, "err");
      toast(`${r.synced} cita(s) enviada(s) al calendario${r.failed ? ` · ${r.failed} con error` : ""}`, r.failed ? "err" : "ok");
      router.refresh();
    })}>{pending ? "Sincronizando…" : "Enviar citas pendientes a Google Calendar"}</Button>
  );
}
