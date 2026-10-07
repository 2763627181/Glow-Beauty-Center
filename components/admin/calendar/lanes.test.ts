import assert from "node:assert/strict";
import { test } from "node:test";
import { layoutLanes } from "./lanes.ts";

const m = (n: number) => n * 60_000;
const b = (id: string, from: number, to: number) => ({ id, start: m(from), end: m(to) });
const pos = (list: ReturnType<typeof layoutLanes<ReturnType<typeof b>>>) => Object.fromEntries(list.map((x) => [x.id, [x.lane, x.lanes]]));

test("citas que no coinciden ocupan todo el ancho", () => {
  assert.deepEqual(pos(layoutLanes([b("a", 0, 60), b("b", 60, 120), b("c", 200, 230)])), { a: [0, 1], b: [0, 1], c: [0, 1] });
});

test("dos citas a la misma hora quedan una al lado de la otra", () => {
  assert.deepEqual(pos(layoutLanes([b("a", 0, 60), b("b", 0, 60)])), { a: [0, 2], b: [1, 2] });
});

test("tres a la vez usan tres carriles; una cuarta que empieza cuando termina una reutiliza su carril", () => {
  const r = pos(layoutLanes([b("a", 0, 60), b("b", 10, 70), b("c", 20, 80), b("d", 60, 90)]));
  assert.deepEqual(r, { a: [0, 3], b: [1, 3], c: [2, 3], d: [0, 3] });
});

test("cada grupo de citas que se tocan tiene su propio número de carriles", () => {
  const r = pos(layoutLanes([b("a", 0, 60), b("b", 30, 90), b("c", 300, 360)]));
  assert.deepEqual(r, { a: [0, 2], b: [1, 2], c: [0, 1] });
});

test("sin citas no devuelve nada y no modifica la lista original", () => {
  assert.deepEqual(layoutLanes([]), []);
  const input = [b("y", 50, 100), b("x", 0, 60)];
  layoutLanes(input);
  assert.equal(input[0].id, "y");
});
