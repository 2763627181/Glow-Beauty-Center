import assert from "node:assert/strict";
import { test } from "node:test";
import { addTeammate, eligibleStaff, staffChoices, linesFromAppt, linesToPayload, subtotalOf, validateLines, type EditLine } from "./lines.ts";

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
  assert.deepEqual(p[0], { id: "a1", employee_id: "ana", final_price: 650, quantity: 1, parallel: false, team: null });
  assert.deepEqual(p[1], { id: "a2", employee_id: null, final_price: 400, quantity: 2, team: null }); // producto: sin horario, sin «al mismo tiempo»
  assert.deepEqual(p[2], { service_id: "s9", variant_id: "v1", employee_id: "carla", final_price: 700, quantity: 1, parallel: false, team: null });
  assert.deepEqual(p[3], { name: "Crema", employee_id: null, final_price: 250, quantity: 1 });
});

test("sumar una especialista al servicio: nueva línea a la vez, mismo equipo y precio repartido sin perder centavos", () => {
  const base: EditLine[] = [
    { key: "a", id: "a1", service_id: "s1", name: "Manicure", employee_id: "santa", final_price: 700, quantity: 1, timed: true, listPrice: 700 },
    { key: "b", id: "b1", service_id: "s2", name: "Pedicure", employee_id: "esther", final_price: 800, quantity: 1, timed: true, listPrice: 800 },
  ];
  const two = addTeammate(base, 0, "k1");
  assert.equal(two.length, 3);
  assert.deepEqual(two.map((l) => [l.name, l.final_price, l.team ?? null, !!l.parallel]), [["Manicure", 350, "eq-k1", false], ["Manicure", 350, "eq-k1", true], ["Pedicure", 800, null, false]]);
  assert.equal(two[1].employee_id, null); assert.equal(two[1].id, undefined);
  const three = addTeammate(two, 0); // una tercera: el equipo existente (700) se reparte entre 3
  assert.equal(three.length, 4);
  assert.deepEqual(three.slice(0, 3).map((l) => l.final_price), [233.34, 233.33, 233.33]);
  assert.equal(three.slice(0, 3).reduce((t, l) => t + l.final_price, 0), 700);
  assert.ok(three.slice(0, 3).every((l) => l.team === "eq-k1"));
  assert.equal(three[3].name, "Pedicure"); // el resto de líneas conserva su lugar
  assert.equal(addTeammate([{ key: "p", name: "Crema", employee_id: null, final_price: 100, quantity: 1, timed: false, listPrice: 100 }], 0).length, 1); // un producto no tiene equipo
  const payload = linesToPayload(two);
  assert.deepEqual(payload[1], { service_id: "s1", variant_id: null, employee_id: null, final_price: 350, quantity: 1, parallel: true, team: "eq-k1" });
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
