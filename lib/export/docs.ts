/**
 * Arma los documentos de exportación (citas, clientes, reportes y ventas) a partir de datos ya leídos.
 * Puro (sin base de datos ni Next): las rutas leen los datos y estas funciones deciden qué columnas, totales y secciones llevan.
 */
import type { ApptRow } from "../data/appointments.ts";
import { apptSubtotal, apptTotal } from "../data/appointment-math.ts";
import { summarize, type ApptIn, type Row, type SaleIn, type SummaryOpts } from "../domain/reports.ts";
import { SOURCE_LABEL, STATUS_META } from "../domain/status.ts";
import { duration, fmtDate, fmtTime } from "../format.ts";
import { moneyFixed, type Cell, type Col, type ExportDoc, type Section, type Tone } from "./model.ts";

export type Ctx = { business: ExportDoc["business"]; generatedAt: string };
type R = Record<string, Cell>;

const DAY_MS = 864e5;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const pct = (part: number, whole: number) => (whole > 0 ? part / whole : 0);
const round2 = (n: number) => Math.round(n * 100) / 100;
const dayNoon = (day: string) => `${day}T12:00:00-04:00`;
const shortDay = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" });

/* ───────────── Etiquetas y colores de estado ───────────── */
const APPT_TONE: Record<string, Tone> = {
  solicitud: "warn", contactando: "warn", contactado: "warn", confirmado: "info", en_espera: "info", en_servicio: "info",
  completado: "ok", cancelado: "bad", no_asistio: "muted",
};
const apptLabelTone: Record<string, Tone> = Object.fromEntries(Object.entries(STATUS_META).map(([k, v]) => [v.label, APPT_TONE[k] ?? "muted"]));
const apptTone = (v: Cell) => apptLabelTone[String(v)];
const PAY_LABEL: Record<string, string> = { pagado: "Pagado", parcial: "Parcial", pendiente: "Pendiente", reembolsado: "Reembolsada" };
const PAY_TONE: Record<string, Tone> = { Pagado: "ok", Parcial: "warn", Pendiente: "bad", Reembolsada: "muted" };
const payTone = (v: Cell) => PAY_TONE[String(v)];
const CLOSED_LABELS = [STATUS_META.cancelado.label, STATUS_META.no_asistio.label];
const OPEN: string[] = ["solicitud", "contactando", "contactado", "confirmado", "en_espera", "en_servicio"];

const col = (key: string, header: string, o: Partial<Col> = {}): Col => ({ key, header, ...o });

/* ═════════════════════════════ CITAS ═════════════════════════════ */
export function appointmentsDoc(items: ApptRow[], ctx: Ctx, f: { range: string; status?: string; search?: string; limit: number }): ExportDoc {
  const RANGE: Record<string, string> = { upcoming: "Próximas", past: "Pasadas", all: "Todas" };
  const rows: R[] = items.map((a) => {
    const total = a.final_total ?? apptTotal(a);
    const closed = a.status === "cancelado" || a.status === "no_asistio";
    return {
      n: a.request_number, fecha: a.start_time, hora: `${fmtTime(a.start_time)} – ${fmtTime(a.end_time)}`,
      dur: duration(Math.max(0, Math.round((+new Date(a.end_time) - +new Date(a.start_time)) / 60000))),
      estado: STATUS_META[a.status].label, cliente: `${a.client.first_name} ${a.client.last_name}`.trim(), tel: a.client.phone, correo: a.client.email ?? "",
      serv: a.services.map((s) => (s.quantity > 1 ? `${s.name} ×${s.quantity}` : s.name)).join(" + "),
      emp: a.employees.map((e) => e.name).join(" + "), origen: SOURCE_LABEL[a.source] ?? a.source,
      sub: apptSubtotal(a), desc: a.discount, prop: a.tip, total, pagado: a.paid, pend: closed ? 0 : Math.max(total - a.paid, 0),
      notas: a.notes ?? "", creada: a.created_at,
    };
  });
  const live = items.filter((a) => a.status !== "cancelado" && a.status !== "no_asistio");
  const sum = (list: ApptRow[], pick: (a: ApptRow) => number) => list.reduce((t, a) => t + pick(a), 0);
  const expected = sum(live, (a) => a.final_total ?? apptTotal(a));
  const collected = sum(live, (a) => a.paid);
  const count = (s: string) => items.filter((a) => a.status === s).length;

  // Resumen por estado
  const byState = (Object.keys(STATUS_META) as (keyof typeof STATUS_META)[])
    .map((k) => ({ label: STATUS_META[k].label, n: count(k), m: sum(items.filter((a) => a.status === k), (a) => a.final_total ?? apptTotal(a)) }))
    .filter((x) => x.n > 0);
  // Por especialista (líneas de cada cita; una cita con varias especialistas cuenta para cada una)
  const emp = new Map<string, { citas: Set<string>; monto: number }>();
  const svc = new Map<string, { qty: number; monto: number }>();
  for (const a of live) for (const s of a.services) {
    const e = emp.get(s.employee_name ?? "Sin asignar") ?? { citas: new Set<string>(), monto: 0 };
    e.citas.add(a.id); e.monto += s.final_price * s.quantity; emp.set(s.employee_name ?? "Sin asignar", e);
    const v = svc.get(s.name) ?? { qty: 0, monto: 0 };
    v.qty += s.quantity; v.monto += s.final_price * s.quantity; svc.set(s.name, v);
  }
  const empRows = [...emp].map(([e, v]) => ({ e, c: v.citas.size, m: v.monto })).sort((a, b) => b.m - a.m);
  const svcRows = [...svc].map(([s, v]) => ({ s, q: v.qty, m: v.monto })).sort((a, b) => b.m - a.m);
  const empTotal = empRows.reduce((t, x) => t + x.m, 0), svcTotal = svcRows.reduce((t, x) => t + x.m, 0);

  return {
    fileBase: "glow-citas", title: "Citas y solicitudes", subtitle: `${RANGE[f.range] ?? "Todas"} · ${items.length} resultado${items.length === 1 ? "" : "s"}`,
    business: ctx.business, generatedAt: ctx.generatedAt,
    filters: [["Rango", RANGE[f.range] ?? "Todas"], ["Estado", f.status && f.status in STATUS_META ? STATUS_META[f.status as keyof typeof STATUS_META].label : "Todos"], ["Búsqueda", f.search?.trim() || "—"],
      ...(items.length >= f.limit ? ([["Límite", `Se incluyen las primeras ${f.limit.toLocaleString("en-US")} citas`]] as [string, string][]) : [])],
    kpis: [
      { label: "Citas", value: items.length, kind: "int" }, { label: "Por atender", value: items.filter((a) => OPEN.includes(a.status)).length, kind: "int", hint: "Solicitud, confirmada o en curso" },
      { label: "Completadas", value: count("completado"), kind: "int" }, { label: "Canceladas", value: count("cancelado"), kind: "int" }, { label: "No asistió", value: count("no_asistio"), kind: "int" },
      { label: "Ingresos esperados", value: expected, kind: "money", hint: "Sin canceladas ni no asistió" }, { label: "Cobrado", value: collected, kind: "money" },
      { label: "Por cobrar", value: Math.max(expected - collected, 0), kind: "money" },
    ],
    sections: [
      {
        name: "Citas", title: "Listado de citas", subtitle: "Una fila por cita, ordenadas por fecha",
        columns: [
          col("n", "Solicitud", { width: 15 }), col("fecha", "Fecha", { kind: "date" }), col("hora", "Hora", { width: 20 }), col("dur", "Duración", { pdf: false, width: 11 }),
          col("estado", "Estado", { tone: apptTone, width: 13 }), col("cliente", "Cliente", { width: 26 }), col("tel", "Teléfono", { width: 15 }), col("correo", "Correo", { pdf: false, width: 26 }),
          col("serv", "Servicios", { width: 40 }), col("emp", "Especialistas", { pdf: false, width: 24 }), col("origen", "Origen", { pdf: false, width: 11 }),
          col("sub", "Subtotal", { kind: "money", total: "sum", pdf: false }), col("desc", "Descuento", { kind: "money", total: "sum", pdf: false }), col("prop", "Propina", { kind: "money", total: "sum", pdf: false }),
          col("total", "Total", { kind: "money", total: "sum" }), col("pagado", "Pagado", { kind: "money", total: "sum" }), col("pend", "Pendiente", { kind: "money", total: "sum" }),
          col("notas", "Notas de la clienta", { pdf: false, width: 34 }), col("creada", "Registrada", { kind: "datetime", pdf: false }),
        ],
        rows, totals: { label: "Total (sin canceladas ni no asistió)", excludeKey: "estado", excludeValues: CLOSED_LABELS }, emptyText: "No hay citas con estos filtros.",
      },
      {
        name: "Por estado", title: "Resumen por estado", columns: [
          col("e", "Estado", { tone: apptTone }), col("c", "Citas", { kind: "int", total: "sum" }), col("m", "Monto", { kind: "money", total: "sum" }), col("p", "% de las citas", { kind: "percent", bar: true }),
        ],
        rows: byState.map((x) => ({ e: x.label, c: x.n, m: x.m, p: pct(x.n, items.length) })), totals: { label: "Total" }, emptyText: "Sin citas.",
      },
      {
        name: "Por especialista", title: "Citas por especialista", subtitle: "Sin canceladas ni no asistió",
        columns: [col("e", "Especialista"), col("c", "Citas", { kind: "int" }), col("m", "Monto", { kind: "money", total: "sum" }), col("p", "% del monto", { kind: "percent", bar: true })],
        rows: empRows.map((x) => ({ e: x.e, c: x.c, m: x.m, p: pct(x.m, empTotal) })), totals: { label: "Total" },
        note: "Una cita con varias especialistas cuenta una vez para cada una; el monto es el de los servicios que realiza cada quien.", emptyText: "Sin citas.",
      },
      {
        name: "Por servicio", title: "Servicios solicitados", subtitle: "Sin canceladas ni no asistió",
        columns: [col("s", "Servicio", { width: 36 }), col("q", "Cantidad", { kind: "int", total: "sum" }), col("m", "Monto", { kind: "money", total: "sum" }), col("p", "% del monto", { kind: "percent", bar: true })],
        rows: svcRows.map((x) => ({ s: x.s, q: x.q, m: x.m, p: pct(x.m, svcTotal) })), totals: { label: "Total" }, emptyText: "Sin citas.",
      },
    ],
    csv: "first", pdfMaxRows: 2500,
  };
}

/* ═════════════════════════════ CLIENTES ═════════════════════════════ */
export type ClientExportRow = {
  first_name: string; last_name: string; phone: string; email: string | null; active: boolean; created_at: string;
  visits: number; total_spent: number; last_visit: string | null; next_appointment: string | null; cancellations: number; no_shows: number;
};

export function clientsDoc(clients: ClientExportRow[], ctx: Ctx): ExportDoc {
  const now = +new Date(ctx.generatedAt);
  const name = (c: ClientExportRow) => `${c.first_name} ${c.last_name}`.trim();
  const rows: R[] = clients.map((c) => ({
    cliente: name(c), tel: c.phone, correo: c.email ?? "", estado: c.active ? "Activo" : "Inactivo", visitas: c.visits, gastado: c.total_spent,
    ticket: c.visits > 0 ? round2(c.total_spent / c.visits) : null, cancel: c.cancellations, noshow: c.no_shows, ultima: c.last_visit, proxima: c.next_appointment, desde: c.created_at,
  }));
  const withVisits = clients.filter((c) => c.visits > 0);
  const spent = clients.reduce((t, c) => t + c.total_spent, 0);
  const days = (iso: string) => Math.floor((now - +new Date(iso)) / DAY_MS);
  const top = [...withVisits].sort((a, b) => b.total_spent - a.total_spent).slice(0, 20);
  const reactivate = clients.filter((c) => c.active && c.visits > 0 && c.last_visit && days(c.last_visit) > 90).sort((a, b) => b.total_spent - a.total_spent);
  const stateTone = (v: Cell): Tone | undefined => (v === "Activo" ? "ok" : v === "Inactivo" ? "muted" : undefined);

  return {
    fileBase: "glow-clientes", title: "Clientes", subtitle: `${clients.length.toLocaleString("en-US")} cliente${clients.length === 1 ? "" : "s"} registrados`,
    business: ctx.business, generatedAt: ctx.generatedAt, filters: [["Incluye", "Todos los clientes (activos e inactivos)"]],
    kpis: [
      { label: "Clientes registrados", value: clients.length, kind: "int" }, { label: "Activos", value: clients.filter((c) => c.active).length, kind: "int" },
      { label: "Con al menos una visita", value: withVisits.length, kind: "int" }, { label: "Total gastado", value: spent, kind: "money", hint: "Ventas completadas" },
      { label: "Gasto promedio por cliente", value: withVisits.length ? spent / withVisits.length : 0, kind: "money", hint: "Solo clientes con visitas" },
      { label: "Nuevos (últimos 30 días)", value: clients.filter((c) => days(c.created_at) <= 30).length, kind: "int" },
      { label: "Para reactivar", value: reactivate.length, kind: "int", hint: "Sin visita en más de 90 días" },
    ],
    sections: [
      {
        name: "Clientes", title: "Listado de clientes", subtitle: "Ordenados del más reciente al más antiguo",
        columns: [
          col("cliente", "Cliente", { width: 28 }), col("tel", "WhatsApp", { width: 15 }), col("correo", "Correo", { width: 28, pdf: false }), col("estado", "Estado", { tone: stateTone, width: 11 }),
          col("visitas", "Visitas", { kind: "int", total: "sum" }), col("gastado", "Total gastado", { kind: "money", total: "sum" }), col("ticket", "Ticket promedio", { kind: "money" }),
          col("cancel", "Cancelaciones", { kind: "int", total: "sum", pdf: false }), col("noshow", "No asistió", { kind: "int", total: "sum", pdf: false }),
          col("ultima", "Última visita", { kind: "date" }), col("proxima", "Próxima cita", { kind: "date", pdf: false }), col("desde", "Cliente desde", { kind: "date" }),
        ],
        rows, totals: { label: `Total (${clients.length.toLocaleString("en-US")} clientes)` }, emptyText: "Aún no hay clientes.",
      },
      {
        name: "Mejores clientes", title: "Mejores clientes", subtitle: "Los 20 con mayor gasto acumulado",
        columns: [col("pos", "#", { kind: "int", width: 5 }), col("cliente", "Cliente", { width: 28 }), col("visitas", "Visitas", { kind: "int", total: "sum" }), col("gastado", "Total gastado", { kind: "money", total: "sum" }),
          col("ticket", "Ticket promedio", { kind: "money" }), col("p", "% del total", { kind: "percent", bar: true }), col("ultima", "Última visita", { kind: "date" })],
        rows: top.map((c, i) => ({ pos: i + 1, cliente: name(c), visitas: c.visits, gastado: c.total_spent, ticket: round2(c.total_spent / c.visits), p: pct(c.total_spent, spent), ultima: c.last_visit })),
        totals: { label: "Total" }, emptyText: "Todavía no hay ventas registradas.",
      },
      {
        name: "Para reactivar", title: "Clientes para reactivar", subtitle: "Activos con visitas que no vienen hace más de 90 días: ideales para escribirles por WhatsApp",
        columns: [col("cliente", "Cliente", { width: 28 }), col("tel", "WhatsApp", { width: 15 }), col("visitas", "Visitas", { kind: "int" }), col("gastado", "Total gastado", { kind: "money", total: "sum" }),
          col("ultima", "Última visita", { kind: "date" }), col("dias", "Días sin venir", { kind: "int" })],
        rows: reactivate.map((c) => ({ cliente: name(c), tel: c.phone, visitas: c.visits, gastado: c.total_spent, ultima: c.last_visit, dias: days(c.last_visit!) })),
        totals: { label: "Total" }, emptyText: "Ningún cliente activo lleva más de 90 días sin venir. ¡Buen trabajo!",
      },
    ],
    csv: "first", pdfMaxRows: 2500,
  };
}

/* ═════════════════════════════ REPORTES ═════════════════════════════ */
export type ReportRange = { fromDay: string; toDay: string; label: string };

function periodSubtitle(r: ReportRange) {
  const d = (day: string) => fmtDate(dayNoon(day), { day: "numeric", month: "long", year: "numeric" });
  return r.fromDay === r.toDay ? d(r.fromDay) : `Del ${d(r.fromDay)} al ${d(r.toDay)}`;
}
const rangeFilters = (r: ReportRange): [string, string][] => [["Período", r.label], ["Desde", r.fromDay], ["Hasta", r.toDay]];

/** Días de `fromDay` a `toDay` (incluidos). */
function daysBetween(fromDay: string, toDay: string): string[] {
  const out: string[] = [];
  for (let d = new Date(`${fromDay}T12:00:00Z`); d <= new Date(`${toDay}T12:00:00Z`) && out.length < 400; d = new Date(+d + DAY_MS)) out.push(d.toISOString().slice(0, 10));
  return out;
}

const rankRows = (rows: Row[], total: number, qtyKey = true): R[] => rows.map((x) => ({ l: x.label, q: qtyKey ? (x.count ?? 0) : null, v: x.value, p: pct(x.value, total) }));

export function reportDoc(r: ReportRange, sales: SaleIn[], appts: ApptIn[], refs: SummaryOpts, ctx: Ctx): ExportDoc {
  const m = summarize(sales, appts, refs);
  const valid = sales.filter((s) => s.payment_status !== "reembolsado");

  // Ventas por día
  const byDay = new Map<string, { n: number; v: number }>();
  for (const s of valid) { const k = shortDay(s.completed_at), x = byDay.get(k) ?? { n: 0, v: 0 }; x.n++; x.v += s.total; byDay.set(k, x); }
  const allDays = daysBetween(r.fromDay, r.toDay);
  const dayList = allDays.length <= 120 ? allDays : allDays.filter((d) => byDay.has(d));
  const dayRows: R[] = dayList.map((d) => { const x = byDay.get(d); return { f: d, d: cap(fmtDate(dayNoon(d), { weekday: "long" })), n: x?.n ?? 0, v: x?.v ?? 0, t: x ? round2(x.v / x.n) : null }; });

  // Especialistas: ingresos + comisión
  const com = new Map(m.commissions.map((x) => [x.label, x.value]));
  const empRows: R[] = m.byEmployee.map((x) => ({ l: x.label, q: x.count ?? 0, v: x.value, p: pct(x.value, m.revenue), c: round2(com.get(x.label) ?? 0) }));

  // Citas por estado, día y hora
  const apptCount = (st: string) => appts.filter((a) => a.status === st).length;
  const stateRows: R[] = (Object.keys(STATUS_META) as (keyof typeof STATUS_META)[]).map((k) => ({ l: STATUS_META[k].label, q: apptCount(k) })).filter((x) => (x.q as number) > 0).map((x) => ({ ...x, p: pct(x.q as number, appts.length) }));
  const dayOrder = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
  const busyDays = [...m.busyDays].sort((a, b) => dayOrder.indexOf(a.label) - dayOrder.indexOf(b.label));
  const activeAppts = busyDays.reduce((t, x) => t + x.value, 0);

  const doc: ExportDoc = {
    fileBase: `glow-reporte-${r.fromDay}_${r.toDay}`, title: "Reporte de ventas y desempeño", subtitle: periodSubtitle(r),
    business: ctx.business, generatedAt: ctx.generatedAt, filters: rangeFilters(r),
    kpis: [
      { label: "Ingresos totales", value: m.revenue, kind: "money", hint: "Ventas sin reembolsar" }, { label: "Ventas", value: m.salesCount, kind: "int" }, { label: "Ticket promedio", value: m.avgTicket, kind: "money" },
      { label: "Cobrado", value: m.collected, kind: "money", hint: "Pagos recibidos" }, { label: "Propinas", value: m.tips, kind: "money" }, { label: "Descuentos", value: m.discounts, kind: "money" },
      { label: "Clientes atendidos", value: m.clientsServed, kind: "int" }, { label: "Citas", value: m.appointments, kind: "int" }, { label: "Completadas", value: m.completed, kind: "int" },
      { label: "Canceladas", value: m.cancelled, kind: "int" }, { label: "No asistió", value: m.noShow, kind: "int" }, { label: "Conversión", value: m.conversion, kind: "percent", hint: "Solicitudes que se completaron" },
    ],
    sections: [
      {
        name: "Ventas por día", title: "Ventas por día", subtitle: allDays.length > 120 ? "Solo los días con ventas (el período es muy largo)" : "Cada día del período",
        columns: [col("f", "Fecha", { kind: "date" }), col("d", "Día", { width: 12 }), col("n", "Ventas", { kind: "int", total: "sum" }), col("v", "Ingresos", { kind: "money", total: "sum" }), col("t", "Ticket promedio", { kind: "money" })],
        rows: dayRows, totals: { label: "Total del período" }, emptyText: "No hubo ventas en este período.",
      },
      {
        name: "Por servicio", title: "Ingresos por servicio y producto", subtitle: "Ordenados de mayor a menor",
        columns: [col("l", "Servicio / producto", { width: 38 }), col("q", "Cantidad", { kind: "int", total: "sum" }), col("v", "Ingresos", { kind: "money", total: "sum" }), col("p", "% de los ingresos", { kind: "percent", bar: true })],
        rows: rankRows(m.byService, m.revenue), totals: { label: "Total" }, emptyText: "Sin ventas en este período.",
      },
      {
        name: "Por categoría", title: "Ingresos por categoría",
        columns: [col("l", "Categoría", { width: 30 }), col("q", "Cantidad", { kind: "int", total: "sum" }), col("v", "Ingresos", { kind: "money", total: "sum" }), col("p", "% de los ingresos", { kind: "percent", bar: true })],
        rows: rankRows(m.byCategory, m.revenue), totals: { label: "Total" }, emptyText: "Sin ventas en este período.",
      },
      {
        name: "Por especialista", title: "Ingresos y comisiones por especialista", subtitle: "Comisión estimada según el % de cada servicio o, si no tiene, el de la especialista",
        columns: [col("l", "Especialista", { width: 28 }), col("q", "Servicios", { kind: "int", total: "sum" }), col("v", "Ingresos", { kind: "money", total: "sum" }), col("p", "% de los ingresos", { kind: "percent", bar: true }), col("c", "Comisión estimada", { kind: "money", total: "sum" })],
        rows: empRows, totals: { label: "Total" }, emptyText: "Sin ventas en este período.",
      },
      {
        name: "Métodos de pago", title: "Pagos por método",
        columns: [col("l", "Método de pago", { width: 26 }), col("q", "Pagos", { kind: "int", total: "sum" }), col("v", "Monto cobrado", { kind: "money", total: "sum" }), col("p", "% de lo cobrado", { kind: "percent", bar: true })],
        rows: rankRows(m.byMethod, m.collected), totals: { label: "Total" }, emptyText: "Sin pagos en este período.",
      },
      {
        name: "Mejores clientes", title: "Clientes con mayor gasto", subtitle: "Los 10 con más compras en el período",
        columns: [col("l", "Cliente", { width: 30 }), col("q", "Compras", { kind: "int", total: "sum" }), col("v", "Gasto total", { kind: "money", total: "sum" }), col("p", "% de los ingresos", { kind: "percent", bar: true })],
        rows: rankRows(m.topClientsSpend, m.revenue), totals: { label: "Total" }, emptyText: "Sin ventas en este período.",
      },
      {
        name: "Citas por estado", title: "Citas por estado",
        columns: [col("l", "Estado", { tone: apptTone }), col("q", "Citas", { kind: "int", total: "sum" }), col("p", "% de las citas", { kind: "percent", bar: true })],
        rows: stateRows, totals: { label: "Total" }, emptyText: "Sin citas en este período.",
      },
      {
        name: "Demanda por día", title: "Días con mayor demanda", subtitle: "Citas sin canceladas ni no asistió",
        columns: [col("l", "Día de la semana", { width: 20 }), col("q", "Citas", { kind: "int", total: "sum" }), col("p", "% de las citas", { kind: "percent", bar: true })],
        rows: busyDays.map((x) => ({ l: x.label, q: x.value, p: pct(x.value, activeAppts) })), totals: { label: "Total" }, emptyText: "Sin citas en este período.",
      },
      {
        name: "Demanda por hora", title: "Horas con mayor demanda", subtitle: "Citas sin canceladas ni no asistió",
        columns: [col("l", "Hora de inicio", { width: 16 }), col("q", "Citas", { kind: "int", total: "sum" }), col("p", "% de las citas", { kind: "percent", bar: true })],
        rows: m.busyHours.map((x) => ({ l: x.label, q: x.value, p: pct(x.value, activeAppts) })), totals: { label: "Total" }, emptyText: "Sin citas en este período.",
      },
    ],
    csv: "all", pdfMaxRows: 2500,
  };
  return doc;
}

/* ═════════════════════════════ VENTAS DETALLADAS ═════════════════════════════ */
export function salesDoc(r: ReportRange, sales: SaleIn[], refs: SummaryOpts, ctx: Ctx): ExportDoc {
  const label = (k: string) => refs.methodLabels?.[k] ?? k;
  const rows: R[] = sales.map((s) => {
    const paid = s.payments.filter((p) => p.status === "pagado").reduce((t, p) => t + p.amount, 0);
    const methods = new Map<string, number>();
    for (const p of s.payments) if (p.status === "pagado") methods.set(label(p.method), (methods.get(label(p.method)) ?? 0) + p.amount);
    const staff = [...new Set(s.items.map((i) => i.employee_name || s.employee_name).filter(Boolean))];
    const open = s.payment_status === "pendiente" || s.payment_status === "parcial";
    return {
      n: s.sale_number, fecha: s.completed_at, hora: s.completed_at, cliente: s.client_name, serv: s.items.map((i) => i.description).join(" + "), emp: staff.join(" + "),
      sub: s.subtotal, desc: s.discount, prop: s.tip, total: s.total, pagado: paid, pend: open ? Math.max(s.total - paid, 0) : 0,
      estado: PAY_LABEL[s.payment_status] ?? s.payment_status, metodos: [...methods].map(([k, v]) => `${k} ${moneyFixed(v)}`).join(" + "),
    };
  });
  const valid = sales.filter((s) => s.payment_status !== "reembolsado");
  const revenue = valid.reduce((t, s) => t + s.total, 0);
  const items: R[] = valid.flatMap((s) => s.items.map((i) => {
    const pctC = i.commission_pct ?? (i.employee_id ? refs.employeeCommission?.[i.employee_id] : undefined) ?? 0;
    return { n: s.sale_number, fecha: s.completed_at, art: i.description, cat: i.category_name || "Productos y otros", emp: i.employee_name || s.employee_name || "Sin asignar", imp: i.total, pc: pctC / 100, com: round2((i.total * pctC) / 100) };
  }));
  const pending = sales.filter((s) => s.payment_status === "pendiente" || s.payment_status === "parcial").reduce((t, s) => t + Math.max(s.total - s.payments.filter((p) => p.status === "pagado").reduce((a, p) => a + p.amount, 0), 0), 0);

  return {
    fileBase: `glow-ventas-${r.fromDay}_${r.toDay}`, title: "Ventas detalladas", subtitle: periodSubtitle(r), business: ctx.business, generatedAt: ctx.generatedAt, filters: rangeFilters(r),
    kpis: [
      { label: "Ventas", value: valid.length, kind: "int" }, { label: "Ingresos", value: revenue, kind: "money", hint: "Sin reembolsadas" }, { label: "Ticket promedio", value: valid.length ? revenue / valid.length : 0, kind: "money" },
      { label: "Cobrado", value: valid.reduce((t, s) => t + s.payments.filter((p) => p.status === "pagado").reduce((a, p) => a + p.amount, 0), 0), kind: "money" },
      { label: "Por cobrar", value: pending, kind: "money" }, { label: "Propinas", value: valid.reduce((t, s) => t + s.tip, 0), kind: "money" }, { label: "Descuentos", value: valid.reduce((t, s) => t + s.discount, 0), kind: "money" },
    ],
    sections: [
      {
        name: "Ventas", title: "Ventas del período", subtitle: "Una fila por venta, de la más reciente a la más antigua",
        columns: [
          col("n", "Venta", { width: 17 }), col("fecha", "Fecha", { kind: "date" }), col("hora", "Hora", { kind: "time", pdf: false }), col("cliente", "Cliente", { width: 26 }), col("serv", "Servicios y productos", { width: 40 }),
          col("emp", "Especialistas", { width: 24 }), col("sub", "Subtotal", { kind: "money", total: "sum", pdf: false }), col("desc", "Descuento", { kind: "money", total: "sum" }), col("prop", "Propina", { kind: "money", total: "sum" }),
          col("total", "Total", { kind: "money", total: "sum" }), col("pagado", "Pagado", { kind: "money", total: "sum", pdf: false }), col("pend", "Pendiente", { kind: "money", total: "sum", pdf: false }),
          col("estado", "Estado de pago", { tone: payTone, width: 14 }), col("metodos", "Métodos de pago", { width: 34, pdf: false }),
        ],
        rows, totals: { label: "Total (sin reembolsadas)", excludeKey: "estado", excludeValues: ["Reembolsada"] }, emptyText: "No hubo ventas en este período.",
      },
      {
        name: "Detalle de artículos", title: "Detalle por servicio y producto", subtitle: "Cada artículo vendido, con su especialista y la comisión estimada (sin ventas reembolsadas)",
        columns: [col("n", "Venta", { width: 17 }), col("fecha", "Fecha", { kind: "date" }), col("art", "Servicio / producto", { width: 34 }), col("cat", "Categoría", { width: 18 }), col("emp", "Especialista", { width: 22 }),
          col("imp", "Importe", { kind: "money", total: "sum" }), col("pc", "% comisión", { kind: "percent" }), col("com", "Comisión estimada", { kind: "money", total: "sum" })],
        rows: items, totals: { label: "Total" }, emptyText: "No hubo ventas en este período.",
      },
    ],
    csv: "first", pdfMaxRows: 2500,
  };
}

export type { Section };
