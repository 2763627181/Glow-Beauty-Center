import assert from "node:assert/strict";
import { test } from "node:test";
import { expandTeams } from "./teams.ts";

test("equipos del panel: ninguna, una o varias especialistas por servicio y «al mismo tiempo»", () => {
  const out = expandTeams([
    { employeeIds: ["santa", "esther"] },
    { employeeIds: ["mayra"], parallel: true },
    { employeeIds: [] },
    { employeeIds: ["santa", "santa", "luz"], parallel: false },
  ]);
  assert.deepEqual(out.map((l) => [l.itemIndex, l.employeeId, l.parallel, l.team]), [
    [0, "santa", false, "t0"], [0, "esther", true, "t0"], // equipo: la 2.ª empieza con la 1.ª
    [1, "mayra", true, null],                             // «al mismo tiempo que el anterior»
    [2, null, false, null],                               // sin especialista: queda sin asignar
    [3, "santa", false, "t3"], [3, "luz", true, "t3"],    // repetidas se ignoran
  ]);
});
