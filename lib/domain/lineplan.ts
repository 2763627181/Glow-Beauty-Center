/**
 * Convierte lo que eligió la clienta (servicios, especialistas por servicio y «al mismo tiempo») en las líneas que entiende
 * el motor de disponibilidad, y devuelve el resultado ya asignado como líneas de la cita. Puro, sin I/O.
 *
 * - Un servicio sin especialistas elegidas se asigna a cualquiera que lo haga y esté libre (una sola línea).
 * - Un servicio con VARIAS especialistas elegidas es un EQUIPO: todas lo atienden a la vez, una línea por especialista.
 * - «Al mismo tiempo»: cada servicio empieza junto con el anterior (si hay especialistas libres).
 */
import type { Assignment, LineReq } from "./availability.ts";

export type PlanItem = { serviceId: string; name: string; minutes: number; employeeIds: string[] };
export type PlanLine = { itemIndex: number; teamKey: string | null };
export type PlanInput = {
  items: PlanItem[];
  /** Especialistas activas y visibles en la reserva en línea. */
  online: string[];
  /** Por servicio, las especialistas que lo tienen marcado (sin ninguna marcada lo puede hacer cualquiera). */
  linked: Record<string, string[]>;
  /** Una sola especialista para todo (formato anterior de la solicitud). */
  legacyEmployeeId?: string;
  parallel: boolean;
  nameOf?: (employeeId: string) => string;
};
export type PlanResult = { lines: LineReq[]; plan: PlanLine[]; error?: string };

export function buildLinePlan(input: PlanInput): PlanResult {
  const lines: LineReq[] = [];
  const plan: PlanLine[] = [];
  for (const [k, item] of input.items.entries()) {
    const links = input.linked[item.serviceId] ?? [];
    const eligible = links.length ? input.online.filter((id) => links.includes(id)) : input.online;
    const asked = [...new Set(item.employeeIds.length ? item.employeeIds : input.legacyEmployeeId && input.legacyEmployeeId !== "any" ? [input.legacyEmployeeId] : [])];
    if (asked.length) {
      const bad = asked.find((id) => !eligible.includes(id));
      if (bad) {
        return { lines: [], plan: [], error: input.legacyEmployeeId && !item.employeeIds.length ? "Esa especialista no realiza todos los servicios elegidos." : `${input.nameOf?.(bad) ?? "Esa especialista"} no realiza «${item.name}» o no está disponible en línea.` };
      }
      asked.forEach((id, j) => {
        lines.push({ minutes: item.minutes, eligible: [id], parallel: j > 0 || (k > 0 && input.parallel) });
        plan.push({ itemIndex: k, teamKey: asked.length > 1 ? `t${k}` : null });
      });
    } else {
      if (!eligible.length) return { lines: [], plan: [], error: `Por ahora no hay una especialista disponible para «${item.name}». Escríbenos por WhatsApp y te ayudamos a agendar.` };
      lines.push({ minutes: item.minutes, eligible, parallel: k > 0 && input.parallel });
      plan.push({ itemIndex: k, teamKey: null });
    }
  }
  return { lines, plan };
}

export type BookingService = { service_id: string; variant_id: string | null; addon_ids: string[]; employee_id: string; parallel: boolean; team: string | null };

/** Líneas de la cita en el orden agendado: las que empiezan a la vez van seguidas y llevan `parallel` (menos la primera del bloque). */
export function servicesFromAssignments(
  assignments: Assignment[], plan: PlanLine[], items: { serviceId: string; variantId?: string | null; addonIds: string[] }[],
): BookingService[] {
  const sorted = [...assignments].sort((a, b) => a.start - b.start || a.lineIndex - b.lineIndex);
  return sorted.map((a, idx) => {
    const p = plan[a.lineIndex];
    const it = items[p.itemIndex];
    return {
      service_id: it.serviceId, variant_id: it.variantId ?? null, addon_ids: it.addonIds, employee_id: a.employeeId,
      parallel: idx > 0 && a.start === sorted[idx - 1].start, team: p.teamKey,
    };
  });
}
