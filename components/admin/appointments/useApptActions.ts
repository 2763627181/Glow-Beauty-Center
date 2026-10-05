"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { rescheduleAppointment, setAppointmentStatus } from "@/lib/actions/admin/appointments";
import type { ApptRow } from "@/lib/data/appointments";
import { apptTotal } from "@/lib/data/appointment-math";
import { renderTemplate, type WaTemplates } from "@/lib/domain/whatsappTemplates";
import { fmtDate, fmtTime, money, TZ } from "@/lib/format";
import { waLink } from "@/lib/whatsapp";
import type { AppointmentStatus } from "@/types/domain";
import { useToast } from "../overlay";

/** Siguiente paso lógico del flujo según el estado actual. */
export const NEXT_STEP: Partial<Record<AppointmentStatus, { to: AppointmentStatus; label: string }>> = {
  solicitud: { to: "contactando", label: "Contactando" },
  contactando: { to: "contactado", label: "Marcar contactado" },
  contactado: { to: "confirmado", label: "Confirmar" },
  confirmado: { to: "en_espera", label: "Cliente llegó" },
  en_espera: { to: "en_servicio", label: "Comenzar servicio" },
};

export const CLOSED: AppointmentStatus[] = ["completado", "cancelado", "no_asistio"];

/** ¿Puede este rol mover la cita de un estado a otro? (la BD lo impone de todos modos) */
export function canMove(role: string, ownsAppointment: boolean, from: AppointmentStatus, to: AppointmentStatus) {
  if (from === to) return false;
  if (role !== "specialist") return true;
  return ownsAppointment && ((["confirmado", "en_espera"].includes(from) && to === "en_servicio") || (from === "en_servicio" && to === "completado"));
}

export type WaKind = keyof WaTemplates;
export const WA_KIND_LABEL: Record<WaKind, string> = { confirm: "Confirmación", reminder: "Recordatorio", generic: "Mensaje libre" };

export function waVars(a: ApptRow, businessName: string): Record<string, string> {
  return {
    nombre: a.client.first_name,
    servicios: a.services.map((s) => s.name).join(", "),
    fecha: fmtDate(a.start_time, { weekday: "long", day: "numeric", month: "long" }),
    hora: fmtTime(a.start_time),
    total: money(apptTotal(a)),
    negocio: businessName,
  };
}

export function clientWaLink(a: ApptRow, templates: WaTemplates, businessName: string, kind: WaKind = "confirm") {
  return waLink(a.client.phone, renderTemplate(templates[kind], waVars(a, businessName)));
}

export function useApptActions(onChanged?: () => void) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const refresh = () => { router.refresh(); onChanged?.(); };

  return {
    pending,
    setStatus(id: string, status: AppointmentStatus, okMsg?: string) {
      start(async () => {
        const r = await setAppointmentStatus(id, status);
        if (r.ok) { toast(okMsg ?? "Estado actualizado"); refresh(); } else toast(r.error, "err");
      });
    },
    reschedule(id: string, startISO: string, employeeId: string | null) {
      start(async () => {
        const r = await rescheduleAppointment(id, startISO, employeeId);
        if (r.ok) { toast("Cita reprogramada"); refresh(); } else toast(r.error, "err");
      });
    },
    refresh,
  };
}

/** ISO → "YYYY-MM-DDTHH:mm" en hora de Santo Domingo (para <input type=datetime-local>). */
export const toLocalInput = (iso: string) => new Date(iso).toLocaleString("sv-SE", { timeZone: TZ }).replace(" ", "T").slice(0, 16);
/** "YYYY-MM-DDTHH:mm" (hora SD) → ISO UTC. */
export const fromLocalInput = (v: string) => new Date(`${v}:00-04:00`).toISOString();
