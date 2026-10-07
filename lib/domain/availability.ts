/**
 * Motor de disponibilidad (puro, sin I/O). Todas las horas se calculan en hora de
 * Santo Domingo (UTC-4, sin horario de verano).
 *
 * Una reserva son varias LÍNEAS (servicios) que se agendan en secuencia. Cada línea
 * puede hacerla un especialista distinto, así un combo (uñas con Ana + cabello con
 * Carla) siempre encuentra horario si cada tramo tiene a alguien libre.
 */

export type Interval = { start: number; end: number }; // epoch ms

export type EmployeeDay = {
  employeeId: string;
  /** Jornada del especialista ese día (HH:mm). null = no trabaja. */
  work: { start: string; end: string; breakStart?: string | null; breakEnd?: string | null } | null;
  /** Bloqueos propios y ausencias: nadie puede agendarse encima. */
  busy: Interval[];
  /** Líneas de otras citas: pueden coincidir hasta el tope `maxConcurrent` (citas al mismo tiempo). */
  booked?: Interval[];
};

export type LineReq = {
  /** Minutos que ocupa la línea (duración + preparación + tiempo posterior). */
  minutes: number;
  /** Especialistas que pueden hacerla (ya filtrados por la elección del cliente). */
  eligible: string[];
};

export type SlotInput = {
  date: string; // YYYY-MM-DD
  businessHours: { open: string; close: string } | null;
  /** Bloqueos que afectan a todo el negocio (feriados, etc.). */
  businessBlocks: Interval[];
  employees: EmployeeDay[];
  lines: LineReq[];
  slotMinutes: number;
  now: number;
  minNoticeHours: number;
  /** Citas que una especialista puede tener al mismo tiempo (1 = una a la vez; 0 = sin límite). Por defecto 1. */
  maxConcurrent?: number;
};

export type Assignment = { lineIndex: number; employeeId: string; start: number; end: number };
export type Slot = { time: string; start: string; assignments: Assignment[] };

const MIN = 60_000;
const toMs = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00-04:00`).getTime();
const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

/** Máximo de intervalos que coinciden en un mismo instante dentro de [a, b). Los extremos son semiabiertos: terminar a las 10:00 no choca con empezar a las 10:00. */
export function maxDepth(list: Interval[], a: number, b: number): number {
  const ev: [number, number][] = [];
  for (const x of list) {
    if (x.end <= x.start || x.end <= a || x.start >= b) continue;
    ev.push([Math.max(x.start, a), 1], [Math.min(x.end, b), -1]);
  }
  ev.sort((p, q) => p[0] - q[0] || p[1] - q[1]); // al empatar, primero terminan y luego empiezan
  let cur = 0, max = 0;
  for (const [, d] of ev) { cur += d; if (cur > max) max = cur; }
  return max;
}
const pad = (n: number) => String(n).padStart(2, "0");

/** Permutaciones de índices; la primera siempre es el orden original. Se limita a 4 líneas (24 órdenes). */
function orders(n: number): number[][] {
  const idx = Array.from({ length: n }, (_, i) => i);
  if (n > 4) return [idx];
  const out: number[][] = [];
  const rec = (rest: number[], cur: number[]) => {
    if (!rest.length) { out.push(cur); return; }
    for (let i = 0; i < rest.length; i++) rec([...rest.slice(0, i), ...rest.slice(i + 1)], [...cur, rest[i]]);
  };
  rec(idx, []);
  return out;
}

export function computeSlots(input: SlotInput): Slot[] {
  const { date, businessHours, employees, lines, slotMinutes, now, minNoticeHours } = input;
  const maxConcurrent = input.maxConcurrent === 0 ? Infinity : Math.max(1, Math.floor(input.maxConcurrent ?? 1));
  if (!businessHours || !lines.length || slotMinutes <= 0 || lines.some((l) => l.minutes <= 0)) return [];

  const open = toMs(date, businessHours.open);
  const close = toMs(date, businessHours.close);
  const earliest = now + minNoticeHours * 60 * 60_000;
  const total = lines.reduce((t, l) => t + l.minutes, 0) * MIN;
  const step = slotMinutes * MIN;
  const byId = new Map(employees.map((e) => [e.employeeId, e]));

  // Ventana de trabajo y bloqueos fijos por especialista
  const fixed = new Map<string, { from: number; to: number; busy: Interval[]; booked: Interval[]; load: number }>();
  for (const e of employees) {
    if (!e.work) continue;
    const busy: Interval[] = [...e.busy, ...input.businessBlocks];
    if (e.work.breakStart && e.work.breakEnd) busy.push({ start: toMs(date, e.work.breakStart), end: toMs(date, e.work.breakEnd) });
    fixed.set(e.employeeId, {
      from: Math.max(open, toMs(date, e.work.start)), to: Math.min(close, toMs(date, e.work.end)), busy, booked: e.booked ?? [],
      load: [...e.busy, ...(e.booked ?? [])].reduce((t, b) => t + Math.max(0, b.end - b.start), 0),
    });
  }

  const orderList = orders(lines.length);
  const out: Slot[] = [];

  for (let t = open; t + total <= close; t += step) {
    if (t < earliest) continue;
    let found: Assignment[] | null = null;

    for (const order of orderList) {
      const taken = new Map<string, Interval[]>(); // intervalos que esta misma reserva ya ocupa por especialista
      const free = (id: string, a: number, b: number) => {
        const f = fixed.get(id);
        if (!f || a < f.from || b > f.to) return false;
        const iv = { start: a, end: b };
        if (f.busy.some((x) => overlaps(iv, x)) || (taken.get(id) ?? []).some((x) => overlaps(iv, x))) return false;
        return maxDepth(f.booked, a, b) < maxConcurrent;
      };
      const solve = (pos: number, at: number, prev: string | null): Assignment[] | null => {
        if (pos === order.length) return [];
        const li = order[pos];
        const end = at + lines[li].minutes * MIN;
        const cands = lines[li].eligible.filter((id) => byId.has(id) && free(id, at, end));
        // Continuidad con el especialista anterior; luego reparto de carga (menos ocupado primero)
        cands.sort((x, y) => (x === prev ? -1 : y === prev ? 1 : (fixed.get(x)!.load - fixed.get(y)!.load)));
        for (const id of cands) {
          taken.set(id, [...(taken.get(id) ?? []), { start: at, end }]);
          const rest = solve(pos + 1, end, id);
          if (rest) return [{ lineIndex: li, employeeId: id, start: at, end }, ...rest];
          taken.set(id, (taken.get(id) ?? []).slice(0, -1));
        }
        return null;
      };
      found = solve(0, t, null);
      if (found) break;
    }

    if (found) {
      const local = new Date(t - 4 * 3_600_000); // hora local DR = UTC-4
      out.push({ time: `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`, start: new Date(t).toISOString(), assignments: found });
    }
  }
  return out;
}

/** Día de la semana (0 = domingo) de una fecha YYYY-MM-DD. */
export function weekdayOf(date: string) {
  return new Date(`${date}T12:00:00-04:00`).getUTCDay();
}
