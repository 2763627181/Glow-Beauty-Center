import assert from "node:assert/strict";
import { test } from "node:test";
import { byStaffOrder, isValidStaffNumber, staffLabel, staffNumber } from "./staffLabel.ts";

test("el número lleva siempre dos cifras", () => {
  assert.equal(staffNumber(0), "00");
  assert.equal(staffNumber(1), "01");
  assert.equal(staffNumber(12), "12");
  assert.equal(staffNumber(null), "");
  assert.equal(staffNumber(undefined), "");
});

test("la etiqueta junta número y nombre; sin número queda solo el nombre", () => {
  assert.equal(staffLabel("Santa Antigua", 1), "01 · Santa Antigua");
  assert.equal(staffLabel("Martina Antigua Sierra", 2), "02 · Martina Antigua Sierra");
  assert.equal(staffLabel("Rosa María Sierra", 0), "00 · Rosa María Sierra");
  assert.equal(staffLabel("María Novas Medina", null), "María Novas Medina");
  assert.equal(staffLabel("María Novas Medina"), "María Novas Medina");
});

test("orden: manual, luego por número (sin número al final) y luego por nombre", () => {
  const list = [
    { full_name: "María", employee_number: null, display_order: 0 },
    { full_name: "Ana", employee_number: 3, display_order: 0 },
    { full_name: "Santa", employee_number: 1, display_order: 0 },
    { full_name: "Martina", employee_number: 2, display_order: 0 },
    { full_name: "Zoe", employee_number: null, display_order: 0 },
  ];
  assert.deepEqual([...list].sort(byStaffOrder).map((x) => x.full_name), ["Santa", "Martina", "Ana", "María", "Zoe"]);
  const manual = [{ full_name: "A", employee_number: 5, display_order: 2 }, { full_name: "B", employee_number: 9, display_order: 1 }];
  assert.deepEqual([...manual].sort(byStaffOrder).map((x) => x.full_name), ["B", "A"]);
});

test("número válido: entero de 0 a 99", () => {
  for (const n of [0, 1, 99]) assert.ok(isValidStaffNumber(n));
  for (const n of [-1, 100, 1.5, "3", null, undefined, Number.NaN]) assert.ok(!isValidStaffNumber(n));
});
