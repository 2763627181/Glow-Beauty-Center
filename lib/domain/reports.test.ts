import assert from "node:assert/strict";
import { test } from "node:test";
import { dailySeries, resolveRange, summarize, toCSV, type SaleIn } from "./reports.ts";

const item = (o: Partial<SaleIn["items"][number]> = {}): SaleIn["items"][number] => ({
  description: "Manicure", total: 1000, service_id: "s1", category_name: "Uñas", employee_id: "e1", employee_name: "Carla", commission_pct: null, ...o,
});
const sale = (o: Partial<SaleIn> = {}): SaleIn => ({
  id: "1", sale_number: "GBC-1", completed_at: "2026-10-05T15:00:00Z", total: 1000, subtotal: 1000, discount: 0, tip: 0,
  payment_status: "pagado", client_id: "c1", client_name: "Ana", employee_id: "e1", employee_name: "Carla",
  items: [item()], payments: [{ amount: 1000, method: "efectivo", status: "pagado" }], ...o,
});

test("resume ingresos, ticket promedio y excluye ventas anuladas/reembolsadas", () => {
  const r = summarize([sale(), sale({ id: "2", total: 500 }), sale({ id: "3", total: 9000, payment_status: "reembolsado" })], []);
  assert.equal(r.revenue, 1500);
  assert.equal(r.salesCount, 2);
  assert.equal(r.avgTicket, 750);
});

test("conversión solicitudes → completadas y no-show", () => {
  const mk = (status: string) => ({ status, start_time: "2026-10-05T15:00:00Z", created_at: "2026-10-01T00:00:00Z" });
  const r = summarize([], [mk("completado"), mk("completado"), mk("cancelado"), mk("no_asistio")]);
  assert.equal(r.conversion, 0.5);
  assert.equal(r.cancelled, 1);
  assert.equal(r.noShow, 1);
});

test("ventas por especialista se reparten por línea (combo entre dos especialistas)", () => {
  const combo = sale({ total: 1700, items: [item({ total: 600, employee_id: "ana", employee_name: "Ana" }), item({ description: "Lavado", total: 1100, employee_id: "carla", employee_name: "Carla" })] });
  const r = summarize([combo], []);
  assert.deepEqual(r.byEmployee.map((x) => [x.label, x.value]), [["Carla", 1100], ["Ana", 600]]);
});

test("comisiones: usa % de la línea y, si no hay, el del especialista", () => {
  const s = sale({ total: 3000, items: [
    item({ total: 1000, employee_id: "ana", employee_name: "Ana", commission_pct: 50 }),   // 500 (% de la línea)
    item({ total: 2000, employee_id: "carla", employee_name: "Carla", commission_pct: null }), // 10% del especialista = 200
    item({ total: 400, employee_id: "otra", employee_name: "Otra", commission_pct: null }),     // sin % → no genera comisión
  ] });
  const r = summarize([s], [], { employeeCommission: { carla: 10 } });
  assert.deepEqual(r.commissions.map((x) => [x.label, x.value]), [["Ana", 500], ["Carla", 200]]);
});

test("métodos de pago usan su etiqueta configurada y el resto de categorías se agrupa", () => {
  const s = sale({ payments: [{ amount: 600, method: "zelle", status: "pagado" }, { amount: 400, method: "efectivo", status: "pagado" }, { amount: 50, method: "tarjeta", status: "reembolsado" }],
    items: [item(), item({ description: "Shampoo", category_name: "", service_id: null })] });
  const r = summarize([s], [], { methodLabels: { zelle: "Zelle" } });
  assert.deepEqual(r.byMethod.map((x) => [x.label, x.value]), [["Zelle", 600], ["efectivo", 400]]);
  assert.ok(r.byCategory.some((c) => c.label === "Productos y otros"));
});

test("propinas y descuentos se totalizan", () => {
  const r = summarize([sale({ tip: 100, discount: 50 }), sale({ id: "2", tip: 20, discount: 0 })], []);
  assert.equal(r.tips, 120);
  assert.equal(r.discounts, 50);
});

test("serie diaria rellena días vacíos y usa hora de Santo Domingo", () => {
  // 02:00 UTC del día 6 = 22:00 del día 5 en RD
  const s = dailySeries([sale({ completed_at: "2026-10-06T02:00:00Z", total: 300 })], "2026-10-06", 3);
  assert.deepEqual(s.map((x) => [x.label, x.value]), [["2026-10-04", 0], ["2026-10-05", 300], ["2026-10-06", 0]]);
});

test("rangos: hoy, mes anterior y personalizado", () => {
  const t = resolveRange("today", "2026-10-15");
  assert.equal(t.fromISO, "2026-10-15T04:00:00.000Z");
  assert.equal(t.toISO, "2026-10-16T04:00:00.000Z");
  const m = resolveRange("last_month", "2026-10-15");
  assert.equal(m.fromDay, "2026-09-01");
  assert.equal(m.toDay, "2026-09-30");
  const c = resolveRange("custom", "2026-10-15", "2026-10-01", "2026-10-10");
  assert.equal(c.toDay, "2026-10-10");
});

test("CSV escapa comas y comillas", () => {
  assert.equal(toCSV([["a", 'b,"c"']]), '﻿a,"b,""c"""');
});

test("CSV neutraliza fórmulas pero respeta números y teléfonos", () => {
  assert.equal(toCSV([['=HYPERLINK("http://x","clic")', "+1+1", "@SUM(A1)", "-cmd|' /C calc'!A0"]]),
    '﻿"\'=HYPERLINK(""http://x"",""clic"")",\'+1+1,\'@SUM(A1),\'-cmd|\' /C calc\'!A0');
  assert.equal(toCSV([["+18296198257", "-125.50", 900, -5, "829-555-7001"]]), "﻿+18296198257,-125.50,900,-5,829-555-7001");
});
