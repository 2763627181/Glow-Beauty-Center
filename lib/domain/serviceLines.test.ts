import assert from "node:assert/strict";
import { test } from "node:test";
import { groupLines, serviceNames, uniqueDescriptions } from "./serviceLines.ts";

const L = (id: string, name: string, price: number, emp: string, team: string | null = null, qty = 1) =>
  ({ id, name, final_price: price, quantity: qty, employee_name: emp, team_id: team });

test("un equipo se muestra como un solo servicio con el precio completo y todas sus especialistas", () => {
  const g = groupLines([L("1", "Manicure", 300, "Santa", "t1"), L("2", "Manicure", 300, "Esther", "t1"), L("3", "Pedicure", 700, "Santa")]);
  assert.equal(g.length, 2);
  assert.deepEqual([g[0].name, g[0].price, g[0].employees], ["Manicure", 600, ["Santa", "Esther"]]);
  assert.equal(g[0].lines.length, 2);
  assert.deepEqual([g[1].name, g[1].price, g[1].employees], ["Pedicure", 700, ["Santa"]]);
});

test("el mismo servicio contratado dos veces SIN equipo sigue siendo dos servicios", () => {
  assert.deepEqual(serviceNames([L("1", "Manicure", 600, "Santa"), L("2", "Manicure", 600, "Esther")]), ["Manicure", "Manicure"]);
});

test("las especialistas no se repiten y se conserva el orden de la cita", () => {
  const g = groupLines([L("1", "Tinte", 100, "Ana", "t"), L("2", "Tinte", 100, "Ana", "t"), L("3", "Tinte", 100, "Luz", "t")]);
  assert.deepEqual(g[0].employees, ["Ana", "Luz"]);
  assert.equal(g[0].price, 300);
});

test("líneas sin id (Google Calendar) también se agrupan", () => {
  const g = groupLines([{ name: "Manicure", team_id: "x", employee_name: "A" }, { name: "Manicure", team_id: "x", employee_name: "B" }, { name: "Corte" }]);
  assert.deepEqual(g.map((x) => x.name), ["Manicure", "Corte"]);
});

test("ventas: un equipo cuenta como un solo servicio en la descripción", () => {
  assert.deepEqual(uniqueDescriptions([{ description: "Manicure", team_id: "t" }, { description: "Manicure", team_id: "t" }, { description: "Corte", team_id: null }, { description: "Corte", team_id: null }]), ["Manicure", "Corte", "Corte"]);
});
