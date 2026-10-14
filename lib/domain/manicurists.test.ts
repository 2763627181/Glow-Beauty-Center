import assert from "node:assert/strict";
import { test } from "node:test";
import { buildManicurists, isManicurist, monthLabel, monthRange, parseMonth, shiftMonth, type ManiEmployee } from "./manicurists.ts";
import type { SaleIn } from "./reports.ts";

const emp = (id: string, o: Partial<ManiEmployee> = {}): ManiEmployee => ({ id, full_name: id, active: true, specialty: "manicurista", base_salary: 14000, commission_pct: 15, ...o });
const item = (employee_id: string | null, total: number, description = "Manicure", extra: Record<string, unknown> = {}) =>
  ({ description, total, service_id: null, category_name: "", employee_id, employee_name: "", commission_pct: null, ...extra });
let n = 0;
const sale = (items: SaleIn["items"], o: Partial<SaleIn> = {}): SaleIn => {
  n += 1;
  return { id: `s${n}`, sale_number: `V-${n}`, completed_at: `2026-10-0${(n % 9) + 1}T15:00:00Z`, total: 0, subtotal: 0, discount: 0, tip: 0, payment_status: "pagado", client_id: null, client_name: "Cliente " + n, employee_id: null, employee_name: "", payments: [], items, ...o };
};

test("se reconoce a una manicurista por su especialidad (con o sin tildes y mayúsculas)", () => {
  assert.ok(isManicurist("manicurista"));
  assert.ok(isManicurist(" Manicurista "));
  assert.ok(isManicurist("MANICURE y pedicure"));
  assert.ok(!isManicurist("Estilista "));
  assert.ok(!isManicurist(null));
  assert.ok(!isManicurist(""));
});

test("una venta sin cliente se muestra como «Mostrador»", () => {
  const [m] = buildManicurists([sale([item("m", 100)], { client_name: "—" })], [emp("m")], { onlyPaid: true });
  assert.equal(m.lines[0].client, "Mostrador");
});

test("sueldo fijo 14,000 + 15 % de lo que cobró por sus servicios", () => {
  const r = buildManicurists([sale([item("m", 450, "Pintura de pies"), item("m", 1500, "Soft Gel")]), sale([item("m", 700, "Pedicure")])], [emp("m")], { onlyPaid: true });
  assert.equal(r.length, 1);
  assert.equal(r[0].services, 3);
  assert.equal(r[0].charged, 2650);
  assert.equal(r[0].commission, 397.5); // 15 % de 2,650
  assert.equal(r[0].salary, 14000);
  assert.equal(r[0].payable, 14397.5);
  assert.equal(r[0].lines.length, 3);
  assert.equal(r[0].lines[0].commission, 67.5);
});

test("cada línea dice qué servicio, a quién y cuánto se cobró", () => {
  const [m] = buildManicurists([sale([item("m", 450, "Pintura de pies")], { client_name: "Laura Gómez" })], [emp("m")], { onlyPaid: true });
  assert.equal(m.lines[0].description, "Pintura de pies");
  assert.equal(m.lines[0].client, "Laura Gómez");
  assert.equal(m.lines[0].total, 450);
  assert.equal(m.lines[0].pct, 15);
});

test("solo cuentan las ventas cobradas por completo; las pendientes se muestran pero no suman (salvo que se pida)", () => {
  const sales = [sale([item("m", 1000)]), sale([item("m", 800)], { payment_status: "pendiente" }), sale([item("m", 400)], { payment_status: "parcial" })];
  const [a] = buildManicurists(sales, [emp("m")], { onlyPaid: true });
  assert.equal(a.services, 1);
  assert.equal(a.commission, 150);
  assert.equal(a.pendingServices, 2);
  assert.equal(a.pendingAmount, 1200);
  assert.equal(a.lines.length, 3);
  assert.equal(a.lines.find((l) => l.status === "pendiente")!.commission, 0);
  assert.equal(a.lines.find((l) => l.status === "pendiente")!.commissionIfPaid, 120);
  const [b] = buildManicurists(sales, [emp("m")], { onlyPaid: false });
  assert.equal(b.services, 3);
  assert.equal(b.commission, 330);
});

test("las ventas anuladas o reembolsadas nunca cuentan ni aparecen", () => {
  const [m] = buildManicurists([sale([item("m", 1000)], { payment_status: "reembolsado" }), sale([item("m", 500)])], [emp("m")], { onlyPaid: false });
  assert.equal(m.lines.length, 1);
  assert.equal(m.commission, 75);
});

test("lo de otras especialistas y los productos sin especialista no se mezcla", () => {
  const r = buildManicurists([sale([item("m", 500), item("e", 900, "Corte"), item(null, 300, "Shampoo")])], [emp("m"), emp("e", { specialty: "Estilista" })], { onlyPaid: true });
  assert.equal(r.length, 1);
  assert.equal(r[0].charged, 500);
});

test("la venta rápida «atendió» cuenta cuando la línea no tiene especialista", () => {
  const [m] = buildManicurists([sale([item(null, 600)], { employee_id: "m" })], [emp("m")], { onlyPaid: true });
  assert.equal(m.charged, 600);
});

test("un servicio con su propio porcentaje manda sobre el de la ficha", () => {
  const [m] = buildManicurists([sale([item("m", 1000, "Especial", { commission_pct: 30 })])], [emp("m")], { onlyPaid: true });
  assert.equal(m.commission, 300);
  assert.equal(m.lines[0].pct, 30);
});

test("sin porcentaje configurado se avisa y la comisión queda en 0", () => {
  const [m] = buildManicurists([sale([item("m", 1000)])], [emp("m", { commission_pct: null })], { onlyPaid: true });
  assert.equal(m.missingPct, true);
  assert.equal(m.commission, 0);
  assert.equal(m.payable, 14000);
  assert.equal(m.pct, null);
});

test("servicio compartido por varias: se marca y cuenta solo su parte", () => {
  const [m] = buildManicurists([sale([item("m", 300, "Manicure", { team_id: "t1" })])], [emp("m")], { onlyPaid: true });
  assert.equal(m.lines[0].shared, true);
  assert.equal(m.charged, 300);
  assert.equal(m.commission, 45);
});

test("sin servicios en el mes: aparece con su sueldo; una inactiva sin servicios no aparece", () => {
  const r = buildManicurists([], [emp("m"), emp("x", { active: false })], { onlyPaid: true });
  assert.deepEqual(r.map((x) => x.employeeId), ["m"]);
  assert.equal(r[0].payable, 14000);
  assert.equal(r[0].services, 0);
});

test("una inactiva que sí tuvo servicios en el mes sigue apareciendo", () => {
  const r = buildManicurists([sale([item("x", 500)])], [emp("x", { active: false })], { onlyPaid: true });
  assert.equal(r.length, 1);
});

test("centavos: cada línea se redondea y el total es la suma de lo que se ve en la tabla", () => {
  const [m] = buildManicurists([sale([item("m", 333.33)]), sale([item("m", 0.1)]), sale([item("m", 0.2)])], [emp("m")], { onlyPaid: true });
  assert.equal(m.commission, 50.05); // 50.00 + 0.02 + 0.03
  assert.equal(m.commission, Math.round(m.lines.reduce((s, l) => s + l.commission, 0) * 100) / 100);
});

test("meses: etiqueta, anterior/siguiente, rango y validación", () => {
  assert.equal(monthLabel("2026-10"), "octubre de 2026");
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.deepEqual(monthRange("2026-12"), { from: "2026-12-01", to: "2027-01-01" });
  assert.equal(parseMonth("2026-13", "2026-10"), "2026-10");
  assert.equal(parseMonth("2026-09", "2026-10"), "2026-09");
  assert.equal(parseMonth(undefined, "2026-10"), "2026-10");
  assert.equal(parseMonth(["2026-09"], "2026-10"), "2026-10");
});
