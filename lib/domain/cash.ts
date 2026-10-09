/**
 * Caja: cálculo del vuelto, efectivo esperado y producción por especialista. Puro (sin base de datos ni Next) para poder probarlo.
 * Los montos se manejan en centavos enteros para que 0.1 + 0.2 nunca produzca 0.30000000000000004 en un vuelto.
 */

export const toCents = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100);
export const fromCents = (c: number) => c / 100;
export const round2 = (n: number) => fromCents(toCents(n));
const num = (v: unknown) => { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; };

/* ───────── Cobro: lo recibido, lo cobrado y el vuelto ───────── */

/** Una fila de pago: en efectivo `value` es lo que ENTREGÓ el cliente; en otros métodos es lo que se cobró (aparte). */
export type TenderInput = { key: number | string; isCash: boolean; value: number };
export type TenderRow = {
  key: number | string; isCash: boolean;
  /** Lo que queda cobrado en esta fila (lo que se registra como pago). */
  applied: number;
  /** Efectivo entregado por el cliente (solo efectivo con monto). */
  tendered: number | null;
  /** Vuelto a devolverle al cliente por esta fila. */
  change: number;
};
export type Tender = {
  rows: TenderRow[];
  /** Total que queda cobrado (efectivo aplicado + otros métodos). */
  applied: number;
  /** Vuelto total a entregar. */
  change: number;
  /** Efectivo que entregó el cliente en total. */
  cashReceived: number;
  /** Cobrado por tarjeta, transferencia u otros (se cobra aparte; aquí solo se registra). */
  nonCash: number;
  /** Lo que queda por cobrar después de estos pagos. */
  remaining: number;
  /** Cuánto se pasan tarjeta/transferencia del total (el efectivo nunca se pasa: lo que sobra es vuelto). */
  overNonCash: number;
};

/**
 * Reparte los pagos sobre lo pendiente (`due`).
 *  • Tarjeta, transferencia y otros: se cobra EXACTAMENTE lo escrito (el sistema no puede cambiar lo que cobró el datáfono o el banco).
 *  • Efectivo: se aplica hasta completar lo pendiente; lo que sobra es el vuelto. Si el cliente da menos, queda un saldo.
 */
export function allocatePayments(rows: TenderInput[], due: number): Tender {
  const dueC = Math.max(toCents(due), 0);
  const nonCashC = rows.filter((r) => !r.isCash).reduce((t, r) => t + Math.max(toCents(r.value), 0), 0);
  let room = Math.max(dueC - nonCashC, 0); // lo que aún cabe en efectivo
  let appliedC = nonCashC, changeC = 0, receivedC = 0;
  const out: TenderRow[] = rows.map((r) => {
    const v = Math.max(toCents(r.value), 0);
    if (!r.isCash) return { key: r.key, isCash: false, applied: fromCents(v), tendered: null, change: 0 };
    const a = Math.min(v, room);
    room -= a; appliedC += a; changeC += v - a; receivedC += v;
    return { key: r.key, isCash: true, applied: fromCents(a), tendered: v > 0 ? fromCents(v) : null, change: fromCents(v - a) };
  });
  return {
    rows: out, applied: fromCents(appliedC), change: fromCents(changeC), cashReceived: fromCents(receivedC), nonCash: fromCents(nonCashC),
    remaining: fromCents(Math.max(dueC - appliedC, 0)), overNonCash: fromCents(Math.max(nonCashC - dueC, 0)),
  };
}

/** Atajos de «el cliente dio…»: el monto exacto y los billetes redondos siguientes (1,800 · 2,000 · 2,500…). */
export function suggestTenders(pending: number): number[] {
  const p = toCents(pending);
  if (p <= 0) return [];
  const out = new Set<number>([p]);
  for (const step of [10000, 50000, 100000, 200000]) {
    const next = (Math.floor(p / step) + 1) * step; // el siguiente múltiplo estrictamente mayor
    if (next > p) out.add(next);
  }
  return [...out].sort((a, b) => a - b).slice(0, 4).map(fromCents);
}

/* ───────── Caja: efectivo esperado y diferencia ───────── */
export type CashTotals = { opening: number; cash_in: number; cash_refunds: number; entradas: number; salidas: number; expected: number };

/** Fondo inicial + efectivo cobrado − efectivo reembolsado + entradas − salidas. (El vuelto ya no está en lo cobrado.) */
export const expectedCash = (t: Omit<CashTotals, "expected">) => fromCents(toCents(t.opening) + toCents(t.cash_in) - toCents(t.cash_refunds) + toCents(t.entradas) - toCents(t.salidas));
/** Positivo = sobra efectivo; negativo = falta. */
export const cashDifference = (counted: number, expected: number) => fromCents(toCents(counted) - toCents(expected));

/** Conteo de billetes y monedas: suma «cantidad × denominación». */
export const DENOMINATIONS = [2000, 1000, 500, 200, 100, 50, 25, 10, 5, 1] as const;
export const countDenominations = (counts: Partial<Record<number, number>>) => fromCents(DENOMINATIONS.reduce((t, d) => t + toCents(d) * Math.max(Math.floor(num(counts[d])), 0), 0));

/* ───────── Producción y porcentaje del salón ───────── */
/** La ficha guarda la comisión (lo que se queda la especialista); «paga al salón» es el resto. */
export const salonPctFromCommission = (commission: number | null | undefined) => (commission == null ? null : round2(100 - commission));
export const commissionFromSalonPct = (salon: number | null | undefined) => (salon == null ? null : round2(100 - salon));

export type ProductionRow = { employee_id: string | null; name: string; services: number; production: number; earned: number; no_pct: number; paid_out: number; tips_out: number };
export type ProductionSplit = {
  /** Lo que se queda la especialista (su comisión). */
  hers: number;
  /** Lo que paga al salón. */
  salon: number;
  /** Producción de servicios que no tienen porcentaje configurado (no se puede repartir). */
  noPct: number;
  /** Lo que ya se le entregó desde la caja. */
  paidOut: number;
  /** Lo que aún falta entregarle (nunca negativo). */
  toPay: number;
  /** Se le entregó más de lo que le corresponde. */
  overPaid: number;
};
export function splitProduction(r: Pick<ProductionRow, "production" | "earned" | "no_pct" | "paid_out">): ProductionSplit {
  const prod = toCents(r.production), earned = toCents(r.earned), noPct = toCents(r.no_pct), paid = toCents(r.paid_out);
  const salon = Math.max(prod - noPct - earned, 0);
  return {
    hers: fromCents(earned), salon: fromCents(salon), noPct: fromCents(noPct), paidOut: fromCents(paid),
    toPay: fromCents(Math.max(earned - paid, 0)), overPaid: fromCents(Math.max(paid - earned, 0)),
  };
}

/* ───────── Movimientos de caja ───────── */
export type MoveKind = "entrada" | "salida";
export type MoveCategory = "pago_especialista" | "propina" | "compra" | "gasto" | "retiro" | "aporte" | "otro";
export const MOVE_LABEL: Record<MoveCategory, string> = {
  pago_especialista: "Pago a especialista", propina: "Entrega de propina", compra: "Compra de materiales o productos", gasto: "Gasto del salón",
  retiro: "Retiro de dinero", aporte: "Dinero que se agrega a la caja", otro: "Otro",
};
export const MOVE_HINT: Partial<Record<MoveCategory, string>> = {
  pago_especialista: "Lo que se le entrega a una especialista de su producción o como adelanto.",
  propina: "Propinas que se le entregan en efectivo.",
  retiro: "Dinero que sacan el dueño o la gerencia de la caja.",
  aporte: "Dinero que se mete a la caja (por ejemplo, más sencillo para dar vuelto).",
};
export const OUT_CATEGORIES: MoveCategory[] = ["pago_especialista", "propina", "compra", "gasto", "retiro", "otro"];
export const IN_CATEGORIES: MoveCategory[] = ["aporte", "otro"];
export const categoriesFor = (kind: MoveKind) => (kind === "salida" ? OUT_CATEGORIES : IN_CATEGORIES);
export const needsEmployee = (c: MoveCategory) => c === "pago_especialista" || c === "propina";
export const needsDescription = (c: MoveCategory) => c === "otro";

/* ───────── Reporte del turno (lo que devuelve la base de datos) ───────── */
export type CashSession = {
  id: string; number: string; opened_at: string; opened_by: string | null; opening_amount: number; opening_note: string | null;
  closed_at: string | null; closed_by: string | null; expected_cash: number | null; counted_cash: number | null; difference: number | null; closing_note: string | null;
};
export type CashMethodRow = { method: string; label: string; is_cash: boolean; count: number; total: number; refunded: number };
export type CashPayment = {
  id: string; paid_at: string; refunded_at: string | null; status: "pagado" | "reembolsado"; method: string; label: string; is_cash: boolean;
  amount: number; tendered: number | null; reference: string | null; sale_id: string | null; sale_number: string | null; appointment_id: string | null;
  client: string | null; by: string | null; paid_in_turn: boolean; refunded_in_turn: boolean;
};
export type CashMovement = {
  id: string; at: string; kind: MoveKind; category: MoveCategory; amount: number; description: string | null;
  employee_id: string | null; employee_name: string | null; by: string | null; voided_at: string | null; void_reason: string | null;
};
export type CashReport = {
  session: CashSession;
  totals: CashTotals;
  methods: CashMethodRow[];
  payments: CashPayment[];
  movements: CashMovement[];
  production: ProductionRow[];
  sales: { count: number; total: number; tips: number; discount: number; pending: number };
};

const opt = (v: unknown) => (v == null ? null : num(v));
/** Convierte la respuesta JSON de la base en tipos seguros (números como números, listas siempre listas). */
export function parseCashReport(raw: unknown): CashReport {
  const r = (raw ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const s = (r.session ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const t = (r.totals ?? {}) as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? (v as Record<string, any>[]) : []); // eslint-disable-line @typescript-eslint/no-explicit-any
  const sales = (r.sales ?? {}) as Record<string, unknown>;
  return {
    session: {
      id: String(s.id), number: String(s.number ?? ""), opened_at: String(s.opened_at), opened_by: s.opened_by ?? null, opening_amount: num(s.opening_amount),
      opening_note: s.opening_note ?? null, closed_at: s.closed_at ?? null, closed_by: s.closed_by ?? null, expected_cash: opt(s.expected_cash),
      counted_cash: opt(s.counted_cash), difference: opt(s.difference), closing_note: s.closing_note ?? null,
    },
    totals: { opening: num(t.opening), cash_in: num(t.cash_in), cash_refunds: num(t.cash_refunds), entradas: num(t.entradas), salidas: num(t.salidas), expected: num(t.expected) },
    methods: list(r.methods).map((m) => ({ method: m.method, label: m.label, is_cash: !!m.is_cash, count: num(m.count), total: num(m.total), refunded: num(m.refunded) })),
    payments: list(r.payments).map((p) => ({
      id: p.id, paid_at: p.paid_at, refunded_at: p.refunded_at ?? null, status: p.status, method: p.method, label: p.label, is_cash: !!p.is_cash, amount: num(p.amount),
      tendered: opt(p.tendered), reference: p.reference ?? null, sale_id: p.sale_id ?? null, sale_number: p.sale_number ?? null, appointment_id: p.appointment_id ?? null,
      client: p.client ?? null, by: p.by ?? null, paid_in_turn: !!p.paid_in_turn, refunded_in_turn: !!p.refunded_in_turn,
    })),
    movements: list(r.movements).map((m) => ({
      id: m.id, at: m.at, kind: m.kind, category: m.category, amount: num(m.amount), description: m.description ?? null, employee_id: m.employee_id ?? null,
      employee_name: m.employee_name ?? null, by: m.by ?? null, voided_at: m.voided_at ?? null, void_reason: m.void_reason ?? null,
    })),
    production: list(r.production).map((p) => ({
      employee_id: p.employee_id ?? null, name: String(p.name ?? "Sin especialista"), services: num(p.services), production: num(p.production), earned: num(p.earned),
      no_pct: num(p.no_pct), paid_out: num(p.paid_out), tips_out: num(p.tips_out),
    })),
    sales: { count: num(sales.count), total: num(sales.total), tips: num(sales.tips), discount: num(sales.discount), pending: num(sales.pending) },
  };
}

/** Vuelto que se le dio al cliente en un cobro en efectivo (lo recibido menos lo cobrado). Sin efectivo recibido registrado, 0. */
export const changeOf = (p: { amount: number; tendered: number | null }) => (p.tendered == null ? 0 : fromCents(Math.max(toCents(p.tendered) - toCents(p.amount), 0)));

/* ───────── Línea de tiempo del turno (cobros, reembolsos, entradas y salidas en orden) ───────── */
export type TimelineRow =
  | { key: string; at: string; type: "cobro"; payment: CashPayment }
  | { key: string; at: string; type: "reembolso"; payment: CashPayment }
  | { key: string; at: string; type: "movimiento"; movement: CashMovement };

/** Mezcla en una sola lista, de lo más reciente a lo más antiguo, lo cobrado, lo reembolsado y los movimientos de efectivo. */
export function buildTimeline(r: Pick<CashReport, "payments" | "movements">): TimelineRow[] {
  const rows: TimelineRow[] = [];
  for (const p of r.payments) {
    if (p.paid_in_turn) rows.push({ key: `c-${p.id}`, at: p.paid_at, type: "cobro", payment: p });
    if (p.refunded_in_turn && p.refunded_at) rows.push({ key: `r-${p.id}`, at: p.refunded_at, type: "reembolso", payment: p });
  }
  for (const m of r.movements) rows.push({ key: `m-${m.id}`, at: m.at, type: "movimiento", movement: m });
  return rows.sort((a, b) => +new Date(b.at) - +new Date(a.at) || a.key.localeCompare(b.key));
}

/** Efecto de una fila en el efectivo de la caja (positivo entra, negativo sale, 0 no la toca: tarjeta, transferencia o movimiento anulado). */
export function cashEffect(row: TimelineRow): number {
  if (row.type === "cobro") return row.payment.is_cash ? row.payment.amount : 0;
  if (row.type === "reembolso") return row.payment.is_cash ? -row.payment.amount : 0;
  const m = row.movement;
  if (m.voided_at) return 0;
  return m.kind === "entrada" ? m.amount : -m.amount;
}
