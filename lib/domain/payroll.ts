/**
 * Nómina de pago de las especialistas (puro, sin I/O).
 * Comisión = Σ (total de la línea × % de comisión), con la misma regla que el reporte de comisiones: el % de la línea y,
 * si no tiene, el de la especialista. Las propinas de cada venta se reparten entre quienes la atendieron.
 */
import type { SaleIn } from "./reports.ts";

export type DetailRow = { date: string; sale: string; description: string; total: number; pct: number; commission: number };
export type PayrollCalc = { employeeId: string; servicesCount: number; salesTotal: number; commission: number; tips: number; detail: DetailRow[] };
export type PayrollOpts = {
  /** Comisión % por especialista (se usa si la línea de la venta no trae la suya). */
  employeeCommission: Record<string, number>;
  /** Solo ventas cobradas por completo (si no, también las pendientes y con pago parcial). Las reembolsadas nunca cuentan. */
  onlyPaid: boolean;
  includeTips: boolean;
};

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Una venta cuenta para la nómina si no fue reembolsada y, según la opción, está cobrada por completo. */
export const countsForPayroll = (s: Pick<SaleIn, "payment_status">, onlyPaid: boolean) =>
  s.payment_status !== "reembolsado" && (!onlyPaid || s.payment_status === "pagado");

/** Calcula, por especialista, lo que generó en las ventas dadas. Devuelve una entrada por cada especialista con actividad. */
export function computePayroll(sales: SaleIn[], opts: PayrollOpts): Map<string, PayrollCalc> {
  const out = new Map<string, PayrollCalc>();
  const get = (id: string) => {
    let c = out.get(id);
    if (!c) { c = { employeeId: id, servicesCount: 0, salesTotal: 0, commission: 0, tips: 0, detail: [] }; out.set(id, c); }
    return c;
  };
  for (const s of [...sales].sort((a, b) => a.completed_at.localeCompare(b.completed_at) || a.sale_number.localeCompare(b.sale_number))) {
    if (!countsForPayroll(s, opts.onlyPaid)) continue;
    const weight = new Map<string, number>(); // lo vendido por cada especialista en esta venta (para repartir la propina)
    for (const i of s.items) {
      const emp = i.employee_id ?? s.employee_id;
      if (!emp) continue;
      const pct = i.commission_pct ?? opts.employeeCommission[emp] ?? 0;
      const c = get(emp);
      const commission = (i.total * pct) / 100;
      c.servicesCount += 1; c.salesTotal += i.total; c.commission += commission;
      c.detail.push({ date: s.completed_at, sale: s.sale_number, description: i.description, total: round2(i.total), pct, commission: round2(commission) });
      weight.set(emp, (weight.get(emp) ?? 0) + i.total);
    }
    if (opts.includeTips && s.tip > 0) {
      const sum = [...weight.values()].reduce((t, w) => t + w, 0);
      if (sum > 0) for (const [emp, w] of weight) get(emp).tips += (s.tip * w) / sum;
      else if (s.employee_id) get(s.employee_id).tips += s.tip; // venta sin artículos con especialista: la propina es de quien la atendió
    }
  }
  for (const c of out.values()) { c.salesTotal = round2(c.salesTotal); c.commission = round2(c.commission); c.tips = round2(c.tips); }
  return out;
}

/** Neto = sueldo base + comisión + propinas + bonos − descuentos. */
export const netOf = (l: { base_salary: number; commission: number; tips: number; bonus: number; deductions: number }) =>
  round2(l.base_salary + l.commission + l.tips + l.bonus - l.deductions);

/* ───────────── Períodos y títulos ───────────── */
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const parts = (d: string) => d.split("-").map(Number) as [number, number, number];
export const lastDayOf = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const addDays = (d: string, n: number) => { const [y, m, dd] = parts(d); return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10); };

export type Period = { key: string; label: string; start: string; end: string };

/** Períodos sugeridos al crear una nómina (los ya terminados primero). `today` = YYYY-MM-DD en hora de Santo Domingo. */
export function suggestPeriods(today: string): Period[] {
  const [y, m, d] = parts(today);
  const pm = m === 1 ? 12 : m - 1, py = m === 1 ? y - 1 : y;
  const prevQuincena: Period = d >= 16
    ? { key: "q-prev", label: `Quincena anterior (1–15 ${SHORT[m - 1]})`, start: iso(y, m, 1), end: iso(y, m, 15) }
    : { key: "q-prev", label: `Quincena anterior (16–${lastDayOf(py, pm)} ${SHORT[pm - 1]})`, start: iso(py, pm, 16), end: iso(py, pm, lastDayOf(py, pm)) };
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = domingo
  const lastMonday = addDays(today, -(((dow + 6) % 7) + 7));
  return [
    prevQuincena,
    { key: "month-prev", label: `Mes anterior (${MONTHS[pm - 1]})`, start: iso(py, pm, 1), end: iso(py, pm, lastDayOf(py, pm)) },
    { key: "week-prev", label: "Semana anterior (lunes a domingo)", start: lastMonday, end: addDays(lastMonday, 6) },
    { key: "month-now", label: `Este mes hasta hoy (${MONTHS[m - 1]})`, start: iso(y, m, 1), end: today },
  ];
}

/** Rango legible: "1–15 de octubre de 2026", "28 sep – 3 oct de 2026". */
export function periodLabel(start: string, end: string): string {
  const [y1, m1, d1] = parts(start), [y2, m2, d2] = parts(end);
  if (start === end) return `${d1} de ${MONTHS[m1 - 1]} de ${y1}`;
  if (y1 === y2 && m1 === m2) return `${d1}–${d2} de ${MONTHS[m1 - 1]} de ${y1}`;
  if (y1 === y2) return `${d1} ${SHORT[m1 - 1]} – ${d2} ${SHORT[m2 - 1]} de ${y1}`;
  return `${d1} ${SHORT[m1 - 1]} ${y1} – ${d2} ${SHORT[m2 - 1]} ${y2}`;
}

/** Nombre sugerido: "Quincena 1–15 de octubre 2026", "Nómina de octubre 2026"… */
export function defaultTitle(start: string, end: string): string {
  const [y1, m1, d1] = parts(start), [y2, m2, d2] = parts(end);
  if (y1 === y2 && m1 === m2) {
    if (d1 === 1 && d2 === lastDayOf(y1, m1)) return `Nómina de ${MONTHS[m1 - 1]} ${y1}`;
    if (d1 === 1 && d2 === 15) return `Quincena 1–15 de ${MONTHS[m1 - 1]} ${y1}`;
    if (d1 === 16 && d2 === lastDayOf(y1, m1)) return `Quincena 16–${d2} de ${MONTHS[m1 - 1]} ${y1}`;
  }
  return `Nómina del ${periodLabel(start, end)}`.replace("Nómina del ", "Nómina ");
}
