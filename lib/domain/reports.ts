/** Agregaciones de reportes (puras, sin I/O). Zona horaria: America/Santo_Domingo. */

export type SaleIn = {
  id: string; sale_number: string; completed_at: string; total: number; subtotal: number; discount: number; tip: number;
  payment_status: string; client_id: string | null; client_name: string; employee_id: string | null; employee_name: string;
  items: { description: string; total: number; service_id: string | null; category_name: string; employee_id: string | null; employee_name: string; commission_pct: number | null }[];
  payments: { amount: number; method: string; status: string }[];
};
export type ApptIn = { status: string; start_time: string; created_at: string };

export type Row = { label: string; value: number; count?: number };

const TZ = "America/Santo_Domingo";
const dayKey = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });
const hourOf = (iso: string) => Number(new Date(iso).toLocaleString("en-US", { timeZone: TZ, hour: "numeric", hour12: false })) % 24;
const dowOf = (iso: string) => new Date(`${dayKey(iso)}T12:00:00-04:00`).getUTCDay();

function group<T>(list: T[], key: (t: T) => string, val: (t: T) => number): Row[] {
  const m = new Map<string, Row>();
  for (const x of list) {
    const k = key(x);
    const r = m.get(k) ?? { label: k, value: 0, count: 0 };
    r.value += val(x); r.count = (r.count ?? 0) + 1;
    m.set(k, r);
  }
  return [...m.values()].sort((a, b) => b.value - a.value);
}

export type SummaryOpts = {
  /** Comisión % por especialista (se usa si la línea no trae la suya). */
  employeeCommission?: Record<string, number>;
  /** Etiquetas de métodos de pago (clave → nombre). */
  methodLabels?: Record<string, string>;
};

export function summarize(sales: SaleIn[], appts: ApptIn[], opts: SummaryOpts = {}) {
  const valid = sales.filter((s) => s.payment_status !== "reembolsado");
  const revenue = valid.reduce((t, s) => t + s.total, 0);
  const completed = appts.filter((a) => a.status === "completado").length;
  const cancelled = appts.filter((a) => a.status === "cancelado").length;
  const noShow = appts.filter((a) => a.status === "no_asistio").length;
  const requests = appts.length;

  const paid = sales.flatMap((s) => s.payments).filter((p) => p.status === "pagado");
  const items = valid.flatMap((s) => s.items.map((i) => ({ ...i, employee_name: i.employee_name || s.employee_name })));
  const DOW = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  const active = appts.filter((a) => !["cancelado", "no_asistio"].includes(a.status));
  const label = (k: string) => opts.methodLabels?.[k] ?? k;

  // Comisión por especialista = Σ (total de la línea × % de comisión). % de la línea, si no, el del especialista.
  const commissionRows = new Map<string, Row>();
  for (const i of items) {
    const pct = i.commission_pct ?? (i.employee_id ? opts.employeeCommission?.[i.employee_id] : undefined) ?? 0;
    if (!pct) continue;
    const k = i.employee_name || "Sin asignar";
    const r = commissionRows.get(k) ?? { label: k, value: 0, count: 0 };
    r.value += (i.total * pct) / 100; r.count = (r.count ?? 0) + 1;
    commissionRows.set(k, r);
  }

  return {
    revenue, salesCount: valid.length, avgTicket: valid.length ? revenue / valid.length : 0,
    appointments: requests, completed, cancelled, noShow,
    conversion: requests ? completed / requests : 0,
    collected: paid.reduce((t, p) => t + p.amount, 0),
    tips: valid.reduce((t, s) => t + s.tip, 0), discounts: valid.reduce((t, s) => t + s.discount, 0),
    clientsServed: new Set(valid.map((s) => s.client_id).filter(Boolean)).size,
    byService: group(items, (i) => i.description, (i) => i.total),
    byCategory: group(items, (i) => i.category_name || "Productos y otros", (i) => i.total),
    byEmployee: group(items, (i) => i.employee_name || "Sin asignar", (i) => i.total),
    commissions: [...commissionRows.values()].sort((a, b) => b.value - a.value),
    byMethod: group(paid, (p) => label(p.method), (p) => p.amount),
    topClientsSpend: group(valid, (s) => s.client_name, (s) => s.total).slice(0, 10),
    frequentClients: group(valid, (s) => s.client_name, () => 1).slice(0, 10),
    busyHours: group(active, (a) => String(hourOf(a.start_time)).padStart(2, "0") + ":00", () => 1).sort((a, b) => a.label.localeCompare(b.label)),
    busyDays: group(active, (a) => DOW[dowOf(a.start_time)], () => 1),
  };
}

/** Serie diaria (rellena días sin ventas con 0). `days` días terminando en `endDay` (YYYY-MM-DD). */
export function dailySeries(sales: SaleIn[], endDay: string, days: number): Row[] {
  const out: Row[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(`${endDay}T12:00:00-04:00`);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    out.push({ label: key, value: 0 });
  }
  for (const s of sales) {
    if (s.payment_status === "reembolsado") continue;
    const r = out.find((x) => x.label === dayKey(s.completed_at));
    if (r) r.value += s.total;
  }
  return out;
}

export function monthlySeries(sales: SaleIn[], endMonth: string, months: number): Row[] {
  const [y, m] = endMonth.split("-").map(Number);
  const out: Row[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push({ label: d.toISOString().slice(0, 7), value: 0 });
  }
  for (const s of sales) {
    if (s.payment_status === "reembolsado") continue;
    const r = out.find((x) => x.label === dayKey(s.completed_at).slice(0, 7));
    if (r) r.value += s.total;
  }
  return out;
}

/** Texto que Excel/Sheets interpretaría como fórmula (=, +, -, @…) y que no es un simple número o teléfono. */
const looksLikeFormula = (s: string) => /^[=+\-@\t\r]/.test(s) && !/^[+-]?\d[\d\s().-]*$/.test(s);

export function toCSV(rows: (string | number)[][]) {
  // Los nombres, notas y demás textos pueden venir de la web pública: se neutralizan las «fórmulas» (inyección CSV).
  const esc = (v: string | number) => {
    let s = String(v);
    if (typeof v === "string" && looksLikeFormula(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + rows.map((r) => r.map(esc).join(",")).join("\r\n");
}

/* ───── Rangos ───── */
export type RangeKey = "today" | "yesterday" | "7d" | "30d" | "month" | "last_month" | "custom";
export const RANGE_LABEL: Record<RangeKey, string> = {
  today: "Hoy", yesterday: "Ayer", "7d": "7 días", "30d": "30 días", month: "Este mes", last_month: "Mes anterior", custom: "Personalizado",
};

const dr = (day: string, t = "00:00") => new Date(`${day}T${t}:00-04:00`).toISOString();
const addDay = (day: string, n: number) => { const d = new Date(`${day}T12:00:00-04:00`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export function resolveRange(key: RangeKey, today: string, from?: string, to?: string) {
  let a = today, b = addDay(today, 1); // [a, b)
  if (key === "yesterday") { a = addDay(today, -1); b = today; }
  else if (key === "7d") a = addDay(today, -6);
  else if (key === "30d") a = addDay(today, -29);
  else if (key === "month") a = today.slice(0, 8) + "01";
  else if (key === "last_month") {
    const first = today.slice(0, 8) + "01";
    b = first; const d = new Date(`${first}T12:00:00-04:00`); d.setUTCMonth(d.getUTCMonth() - 1); a = d.toISOString().slice(0, 8) + "01";
  } else if (key === "custom" && from && to) { a = from; b = addDay(to, 1); }
  return { fromISO: dr(a), toISO: dr(b), fromDay: a, toDay: addDay(b, -1) };
}
