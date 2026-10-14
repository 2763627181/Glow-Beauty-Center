import assert from "node:assert/strict";
import { test } from "node:test";
import { apptSubtotal, apptTotal } from "./appointment-math.ts";

const a = (o: { discount?: number; tip?: number } = {}) => ({ services: [{ final_price: 600, quantity: 1 }, { final_price: 400, quantity: 2 }], discount: o.discount ?? 0, tip: o.tip ?? 0 });

test("el total de una cita es servicios − descuento", () => {
  assert.equal(apptSubtotal(a()), 1400);
  assert.equal(apptTotal(a()), 1400);
  assert.equal(apptTotal(a({ discount: 100 })), 1300);
});

test("la propina NO entra en el total de la cita", () => {
  assert.equal(apptTotal(a({ tip: 200 })), 1400);
  assert.equal(apptTotal(a({ discount: 100, tip: 200 })), 1300);
});
