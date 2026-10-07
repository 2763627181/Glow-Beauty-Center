/**
 * Un servicio atendido por varias especialistas (un equipo) se guarda como varias líneas de la cita, una por especialista,
 * todas con el mismo `team_id`. Para MOSTRAR (listas, ficha de la cita, WhatsApp, Google Calendar, exportaciones) se juntan
 * de nuevo en un solo servicio. Puro, sin I/O.
 */
export type LineLike = {
  id?: string;
  name: string;
  final_price?: number;
  quantity?: number;
  team_id?: string | null;
  employee_name?: string | null;
  start_time?: string | null;
  end_time?: string | null;
};
export type LineGroup<T extends LineLike> = {
  key: string;
  name: string;
  /** Precio de una unidad del servicio completo (suma de las partes de cada especialista). */
  price: number;
  quantity: number;
  /** Especialistas del servicio, sin repetir y en el orden de la cita. */
  employees: string[];
  lines: T[];
};

export function groupLines<T extends LineLike>(lines: T[]): LineGroup<T>[] {
  const groups: LineGroup<T>[] = [];
  const byTeam = new Map<string, LineGroup<T>>();
  lines.forEach((l, i) => {
    const existing = l.team_id ? byTeam.get(l.team_id) : undefined;
    if (existing) {
      existing.price += l.final_price ?? 0;
      existing.lines.push(l);
      if (l.employee_name && !existing.employees.includes(l.employee_name)) existing.employees.push(l.employee_name);
      return;
    }
    const g: LineGroup<T> = {
      key: l.team_id ?? l.id ?? String(i), name: l.name, price: l.final_price ?? 0, quantity: l.quantity ?? 1,
      employees: l.employee_name ? [l.employee_name] : [], lines: [l],
    };
    groups.push(g);
    if (l.team_id) byTeam.set(l.team_id, g);
  });
  return groups;
}

/** Nombres de los servicios, uno por servicio aunque lo atienda un equipo. */
export const serviceNames = (lines: LineLike[]): string[] => groupLines(lines).map((g) => g.name);

/** Descripciones de artículos de una venta sin repetir el servicio que atendió un equipo. */
export function uniqueDescriptions(items: { description: string; team_id?: string | null }[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const i of items) {
    if (i.team_id) { if (seen.has(i.team_id)) continue; seen.add(i.team_id); }
    out.push(i.description);
  }
  return out;
}
