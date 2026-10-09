import assert from "node:assert/strict";
import { test } from "node:test";
import {
  allocatePayments, buildTimeline, cashDifference, cashEffect, categoriesFor, changeOf, commissionFromSalonPct, countDenominations, expectedCash, needsDescription, needsEmployee,
  parseCashReport, round2, salonPctFromCommission, splitProduction, suggestTenders,
} from "./cash.ts";

const cash = (value: number, key: number | string = 1) => ({ key, isCash: true, value });
const card = (value: number, key: number | string = 2) => ({ key, isCash: false, value });

test("vuelto: servicio de 1,700 pagado con 2,000 → cobra 1,700 y devuelve 300", () => {
  const t = allocatePayments([cash(2000)], 1700);
  assert.equal(t.applied, 1700);
  assert.equal(t.change, 300);
  assert.equal(t.cashReceived, 2000);
  assert.equal(t.remaining, 0);
  assert.deepEqual(t.rows[0], { key: 1, isCash: true, applied: 1700, tendered: 2000, change: 300 });
});

test("vuelto: pagar exacto no da vuelto; el efectivo recibido queda registrado", () => {
  const t = allocatePayments([cash(1500)], 1500);
  assert.equal(t.change, 0);
  assert.equal(t.applied, 1500);
  assert.equal(t.rows[0].tendered, 1500);
});

test("vuelto: si el cliente da menos, queda saldo y no hay vuelto", () => {
  const t = allocatePayments([cash(1000)], 1500);
  assert.equal(t.applied, 1000);
  assert.equal(t.change, 0);
  assert.equal(t.remaining, 500);
});

test("tarjeta o transferencia: se registra exactamente lo cobrado y no genera vuelto", () => {
  const t = allocatePayments([card(1700)], 1700);
  assert.equal(t.applied, 1700);
  assert.equal(t.change, 0);
  assert.equal(t.nonCash, 1700);
  assert.equal(t.rows[0].tendered, null);
  assert.equal(t.remaining, 0);
});

test("pago dividido: la tarjeta cubre una parte y el efectivo el resto, con vuelto sobre el efectivo", () => {
  // total 3,000: tarjeta 1,000 aparte + el cliente da 2,500 en efectivo → se aplican 2,000 y se devuelven 500
  const t = allocatePayments([card(1000), cash(2500)], 3000);
  assert.equal(t.rows[1].applied, 2000);
  assert.equal(t.rows[1].change, 500);
  assert.equal(t.applied, 3000);
  assert.equal(t.change, 500);
  assert.equal(t.remaining, 0);
});

test("pago dividido: el orden de las filas no cambia el resultado (la tarjeta siempre se respeta)", () => {
  const a = allocatePayments([cash(2500, "c"), card(1000, "t")], 3000);
  assert.equal(a.rows[0].applied, 2000);
  assert.equal(a.rows[0].change, 500);
  assert.equal(a.rows[1].applied, 1000);
});

test("dos filas de efectivo: la primera completa lo pendiente y la segunda se devuelve entera", () => {
  const t = allocatePayments([cash(2000, 1), cash(500, 2)], 1700);
  assert.equal(t.rows[0].applied, 1700);
  assert.equal(t.rows[0].change, 300);
  assert.equal(t.rows[1].applied, 0);
  assert.equal(t.rows[1].change, 500);
  assert.equal(t.change, 800);
});

test("tarjeta o transferencia por más del total se marca como exceso; el efectivo se devuelve entero", () => {
  const t = allocatePayments([card(2000), cash(300)], 1700);
  assert.equal(t.overNonCash, 300);
  assert.equal(t.rows[1].applied, 0);
  assert.equal(t.rows[1].change, 300);
  assert.equal(t.remaining, 0);
});

test("montos vacíos o negativos no suman ni dan vuelto", () => {
  const t = allocatePayments([cash(0), cash(-50, 2), card(Number.NaN, 3)], 1000);
  assert.equal(t.applied, 0);
  assert.equal(t.change, 0);
  assert.equal(t.remaining, 1000);
  assert.equal(t.rows[0].tendered, null);
});

test("nada pendiente: todo lo que da el cliente es vuelto", () => {
  const t = allocatePayments([cash(500)], 0);
  assert.equal(t.applied, 0);
  assert.equal(t.change, 500);
});

test("centavos: sin errores de coma flotante", () => {
  const t = allocatePayments([cash(0.3)], 0.1 + 0.2);
  assert.equal(t.change, 0);
  assert.equal(t.applied, 0.3);
  const u = allocatePayments([cash(100)], 99.9);
  assert.equal(u.change, 0.1);
  assert.equal(u.applied, 99.9);
  assert.equal(round2(1.005 + 0.0000001), 1.01);
});

test("atajos de efectivo: el exacto y los siguientes billetes redondos", () => {
  assert.deepEqual(suggestTenders(1700), [1700, 1800, 2000]);
  assert.deepEqual(suggestTenders(150), [150, 200, 500, 1000]);
  assert.deepEqual(suggestTenders(2000), [2000, 2100, 2500, 3000]);
  assert.deepEqual(suggestTenders(0), []);
  assert.ok(suggestTenders(99.5).every((x) => x >= 99.5));
});

test("efectivo esperado = fondo + cobrado − reembolsado + entradas − salidas", () => {
  assert.equal(expectedCash({ opening: 1000, cash_in: 2800, cash_refunds: 200, entradas: 200, salidas: 810 }), 2990);
  assert.equal(expectedCash({ opening: 0.1, cash_in: 0.2, cash_refunds: 0, entradas: 0, salidas: 0 }), 0.3);
});

test("diferencia de cierre: sobrante positivo, faltante negativo", () => {
  assert.equal(cashDifference(2965, 2990), -25);
  assert.equal(cashDifference(3000, 2990), 10);
  assert.equal(cashDifference(2990, 2990), 0);
});

test("conteo de billetes", () => {
  assert.equal(countDenominations({ 2000: 1, 500: 2, 100: 3, 1: 4 }), 3304);
  assert.equal(countDenominations({ 1000: -2, 50: 1.9 }), 50); // negativos se ignoran y las cantidades son enteras
  assert.equal(countDenominations({}), 0);
});

test("porcentaje del salón: la ficha guarda la comisión y el salón es el resto", () => {
  assert.equal(salonPctFromCommission(85), 15);
  assert.equal(commissionFromSalonPct(15), 85);
  assert.equal(salonPctFromCommission(null), null);
  assert.equal(commissionFromSalonPct(undefined), null);
  assert.equal(salonPctFromCommission(33.33), 66.67);
});

test("producción: manicurista que produjo 8,000 y paga 15% se queda con 6,800 y 1,200 son del salón", () => {
  const s = splitProduction({ production: 8000, earned: 6800, no_pct: 0, paid_out: 2000 });
  assert.equal(s.hers, 6800);
  assert.equal(s.salon, 1200);
  assert.equal(s.paidOut, 2000);
  assert.equal(s.toPay, 4800);
  assert.equal(s.overPaid, 0);
});

test("producción: lo que no tiene porcentaje configurado no se reparte", () => {
  const s = splitProduction({ production: 1000, earned: 425, no_pct: 500, paid_out: 0 });
  assert.equal(s.salon, 75);
  assert.equal(s.noPct, 500);
});

test("producción: si ya se le entregó de más, se avisa y no queda nada por pagar", () => {
  const s = splitProduction({ production: 1000, earned: 850, no_pct: 0, paid_out: 900 });
  assert.equal(s.toPay, 0);
  assert.equal(s.overPaid, 50);
});

test("movimientos: categorías por tipo y qué exige cada una", () => {
  assert.ok(categoriesFor("salida").includes("pago_especialista"));
  assert.ok(!categoriesFor("entrada").includes("gasto"));
  assert.ok(needsEmployee("pago_especialista") && needsEmployee("propina") && !needsEmployee("compra"));
  assert.ok(needsDescription("otro") && !needsDescription("gasto"));
});

test("reporte: convierte lo que manda la base en números y listas seguras", () => {
  const r = parseCashReport({
    session: { id: "s1", number: "CAJA-0001", opened_at: "2026-10-08T12:00:00Z", opening_amount: "1000.00", counted_cash: null },
    totals: { opening: 1000, cash_in: 2800, cash_refunds: 0, entradas: 0, salidas: 0, expected: 3800 },
    methods: [{ method: "efectivo", label: "Efectivo", is_cash: true, count: 4, total: 2800, refunded: 0 }],
    payments: [{ id: "p1", amount: "1700", tendered: "2000", status: "pagado", is_cash: true, paid_in_turn: true }],
  });
  assert.equal(r.session.opening_amount, 1000);
  assert.equal(r.session.counted_cash, null);
  assert.equal(r.payments[0].tendered, 2000);
  assert.equal(changeOf(r.payments[0]), 300);
  assert.deepEqual(r.movements, []);
  assert.deepEqual(r.production, []);
  assert.equal(r.sales.count, 0);
  assert.equal(parseCashReport(null).totals.expected, 0);
});

test("changeOf: sin efectivo recibido registrado no hay vuelto", () => {
  assert.equal(changeOf({ amount: 500, tendered: null }), 0);
  assert.equal(changeOf({ amount: 500, tendered: 500 }), 0);
});

test("línea de tiempo: cobros, reembolsos y movimientos juntos, lo más reciente primero", () => {
  const pay = (id: string, o: Record<string, unknown>) => ({
    id, paid_at: "2026-10-08T14:00:00Z", refunded_at: null, status: "pagado" as const, method: "efectivo", label: "Efectivo", is_cash: true, amount: 100, tendered: null,
    reference: null, sale_id: null, sale_number: null, appointment_id: null, client: null, by: null, paid_in_turn: true, refunded_in_turn: false, ...o,
  });
  const t = buildTimeline({
    payments: [
      pay("a", { paid_at: "2026-10-08T14:00:00Z" }),
      pay("b", { paid_at: "2026-10-08T15:00:00Z", method: "tarjeta", is_cash: false, amount: 800 }),
      pay("c", { paid_at: "2026-10-07T20:00:00Z", status: "reembolsado", refunded_at: "2026-10-08T16:00:00Z", paid_in_turn: false, refunded_in_turn: true, amount: 300 }),
    ],
    movements: [{ id: "m1", at: "2026-10-08T14:30:00Z", kind: "salida", category: "compra", amount: 50, description: null, employee_id: null, employee_name: null, by: null, voided_at: null, void_reason: null },
      { id: "m2", at: "2026-10-08T14:45:00Z", kind: "salida", category: "gasto", amount: 70, description: null, employee_id: null, employee_name: null, by: null, voided_at: "2026-10-08T14:50:00Z", void_reason: "error" }],
  });
  assert.deepEqual(t.map((x) => x.key), ["r-c", "c-b", "m-m2", "m-m1", "c-a"]);
  assert.deepEqual(t.map(cashEffect), [-300, 0, 0, -50, 100]);
});
