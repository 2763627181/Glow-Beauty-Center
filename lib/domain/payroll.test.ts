import assert from "node:assert/strict";
import { test } from "node:test";
import { computePayroll, defaultTitle, netOf, periodLabel, suggestPeriods } from "./payroll.ts";
import type { SaleIn } from "./reports.ts";

const item = (employee_id: string | null, total: number, commission_pct: number | null = null, description = "Servicio") =>
  ({ description, total, service_id: null, category_name: "", employee_id, employee_name: "", commission_pct });
const sale = (n: number, o: Partial<SaleIn> & { items: SaleIn["items"] }): SaleIn => ({
  id: `s${n}`, sale_number: `V-${n}`, completed_at: `2026-10-0${n}T15:00:00Z`, total: 0, subtotal: 0, discount: 0, tip: 0,
  payment_status: "pagado", client_id: null, client_name: "", employee_id: null, employee_name: "", payments: [], ...o,
});
const opts = { employeeCommission: { ana: 40, carla: 50 } as Record<string, number>, onlyPaid: true, includeTips: true };

test("comisión: usa el % de la línea y, si no tiene, el de la especialista", () => {
  const r = computePayroll([sale(1, { items: [item("ana", 1000, 30), item("ana", 500), item("carla", 200)] })], opts);
  assert.equal(r.get("ana")!.commission, 300 + 200); // 1000×30% + 500×40%
  assert.equal(r.get("ana")!.salesTotal, 1500);
  assert.equal(r.get("ana")!.servicesCount, 2);
  assert.equal(r.get("carla")!.commission, 100);
});

test("las ventas reembolsadas nunca cuentan; las pendientes solo si no se pide «solo cobradas»", () => {
  const sales = [
    sale(1, { items: [item("ana", 1000)] }),
    sale(2, { items: [item("ana", 1000)], payment_status: "reembolsado" }),
    sale(3, { items: [item("ana", 1000)], payment_status: "pendiente" }),
    sale(4, { items: [item("ana", 1000)], payment_status: "parcial" }),
  ];
  assert.equal(computePayroll(sales, opts).get("ana")!.salesTotal, 1000);
  assert.equal(computePayroll(sales, { ...opts, onlyPaid: false }).get("ana")!.salesTotal, 3000);
});

test("propinas: se reparten en proporción a lo que vendió cada una en esa venta", () => {
  const r = computePayroll([sale(1, { tip: 300, items: [item("ana", 600), item("carla", 300)] })], opts);
  assert.equal(r.get("ana")!.tips, 200);
  assert.equal(r.get("carla")!.tips, 100);
});

test("propinas: sin artículos con especialista, es de quien atendió la venta; sin nadie, no se asigna", () => {
  const r = computePayroll([sale(1, { tip: 100, employee_id: "ana", items: [] }), sale(2, { tip: 50, items: [] })], opts);
  assert.equal(r.get("ana")!.tips, 100);
  assert.equal(r.size, 1);
});

test("propinas: se pueden dejar fuera", () => {
  const r = computePayroll([sale(1, { tip: 300, items: [item("ana", 600)] })], { ...opts, includeTips: false });
  assert.equal(r.get("ana")!.tips, 0);
});

test("un artículo sin especialista se atribuye a quien atendió la venta; si no hay nadie, se ignora", () => {
  const r = computePayroll([sale(1, { employee_id: "carla", items: [item(null, 400)] }), sale(2, { items: [item(null, 900)] })], opts);
  assert.equal(r.get("carla")!.commission, 200);
  assert.equal(r.size, 1);
});

test("sin comisión configurada: suma ventas pero no comisión; el detalle queda ordenado por fecha", () => {
  const r = computePayroll([sale(2, { items: [item("zoe", 100, null, "B")] }), sale(1, { items: [item("zoe", 50, null, "A")] })], opts);
  const z = r.get("zoe")!;
  assert.equal(z.salesTotal, 150); assert.equal(z.commission, 0);
  assert.deepEqual(z.detail.map((d) => d.description), ["A", "B"]);
});

test("redondea a centavos sin acumular error", () => {
  const r = computePayroll([sale(1, { tip: 100, items: [item("ana", 1, 33.33), item("carla", 1), item("zoe", 1)] })], opts);
  assert.equal(r.get("ana")!.commission, 0.33);
  assert.ok(Math.abs(r.get("ana")!.tips + r.get("carla")!.tips + r.get("zoe")!.tips - 100) < 0.02);
});

test("neto = base + comisión + propinas + bonos − descuentos", () => {
  assert.equal(netOf({ base_salary: 5000, commission: 3200.5, tips: 800, bonus: 500, deductions: 1000.25 }), 8500.25);
});

test("períodos sugeridos: quincena anterior según el día del mes", () => {
  const a = suggestPeriods("2026-10-20");
  assert.deepEqual([a[0].start, a[0].end], ["2026-10-01", "2026-10-15"]);
  const b = suggestPeriods("2026-10-06");
  assert.deepEqual([b[0].start, b[0].end], ["2026-09-16", "2026-09-30"]);
  const c = suggestPeriods("2026-01-05");
  assert.deepEqual([c[0].start, c[0].end], ["2025-12-16", "2025-12-31"]);
  assert.deepEqual([c[1].start, c[1].end], ["2025-12-01", "2025-12-31"]); // mes anterior
});

test("semana anterior: de lunes a domingo", () => {
  const w = suggestPeriods("2026-10-06").find((p) => p.key === "week-prev")!; // martes
  assert.deepEqual([w.start, w.end], ["2026-09-28", "2026-10-04"]);
  const s = suggestPeriods("2026-10-04").find((p) => p.key === "week-prev")!; // domingo
  assert.deepEqual([s.start, s.end], ["2026-09-21", "2026-09-27"]);
});

test("títulos y rangos legibles", () => {
  assert.equal(defaultTitle("2026-10-01", "2026-10-15"), "Quincena 1–15 de octubre 2026");
  assert.equal(defaultTitle("2026-10-16", "2026-10-31"), "Quincena 16–31 de octubre 2026");
  assert.equal(defaultTitle("2026-02-01", "2026-02-28"), "Nómina de febrero 2026");
  assert.equal(defaultTitle("2026-10-05", "2026-10-12"), "Nómina 5–12 de octubre de 2026");
  assert.equal(periodLabel("2026-09-28", "2026-10-04"), "28 sep – 4 oct de 2026");
  assert.equal(periodLabel("2026-10-06", "2026-10-06"), "6 de octubre de 2026");
});
