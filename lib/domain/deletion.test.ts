import assert from "node:assert/strict";
import { test } from "node:test";
import { involvesMoney, summarizeResult } from "./deletion.ts";

test("resumen de lo que se eliminó, con singular y plural", () => {
  assert.equal(summarizeResult({ appointments: 1 }), "Se eliminó: 1 cita.");
  assert.equal(summarizeResult({ clients: 1, appointments: 2, sales: 1, payments: 3 }), "Se eliminó: 1 cliente, 2 citas, 1 venta y 3 pagos.");
  assert.equal(summarizeResult({ sales: 2, payments: 1 }), "Se eliminó: 2 ventas y 1 pago.");
});

test("avisa de las citas reabiertas y de los clientes que se conservaron", () => {
  assert.equal(summarizeResult({ sales: 1, payments: 1, reopened: 1 }), "Se eliminó: 1 venta y 1 pago. 1 cita volvió a «confirmada».");
  assert.equal(summarizeResult({ clients: 1, skipped: 2 }), "Se eliminó: 1 cliente. 2 clientes se conservaron porque tienen historial.");
  assert.equal(summarizeResult({ clients: 0, skipped: 1 }), "No se eliminó nada. 1 cliente se conservó porque tiene historial.");
  assert.equal(summarizeResult({}), "No se eliminó nada.");
});

test("el dinero (ventas o pagos) exige confirmación extra", () => {
  assert.equal(involvesMoney({ sales: 0, payments: 0 }), false);
  assert.equal(involvesMoney({ sales: 1, payments: 0 }), true);
  assert.equal(involvesMoney({ sales: 0, payments: 2 }), true);
});
