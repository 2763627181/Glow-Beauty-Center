/**
 * Inventario de productos que se usan en los servicios: ventanas de uso de cada entrada, consumo por cliente, duración y el diagnóstico
 * escrito («Si 10 clientes … y se agotaron 10 potes en 20 días, podemos deducir…»). Puro, sin I/O.
 * Las fechas son «AAAA-MM-DD» (día de Santo Domingo).
 */

export type Lot = { id: string; received_on: string; quantity: number; depleted_on: string | null };
export type Supply = { name: string; unit: string; expected: number | null };
/** Un servicio realizado (un servicio de un equipo cuenta una sola vez). */
export type Usage = { date: string; clientKey: string; qty: number };

const DAY = 86_400_000;
const ymd = (s: string) => Date.parse(`${s}T12:00:00Z`);
export const daysBetween = (a: string, b: string) => Math.round((ymd(b) - ymd(a)) / DAY);
export const addDays = (s: string, n: number) => new Date(ymd(s) + n * DAY).toISOString().slice(0, 10);
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
/** 2 → «2», 1.5 → «1.5», 0.333 → «0.33». */
export const num = (n: number) => String(round2(n));

/** Plural de una unidad de una palabra: pote → potes, unidad → unidades, lápiz → lápices. */
export function plural(unit: string, n: number): string {
  if (n === 1) return unit;
  const u = unit.trim();
  if (/z$/i.test(u)) return u.replace(/z$/i, "ces");
  return /[aeiouáéíóú]$/i.test(u) ? `${u}s` : `${u}es`;
}
const withUnit = (n: number, unit: string) => `${num(n)} ${plural(unit, n)}`;

/* ───────── Ventanas de uso (FIFO) ───────── */
export type LotWindow = {
  lot: Lot;
  /** Desde cuándo se empieza a usar esta entrada (para contar los días). */
  startDate: string;
  /** Primer día cuyos servicios cuentan para esta entrada. */
  usageFrom: string;
  /** Último día que cuenta (el de agotado; si sigue en uso, hoy). */
  endDate: string;
  /** Sigue en uso (no se ha marcado como agotada). */
  open: boolean;
  /** Llegó otra entrada mientras la anterior seguía en uso: espera su turno (se usa cuando se agote la anterior). */
  waiting: boolean;
};

/**
 * Las entradas se gastan en orden de llegada: una entrada nueva empieza a usarse cuando se agota la anterior (aunque haya llegado antes).
 * Así los servicios de cada día cuentan para una sola entrada. El día en que se agota una entrada cuenta para ella.
 */
export function lotWindows(lots: Lot[], today: string): LotWindow[] {
  const sorted = [...lots].sort((a, b) => a.received_on.localeCompare(b.received_on) || a.id.localeCompare(b.id));
  return sorted.map((lot, i): LotWindow => {
    const prev = i > 0 ? sorted[i - 1] : null;
    const waiting = !!prev && prev.depleted_on == null;
    let startDate = lot.received_on, usageFrom = lot.received_on;
    if (prev?.depleted_on && prev.depleted_on >= lot.received_on) { startDate = prev.depleted_on; usageFrom = addDays(prev.depleted_on, 1); }
    return { lot, startDate, usageFrom, endDate: lot.depleted_on ?? (today > startDate ? today : startDate), open: lot.depleted_on == null, waiting };
  });
}

/* ───────── Análisis de una entrada ───────── */
export type Verdict = "normal" | "alto" | "muy_alto" | "bajo" | "sin_servicios" | "sin_referencia";
export type LotAnalysis = {
  window: LotWindow;
  /** Servicios realizados con este producto en el tiempo que se usó la entrada. */
  services: number;
  clients: number;
  /** Días de uso (mínimo 1). */
  days: number;
  /** Solo si la entrada se agotó: lo consumido es toda la entrada. */
  units: number | null;
  unitsPerService: number | null;
  servicesPerUnit: number | null;
  daysPerUnit: number | null;
  /** Con qué se compara: lo que el dueño dijo que rinde una unidad, o el promedio de las demás entradas ya agotadas. */
  reference: number | null;
  referenceSource: "esperado" | "historial" | null;
  verdict: Verdict | null;
  /** Solo si sigue en uso y hay referencia: lo que se estima que se ha usado y lo que queda. */
  estimate: { used: number; remaining: number; daysLeft: number | null } | null;
};

function countUsage(w: LotWindow, usages: Usage[]) {
  const mine = usages.filter((u) => u.date >= w.usageFrom && u.date <= w.endDate);
  return { services: mine.reduce((t, u) => t + u.qty, 0), clients: new Set(mine.map((u) => u.clientKey)).size };
}

/** Qué tan normal fue el consumo, comparando lo que rindió cada unidad (`servicesPerUnit`) con la referencia. */
export function judge(services: number, servicesPerUnit: number | null, reference: number | null): Verdict {
  if (services === 0) return "sin_servicios";
  const s = servicesPerUnit ?? 0;
  if (reference == null) return s <= 1 ? "alto" : "sin_referencia"; // una unidad o más por servicio: sospechoso aunque no haya referencia
  const ratio = s / reference;
  return ratio < 0.5 ? "muy_alto" : ratio < 0.8 ? "alto" : ratio > 1.3 ? "bajo" : "normal";
}

/** Analiza todas las entradas de un producto. Para cada entrada agotada compara con lo esperado o, si no hay, con el promedio de las demás agotadas. */
export function analyzeSupply(supply: Supply, lots: Lot[], usages: Usage[], today: string): LotAnalysis[] {
  const windows = lotWindows(lots, today);
  const base = windows.map((w) => {
    const c = w.waiting ? { services: 0, clients: 0 } : countUsage(w, usages);
    const days = Math.max(1, daysBetween(w.startDate, w.endDate));
    return { w, ...c, days, units: w.open ? null : w.lot.quantity };
  });
  const perUnit = (b: (typeof base)[number]) => (b.units && b.units > 0 ? b.services / b.units : null);
  return base.map((b, idx): LotAnalysis => {
    const spu = perUnit(b);
    const others = base.filter((o, j) => j !== idx && !o.w.open && o.services > 0).map((o) => perUnit(o)).filter((v): v is number => v != null);
    const history = others.length ? others.reduce((t, v) => t + v, 0) / others.length : null;
    const reference = supply.expected ?? history;
    const referenceSource = supply.expected != null ? "esperado" : history != null ? "historial" : null;
    const closed = b.units != null && !b.w.waiting;
    let estimate: LotAnalysis["estimate"] = null;
    if (b.w.open && !b.w.waiting && reference && reference > 0) {
      const used = Math.min(b.services / reference, b.w.lot.quantity);
      const perDay = used / b.days;
      estimate = { used: round2(used), remaining: round2(b.w.lot.quantity - used), daysLeft: perDay > 0 ? Math.round((b.w.lot.quantity - used) / perDay) : null };
    }
    return {
      window: b.w, services: b.services, clients: b.clients, days: b.days, units: b.units,
      unitsPerService: closed && b.services > 0 && b.units ? b.units / b.services : null,
      servicesPerUnit: closed ? spu : null,
      daysPerUnit: closed && b.units ? b.days / b.units : null,
      reference: closed ? reference : null, referenceSource: closed ? referenceSource : null,
      verdict: closed ? judge(b.services, spu, reference) : null, estimate,
    };
  });
}

/* ───────── El diagnóstico escrito ───────── */
export type Narrative = { intro: string; points: string[]; problem: string | null; conclusion: string };

const PROBLEM = "existe un consumo excesivo de producto, desperdicio, uso no registrado o un control deficiente del inventario.";

/** El texto que se le muestra al dueño de una entrada agotada. `serviceNames` son los servicios en los que se usa el producto. */
export function narrate(a: LotAnalysis, supply: Supply, serviceNames: string[]): Narrative | null {
  if (a.units == null || a.verdict == null || a.window.waiting) return null;
  const unit = supply.unit, u = a.units;
  const svc = serviceNames.length ? serviceNames.join(" y ") : "los servicios del producto";
  const same = a.clients === a.services;
  const ran = `se ${u === 1 ? "agotó" : "agotaron"} ${withUnit(u, unit)} de ${supply.name} en ${a.days} ${a.days === 1 ? "día" : "días"}, podemos deducir lo siguiente:`;
  const intro = same
    ? `Si ${a.services} ${a.services === 1 ? "cliente utilizó" : "clientes utilizaron"} ${svc} y ${ran}`
    : `Si se realizaron ${a.services} ${a.services === 1 ? "servicio" : "servicios"} de ${svc} (a ${a.clients} ${a.clients === 1 ? "cliente" : "clientes"}) y ${ran}`;
  const points: string[] = [];
  if (a.unitsPerService != null) {
    const sameClients = a.clients === a.services;
    points.push(`Consumo promedio: ${withUnit(a.unitsPerService, unit)} por ${sameClients ? "cliente" : "servicio"}${sameClients ? "" : ` (${withUnit(u / Math.max(a.clients, 1), unit)} por cliente)`}.`);
  } else points.push("Consumo promedio: no se registró ningún servicio en ese tiempo.");
  if (a.daysPerUnit != null) {
    points.push(a.daysPerUnit >= 1 ? `Duración promedio: 1 ${unit} cada ${num(a.daysPerUnit)} ${a.daysPerUnit === 1 ? "día" : "días"}.` : `Duración promedio: ${withUnit(u / a.days, unit)} por día.`);
  }
  if (a.reference != null && a.servicesPerUnit != null) {
    points.push(`Rendimiento: ${num(a.servicesPerUnit)} ${a.servicesPerUnit === 1 ? "servicio" : "servicios"} por ${unit}; ${a.referenceSource === "esperado" ? "lo esperado" : "el promedio de las otras entradas"} es ${num(a.reference)}.`);
  }
  const bad = a.verdict === "alto" || a.verdict === "muy_alto" || a.verdict === "sin_servicios";
  const problem = bad ? `Posible problema: ${PROBLEM}` : null;
  let conclusion: string;
  switch (a.verdict) {
    case "sin_servicios":
      conclusion = `Se agotaron ${withUnit(u, unit)} sin que se registrara ningún servicio con este producto: hay que investigar cómo se está usando (uso no registrado, desperdicio o servicios que no se cobraron en el sistema).`;
      break;
    case "muy_alto":
      conclusion = `El consumo es mucho mayor al esperado (más del doble): para ${a.services} ${a.services === 1 ? "servicio" : "servicios"} se gastaron ${withUnit(u, unit)} en ${a.days} ${a.days === 1 ? "día" : "días"}. Es necesario investigar cómo se está utilizando el producto.`;
      break;
    case "alto":
      conclusion = `Si solamente se atendieron ${a.services} ${a.services === 1 ? "cliente" : "clientes"} en esos ${a.days} ${a.days === 1 ? "día" : "días"}, el consumo de ${withUnit(u, unit)} parece elevado y sería necesario investigar cómo se está utilizando el producto.`;
      break;
    case "bajo":
      conclusion = `El producto rindió más de lo esperado (${num(a.servicesPerUnit ?? 0)} servicios por ${unit}). No hay señales de consumo excesivo; si el rendimiento es demasiado bueno, verifica que no se estén registrando servicios que no se hicieron.`;
      break;
    case "normal":
      conclusion = `El consumo está dentro de lo normal: ${num(a.servicesPerUnit ?? 0)} servicios por ${unit}, parecido a ${a.referenceSource === "esperado" ? "lo esperado" : "las otras entradas"}.`;
      break;
    default:
      conclusion = `Para saber si el consumo es normal, anota en el producto cuántos servicios rinde un ${unit} (o registra más entradas para comparar entre ellas).`;
  }
  return { intro, points, problem, conclusion };
}

/** Texto del progreso de una entrada que sigue en uso. */
export function progressLines(a: LotAnalysis, supply: Supply): string[] {
  if (a.units != null) return [];
  if (a.window.waiting) return ["En espera: esta entrada se empieza a usar cuando se agote la anterior."];
  const out = [`Lleva ${a.days} ${a.days === 1 ? "día" : "días"} en uso y se han hecho ${a.services} ${a.services === 1 ? "servicio" : "servicios"} con este producto (${a.clients} ${a.clients === 1 ? "cliente" : "clientes"}).`];
  if (a.estimate) {
    out.push(`Según el rendimiento ${supply.expected != null ? "esperado" : "de las otras entradas"}, se estima que se han usado ${num(a.estimate.used)} de ${withUnit(a.window.lot.quantity, supply.unit)} y quedan unos ${num(a.estimate.remaining)}${a.estimate.daysLeft != null ? `, para unos ${a.estimate.daysLeft} ${a.estimate.daysLeft === 1 ? "día" : "días"} al ritmo actual` : ""}.`);
  } else out.push("Cuando se agote, márcala como agotada para analizar el consumo.");
  return out;
}

/* ───────── Resumen de todo el producto ───────── */
export type SupplySummary = { lots: number; depleted: number; units: number; services: number; servicesPerUnit: number | null; daysPerUnit: number | null; lastVerdict: Verdict | null; inUse: LotAnalysis | null };
export function summarizeSupply(analyses: LotAnalysis[]): SupplySummary {
  const closed = analyses.filter((a) => a.units != null && !a.window.waiting);
  const units = closed.reduce((t, a) => t + (a.units ?? 0), 0), services = closed.reduce((t, a) => t + a.services, 0), days = closed.reduce((t, a) => t + a.days, 0);
  return {
    lots: analyses.length, depleted: closed.length, units, services,
    servicesPerUnit: units > 0 ? round2(services / units) : null, daysPerUnit: units > 0 ? round2(days / units) : null,
    lastVerdict: closed.length ? closed[closed.length - 1].verdict : null,
    inUse: analyses.find((a) => a.window.open && !a.window.waiting) ?? null,
  };
}

export const VERDICT_LABEL: Record<Verdict, { text: string; tone: "ok" | "warn" | "bad" | "muted" }> = {
  normal: { text: "Consumo normal", tone: "ok" }, bajo: { text: "Rinde más de lo esperado", tone: "ok" },
  alto: { text: "Consumo elevado", tone: "warn" }, muy_alto: { text: "Consumo muy elevado", tone: "bad" },
  sin_servicios: { text: "Sin servicios registrados", tone: "bad" }, sin_referencia: { text: "Sin referencia", tone: "muted" },
};

/** Hoy y fechas válidas para registrar: ni futuras ni absurdas. */
export const isValidDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`)) && new Date(`${s}T12:00:00Z`).toISOString().slice(0, 10) === s;
