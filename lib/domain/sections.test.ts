import assert from "node:assert/strict";
import { test } from "node:test";
import { matchSections, prioritize } from "./sections.ts";

const nav = [
  { href: "/admin", label: "Dashboard" }, { href: "/admin/calendar", label: "Agenda" }, { href: "/admin/clients", label: "Clientes" },
  { href: "/admin/services", label: "Servicios" }, { href: "/admin/staff", label: "Especialistas" }, { href: "/admin/manicurists", label: "Manicuristas" },
  { href: "/admin/cash", label: "Caja" }, { href: "/admin/sales", label: "Ventas" }, { href: "/admin/payroll", label: "Nómina" }, { href: "/admin/reports", label: "Reportes" },
];

test("primero Caja, Manicuristas, Clientes, Nómina y Servicios, en ese orden; el resto como estaba", () => {
  assert.deepEqual(prioritize(nav).map((i) => i.label), ["Caja", "Manicuristas", "Clientes", "Nómina", "Servicios", "Dashboard", "Agenda", "Especialistas", "Ventas", "Reportes"]);
});

test("un rol que no ve alguna de las prioritarias no se queda con huecos", () => {
  const recep = nav.filter((i) => !["/admin/manicurists", "/admin/payroll", "/admin/reports"].includes(i.href));
  assert.deepEqual(prioritize(recep).map((i) => i.label), ["Caja", "Clientes", "Servicios", "Dashboard", "Agenda", "Especialistas", "Ventas"]);
  assert.deepEqual(prioritize([] as { href: string; label: string }[]).map((i) => i.label), []);
});

test("no pierde ni repite secciones", () => {
  const out = prioritize(nav);
  assert.equal(out.length, nav.length);
  assert.equal(new Set(out.map((i) => i.href)).size, nav.length);
});

test("el buscador de secciones ignora mayúsculas y tildes y conserva el orden", () => {
  const ordered = prioritize(nav);
  assert.deepEqual(matchSections(ordered, "nomina").map((i) => i.label), ["Nómina"]);
  assert.deepEqual(matchSections(ordered, "CAJ").map((i) => i.label), ["Caja"]);
  assert.deepEqual(matchSections(ordered, "es").map((i) => i.label), ["Clientes", "Especialistas", "Reportes"]);
  assert.deepEqual(matchSections(ordered, "").map((i) => i.label), ordered.map((i) => i.label));
  assert.deepEqual(matchSections(ordered, "zzz"), []);
});
