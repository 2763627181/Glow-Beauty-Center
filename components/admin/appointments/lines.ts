/** Lógica pura del editor de líneas de una cita (sin React): conversión a/desde el payload de update_appointment. */

export type EditLine = {
  key: string;
  id?: string;                 // línea existente
  service_id?: string | null;  // servicio nuevo (cronometrado)
  variant_id?: string | null;
  name: string;
  employee_id: string | null;
  final_price: number;
  quantity: number;
  timed: boolean;              // true = ocupa horario (servicio); false = producto / concepto libre
  listPrice: number;
};

type SrcLine = {
  id: string; service_id: string | null; variant_id?: string | null; name: string; price: number; final_price: number; quantity: number;
  employee_id: string | null; start_time: string | null;
};

export const linesFromAppt = (services: SrcLine[]): EditLine[] =>
  services.map((s) => ({
    key: s.id, id: s.id, service_id: s.service_id, variant_id: s.variant_id ?? null, name: s.name, employee_id: s.employee_id,
    final_price: s.final_price, quantity: s.quantity, timed: s.start_time != null, listPrice: s.price,
  }));

export const subtotalOf = (lines: Pick<EditLine, "final_price" | "quantity">[]) => lines.reduce((t, l) => t + l.final_price * l.quantity, 0);

/** Payload para update_appointment. Líneas existentes → solo ajustes; nuevas → servicio o concepto libre. */
export function linesToPayload(lines: EditLine[]) {
  return lines.map((l) => {
    if (l.id) return { id: l.id, employee_id: l.employee_id, final_price: l.final_price, quantity: l.quantity };
    if (l.service_id) return { service_id: l.service_id, variant_id: l.variant_id ?? null, employee_id: l.employee_id, final_price: l.final_price, quantity: l.quantity };
    return { name: l.name.trim(), employee_id: l.employee_id, final_price: l.final_price, quantity: l.quantity };
  });
}

/** Especialistas que pueden hacer un servicio: los vinculados, o todos los activos si no hay vínculos. */
export function eligibleStaff(serviceId: string | null | undefined, staff: { id: string; full_name: string; active: boolean }[], links: { employee_id: string; service_id: string }[]) {
  const active = staff.filter((s) => s.active);
  if (!serviceId) return active;
  const linked = links.filter((l) => l.service_id === serviceId).map((l) => l.employee_id);
  return linked.length ? active.filter((s) => linked.includes(s.id)) : active;
}

/** Para el selector de especialista: las que tienen el servicio marcado y, aparte, el resto de las activas (el personal puede asignar a cualquiera). */
export function staffChoices(serviceId: string | null | undefined, staff: { id: string; full_name: string; active: boolean }[], links: { employee_id: string; service_id: string }[]) {
  const usual = eligibleStaff(serviceId, staff, links);
  const ids = new Set(usual.map((s) => s.id));
  return { usual, others: staff.filter((s) => s.active && !ids.has(s.id)) };
}

export const newKey = () => Math.random().toString(36).slice(2, 10);

/** Valida antes de enviar (el servidor valida de nuevo). Devuelve el primer problema o null. */
export function validateLines(lines: EditLine[]): string | null {
  if (!lines.length) return "La cita debe tener al menos un servicio.";
  if (!lines.some((l) => l.timed)) return "Debe quedar al menos un servicio con horario.";
  for (const l of lines) {
    if (!l.name.trim()) return "Todos los artículos necesitan un nombre.";
    if (!(l.quantity >= 1)) return `Revisa la cantidad de “${l.name}”.`;
    if (!(l.final_price >= 0)) return `El precio de “${l.name}” no puede ser negativo.`;
  }
  return null;
}
