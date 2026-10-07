/** Aviso (no bloqueante) cuando una cita coincide con otras de la misma especialista. Funciones puras. */

export type TimedLine = { employeeId: string | null; minutes: number };
export type LineSpan = { employeeId: string; start: number; end: number }; // ms

/** Tramo de cada línea: se agendan en el orden recibido, una tras otra, desde `startMs` (igual que en la base de datos). */
export function lineSpans(startMs: number, lines: TimedLine[]): LineSpan[] {
  const out: LineSpan[] = [];
  let t = startMs;
  for (const l of lines) {
    const minutes = Math.max(0, l.minutes);
    if (l.employeeId && minutes > 0) out.push({ employeeId: l.employeeId, start: t, end: t + minutes * 60_000 });
    t += minutes * 60_000;
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
