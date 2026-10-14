/**
 * Manicuristas: sueldo fijo mensual + un porcentaje de lo que cobran los servicios que realizan (puro, sin I/O).
 * Mismas reglas que la nómina: el % de la línea y, si no tiene, el de la especialista; las ventas reembolsadas o anuladas nunca cuentan;
 * por defecto solo cuentan las ventas cobradas por completo (se puede incluir también lo pendiente de cobro).
 */
import type { SaleIn } from "./reports.ts";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const plain = (s: string | null | undefined) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Es manicurista quien tiene «manicurista» (o «manicure») en su especialidad. Así las dos de hoy aparecen solas y las nuevas también. */
export const isManicurist = (specialty: string | null | undefined) => /manicur/.test(plain(specialty));

export type ManiEmployee = { id: string; full_name: string; active: boolean; specialty: string | null; base_salary: number; commission_pct: number | null };

export type ManiLine = {
  /** Cuándo se completó la venta (ISO). */
  date: string;
  saleId: string;
  saleNumber: string;
  client: string;
  /** Servicio realizado. */
  description: string;
  /** Lo que se cobró por este servicio (su parte, si lo hicieron varias). */
  total: number;
  /** El servicio lo hicieron varias especialistas y esto es su parte. */
  shared: boolean;
  status: "pagado" | "parcial" | "pendiente";
  /** Cuenta para la comisión (venta cobrada por completo, o se pidió incluir lo pendiente). */
  counts: boolean;
  /** % de comisión aplicado. */
  pct: number;
  /** Comisión de esta línea (0 si no cuenta todavía). */
  commission: number;
  /** Lo que ganaría si se cobra por completo (para mostrarlo en las pendientes). */
  commissionIfPaid: number;
};

export type ManiSummary = {
  employeeId: string;
  name: string;
  active: boolean;
  /** Sueldo fijo mensual. */
  salary: number;
  /** % de comisión de su ficha (null = sin configurar). */
  pct: number | null;
  /** Servicios que cuentan. */
  services: number;
  /** Cobrado por los servicios que cuentan. */
  charged: number;
  /** Servicios de ventas aún sin cobrar por completo que no cuentan todavía. */
  pendingServices: number;
  pendingAmount: number;
  commission: number;
  /** Sueldo + comisión. */
  payable: number;
  /** Alguna línea no tiene porcentaje (ni el suyo ni el de la ficha): se calculó con 0 %. */
  missingPct: boolean;
  lines: ManiLine[];
};

export type ManiOpts = {
  /** Solo ventas cobradas por completo. Falso: también las pendientes y con pago parcial. */
  onlyPaid: boolean;
};

/**
 * Resume el mes de cada manicurista a partir de las ventas del período (el que llama ya filtró por fechas).
 * Devuelve una entrada por manicurista activa y por cualquier manicurista inactiva que haya tenido servicios.
 */
export function buildManicurists(sales: SaleIn[], employees: ManiEmployee[], opts: ManiOpts): ManiSummary[] {
  const maniById = new Map(employees.filter((e) => isManicurist(e.specialty)).map((e) => [e.id, e]));
  const lines = new Map<string, ManiLine[]>();
  const missing = new Set<string>();
  for (const s of [...sales].sort((a, b) => a.completed_at.localeCompare(b.completed_at) || a.sale_number.localeCompare(b.sale_number))) {
    if (s.payment_status === "reembolsado") continue; // anulada o reembolsada: nunca cuenta
    const status = s.payment_status === "pagado" || s.payment_status === "parcial" ? s.payment_status : "pendiente";
    for (const i of s.items) {
      const empId = i.employee_id ?? s.employee_id;
      const emp = empId ? maniById.get(empId) : undefined;
      if (!emp) continue;
      const own = i.commission_pct ?? emp.commission_pct;
      if (own == null) missing.add(emp.id);
      const pct = own ?? 0;
      const counts = !opts.onlyPaid || status === "pagado";
      const ifPaid = round2((i.total * pct) / 100);
      const list = lines.get(emp.id) ?? [];
      list.push({
        date: s.completed_at, saleId: s.id, saleNumber: s.sale_number, client: s.client_name && s.client_name !== "—" ? s.client_name : "Mostrador", description: i.description, total: round2(i.total),
        shared: !!i.team_id, status, counts, pct, commission: counts ? ifPaid : 0, commissionIfPaid: ifPaid,
      });
      lines.set(emp.id, list);
    }
  }
  return [...maniById.values()]
    .filter((e) => e.active || lines.has(e.id))
    .map((e): ManiSummary => {
      const ls = lines.get(e.id) ?? [];
      const counted = ls.filter((l) => l.counts), pending = ls.filter((l) => !l.counts);
      const commission = round2(counted.reduce((t, l) => t + l.commission, 0));
      return {
        employeeId: e.id, name: e.full_name, active: e.active, salary: round2(e.base_salary), pct: e.commission_pct,
        services: counted.length, charged: round2(counted.reduce((t, l) => t + l.total, 0)),
        pendingServices: pending.length, pendingAmount: round2(pending.reduce((t, l) => t + l.total, 0)),
        commission, payable: round2(e.base_salary + commission), missingPct: missing.has(e.id), lines: ls,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

/* ───────── Mes ───────── */
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** «2026-10» → «octubre de 2026». */
export const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} de ${m.slice(0, 4)}`;
/** Mes anterior (−1) o siguiente (+1) de «AAAA-MM». */
export function shiftMonth(m: string, by: number): string {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
/** Primer día del mes y primer día del siguiente (AAAA-MM-DD), para pedir las ventas del mes. */
export const monthRange = (m: string) => ({ from: `${m}-01`, to: `${shiftMonth(m, 1)}-01` });
/** Mes pedido en la dirección, o `fallback` si no es válido. */
export const parseMonth = (v: unknown, fallback: string) => (typeof v === "string" && MONTH_RE.test(v) ? v : fallback);
