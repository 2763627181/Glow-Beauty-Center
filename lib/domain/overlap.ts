/** Aviso (no bloqueante) cuando una cita coincide con otras de la misma especialista. Funciones puras. */

export type TimedLine = { employeeId: string | null; minutes: number; /** empieza junto con la línea anterior */ parallel?: boolean };
export type LineSpan = { employeeId: string; start: number; end: number }; // ms

/**
 * Tramo de cada línea, igual que lo calcula la base de datos: en el orden recibido, una tras otra desde `startMs`; una línea
 * «al mismo tiempo» empieza junto con la anterior y el bloque dura lo que dure su línea más larga.
 */
export function lineSpans(startMs: number, lines: TimedLine[]): LineSpan[] {
  const out: LineSpan[] = [];
  let bStart = startMs, bEnd = startMs, first = true;
  for (const l of lines) {
    const ms = Math.max(0, l.minutes) * 60_000;
    let s: number;
    if (first) { s = startMs; bStart = s; bEnd = s + ms; first = false; }
    else if (l.parallel) { s = bStart; bEnd = Math.max(bEnd, s + ms); }
    else { s = bEnd; bStart = s; bEnd = s + ms; }
    if (l.employeeId && ms > 0) out.push({ employeeId: l.employeeId, start: s, end: s + ms });
  }
  return out;
}

export type ExistingLine = { employeeId: string; start: number; end: number; client: string; appointmentId: string };
export type OverlapHint = { employeeId: string; employee: string; others: { client: string; start: string; end: string }[] };

/** Citas ya agendadas que coinciden con alguno de los tramos, agrupadas por especialista. */
export function findOverlaps(mine: LineSpan[], existing: ExistingLine[], names: Map<string, string>, ignoreAppointmentId?: string): OverlapHint[] {
  const byEmp = new Map<string, OverlapHint>();
  const seen = new Set<string>();
  for (const e of existing) {
    if (e.appointmentId === ignoreAppointmentId) continue;
    if (!mine.some((m) => m.employeeId === e.employeeId && m.start < e.end && e.start < m.end)) continue;
    const key = `${e.employeeId}|${e.appointmentId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const hint = byEmp.get(e.employeeId) ?? { employeeId: e.employeeId, employee: names.get(e.employeeId) ?? "La especialista", others: [] };
    hint.others.push({ client: e.client, start: new Date(e.start).toISOString(), end: new Date(e.end).toISOString() });
    byEmp.set(e.employeeId, hint);
  }
  return [...byEmp.values()];
}
