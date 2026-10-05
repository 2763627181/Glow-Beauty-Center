import assert from "node:assert/strict";
import { test } from "node:test";
import { applyClientSearch, cleanTerm, searchTokens } from "./client-search.ts";

const fake = () => { const calls: string[] = []; const b = { or: (f: string) => { calls.push(f); return b; } }; return { b, calls }; };

test("divide en palabras y limpia caracteres peligrosos para el filtro", () => {
  assert.deepEqual(searchTokens("  maria   perez "), ["maria", "perez"]);
  assert.deepEqual(searchTokens("a,b(c)%d*"), ["a", "b", "c", "d"]);
  assert.equal(searchTokens("x ".repeat(20)).length, 5);
  assert.equal(cleanTerm("a%b,c(d)*"), "a b c d");
});

test("cada palabra genera su propio .or() (AND entre palabras)", () => {
  const { b, calls } = fake();
  applyClientSearch(b, "maria perez");
  assert.equal(calls.length, 2);
  assert.ok(calls[0].includes("first_name.ilike.%maria%") && calls[0].includes("last_name.ilike.%maria%"));
  assert.ok(calls[1].includes("last_name.ilike.%perez%"));
});

test("los números buscan por teléfono normalizado solo si tienen 3+ dígitos", () => {
  const a = fake(); applyClientSearch(a.b, "809-555");
  assert.ok(a.calls[0].includes("phone_normalized.like.%809555%"));
  const c = fake(); applyClientSearch(c.b, "12");
  assert.ok(!c.calls[0].includes("phone_normalized"));
});
