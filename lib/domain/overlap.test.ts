import assert from "node:assert/strict";
import { test } from "node:test";
import { findOverlaps, lineSpans } from "./overlap.ts";

const T = new Date("2026-10-07T10:00:00-04:00").getTime();
const min = (n: number) => T + n * 60_000;
const names = new Map([["ana", "Ana"], ["carla", "Carla"]]);

test("lineSpans: las líneas se agendan una tras otra y las que no tienen especialista ocupan tiempo pero no cuentan", () => {
  const s = lineSpans(T, [{ employeeId: "ana", minutes: 30 }, { employeeId: null, minutes: 15 }, { employeeId: "carla", minutes: 60 }]);
  assert.deepEqual(s, [{ employeeId: "ana", start: min(0), end: min(30) }, { employeeId: "carla", start: min(45), end: min(105) }]);
});

test("findOverlaps: avisa de las citas que coinciden con la misma especialista", () => {
  const mine = lineSpans(T, [{ employeeId: "ana", minutes: 60 }]);
  const r = findOverlaps(mine, [
    { employeeId: "ana", start: min(30), end: min(90), client: "Rosa Pérez", appointmentId: "a1" },
    { employeeId: "ana", start: min(60), end: min(120), client: "Otra", appointmentId: "a2" }, // empieza justo cuando terminas: no coincide
    { employeeId: "carla", start: min(0), end: min(60), client: "Luz", appointmentId: "a3" }, // otra especialista
  ], names);
  assert.equal(r.length, 1);
  assert.equal(r[0].employee, "Ana");
  assert.deepEqual(r[0].others.map((o) => o.client), ["Rosa Pérez"]);
});

test("findOverlaps: ignora la propia cita (al reprogramar) y no repite una cita con varias líneas", () => {
  const mine = lineSpans(T, [{ employeeId: "ana", minutes: 120 }]);
  const r = findOverlaps(mine, [
    { employeeId: "ana", start: min(0), end: min(60), client: "Yo misma", appointmentId: "self" },
    { employeeId: "ana", start: min(10), end: min(40), client: "Rosa", appointmentId: "a1" },
    { employeeId: "ana", start: min(40), end: min(70), client: "Rosa", appointmentId: "a1" },
  ], names, "self");
  assert.deepEqual(r[0].others.map((o) => o.client), ["Rosa"]);
});

test("findOverlaps: sin coincidencias devuelve una lista vacía", () => {
  assert.deepEqual(findOverlaps(lineSpans(T, [{ employeeId: "ana", minutes: 30 }]), [], names), []);
});
