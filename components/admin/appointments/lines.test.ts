import assert from "node:assert/strict";
import { test } from "node:test";
import { eligibleStaff, staffChoices, linesFromAppt, linesToPayload, subtotalOf, validateLines, type EditLine } from "./lines.ts";

const src = [
  { id: "a1", service_id: "s1", name: "Manicure", price: 600, final_price: 650, quantity: 1, employee_id: "ana", start_time: "2026-10-05T14:00:00Z" },
  { id: "a2", service_id: null, name: "Shampoo", price: 400, final_price: 400, quantity: 2, employee_id: null, start_time: null },
];

test("convierte líneas existentes y distingue servicio de producto", () => {
  const l = linesFromAppt(src);
  assert.equal(l[0].timed, true);
  assert.equal(l[1].timed, false);
  assert.equal(subtotalOf(l), 650 + 800);
});

test("payload: existentes solo ajustes; nuevas por servicio o por concepto", () => {
  const lines: EditLine[] = [
    ...linesFromAppt(src),
    { key: "n1", service_id: "s9", variant_id: "v1", name: "Pedicure", employee_id: "carla", final_price: 700, quantity: 1, timed: true, listPrice: 700 },
    { key: "n2", name: " Crema ", employee_id: null, final_price: 250, quantity: 1, timed: false, listPrice: 250 },
  ];
  const p = linesToPayload(lines);
  assert.deepEqual(p[0], { id: "a1", employee_id: "ana", final_price: 650, quantity: 1 });
  assert.deepEqual(p[2], { service_id: "s9", variant_id: "v1", employee_id: "carla", final_price: 700, quantity: 1 });
  assert.deepEqual(p[3], { name: "Crema", employee_id: null, final_price: 250, quantity: 1 });
});

test("especialistas elegibles: vinculados o todos los activos", () => {
  const staff = [{ id: "ana", full_name: "Ana", active: true }, { id: "carla", full_name: "Carla", active: true }, { id: "old", full_name: "Vieja", active: false }];
  const links = [{ employee_id: "ana", service_id: "s1" }, { employee_id: "old", service_id: "s1" }];
  assert.deepEqual(eligibleStaff("s1", staff, links).map((s) => s.id), ["ana"]);
  assert.deepEqual(eligibleStaff("s2", staff, links).map((s) => s.id), ["ana", "carla"]);
  assert.deepEqual(eligibleStaff(null, staff, links).map((s) => s.id), ["ana", "carla"]);
});

test("selector de especialista: las que hacen el servicio primero y, aparte, cualquier otra activa", () => {
  const staff = [{ id: "ana", full_name: "Ana", active: true }, { id: "carla", full_name: "Carla", active: true }, { id: "old", full_name: "Vieja", active: false }];
  const links = [{ employee_id: "ana", service_id: "s1" }];
  const c = staffChoices("s1", staff, links);
  assert.deepEqual(c.usual.map((s) => s.id), ["ana"]);
  assert.deepEqual(c.others.map((s) => s.id), ["carla"]); // Carla no lo tiene marcado, pero se le puede asignar; la inactiva nunca
  assert.deepEqual(staffChoices("s2", staff, links).others, []); // sin vínculos: todas las activas ya están en la primera lista
});

test("validación local", () => {
  const ok = linesFromAppt(src);
  assert.equal(validateLines(ok), null);
  assert.match(validateLines([])!, /al menos un servicio/);
  assert.match(validateLines([ok[1]])!, /con horario/);
  assert.match(validateLines([{ ...ok[0], final_price: -1 }])!, /negativo/);
  assert.match(validateLines([{ ...ok[0], name: " " }])!, /nombre/);
  assert.match(validateLines([{ ...ok[0], quantity: 0 }])!, /cantidad/);
});
