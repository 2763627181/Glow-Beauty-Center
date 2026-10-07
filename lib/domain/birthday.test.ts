import assert from "node:assert/strict";
import { test } from "node:test";
import { birthdayLabel, cumpleLabel, daysUntilBirthday, isValidBirthday } from "./birthday.ts";

test("fechas válidas e inválidas", () => {
  assert.ok(isValidBirthday(2, 29) && isValidBirthday(12, 31) && isValidBirthday(4, 30));
  assert.ok(!isValidBirthday(2, 30) && !isValidBirthday(4, 31) && !isValidBirthday(0, 1) && !isValidBirthday(13, 1) && !isValidBirthday(5, 0) && !isValidBirthday(5.5, 1));
});

test("etiqueta en español", () => {
  assert.equal(birthdayLabel(3, 15), "15 de marzo");
  assert.equal(birthdayLabel(10, 1), "1 de octubre");
});

test("días hasta el cumpleaños: hoy, mañana, más adelante y pasado este año", () => {
  assert.equal(daysUntilBirthday(10, 6, "2026-10-06"), 0);
  assert.equal(daysUntilBirthday(10, 7, "2026-10-06"), 1);
  assert.equal(daysUntilBirthday(10, 20, "2026-10-06"), 14);
  assert.equal(daysUntilBirthday(10, 5, "2026-10-06"), 364); // ya pasó: el del año que viene
  assert.equal(daysUntilBirthday(1, 1, "2026-12-31"), 1); // cruza de año
});

test("quien cumple el 29 de febrero se celebra el 28 si el año no es bisiesto", () => {
  assert.equal(daysUntilBirthday(2, 29, "2027-02-28"), 0); // 2027 no es bisiesto
  assert.equal(daysUntilBirthday(2, 29, "2028-02-28"), 1); // 2028 sí
  assert.equal(daysUntilBirthday(2, 29, "2028-02-29"), 0);
});

test("texto del aviso", () => {
  assert.deepEqual([0, 1, 5].map(cumpleLabel), ["Hoy", "Mañana", "En 5 días"]);
});
