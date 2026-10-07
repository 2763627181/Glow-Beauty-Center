"use client";

import { useEffect, useState } from "react";
import { previewOverlaps } from "@/lib/actions/admin/appointments";
import type { OverlapHint, TimedLine } from "@/lib/domain/overlap";
import { fmtTime } from "@/lib/format";
import { Alert } from "../primitives";

/**
 * Consulta (con una pequeña espera mientras se escribe) si la especialista ya tiene citas a esa hora.
 * Es solo un aviso: la cita se puede guardar igual.
 */
export function useOverlapHints(start: string | null, lines: TimedLine[], ignoreAppointmentId?: string): OverlapHint[] {
  const key = JSON.stringify([start, lines, ignoreAppointmentId ?? null]);
  // El resultado se guarda junto a la consulta que lo produjo: si la consulta cambia, el aviso viejo desaparece al instante.
  const [found, setFound] = useState<{ key: string; hints: OverlapHint[] }>({ key: "", hints: [] });
  useEffect(() => {
    const [s, l, ignore] = JSON.parse(key) as [string | null, TimedLine[], string | null];
    if (!s || !l.some((x) => x.employeeId)) return;
    let cancelled = false;
    const t = setTimeout(() => {
      previewOverlaps({ start: s, lines: l, ignoreAppointmentId: ignore ?? undefined })
        .then((h) => { if (!cancelled) setFound({ key, hints: h }); })
        .catch(() => { if (!cancelled) setFound({ key, hints: [] }); });
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [key]);
  return found.key === key ? found.hints : [];
}

const span = (o: { start: string; end: string }) => `${fmtTime(o.start)} – ${fmtTime(o.end)}`;

export function OverlapNotice({ hints }: { hints: OverlapHint[] }) {
  if (!hints.length) return null;
  return (
    <>
      {hints.map((h) => (
        <Alert key={h.employeeId} kind="warn">
          <strong>{h.employee}</strong> ya tiene {h.others.length === 1 ? "otra cita" : `${h.others.length} citas`} a esa hora
          ({h.others.slice(0, 3).map((o) => `${o.client}, ${span(o)}`).join("; ")}{h.others.length > 3 ? `; y ${h.others.length - 3} más` : ""}).
          {" "}Se agendará igual.
        </Alert>
      ))}
    </>
  );
}
