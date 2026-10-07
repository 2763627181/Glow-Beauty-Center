import assert from "node:assert/strict";
import { test } from "node:test";
import { computeSlots, maxDepth, type EmployeeDay, type SlotInput } from "./availability.ts";

const date = "2026-10-12"; // lunes
const at = (hhmm: string) => new Date(`${date}T${hhmm}:00-04:00`).getTime();
const ana: EmployeeDay = { employeeId: "ana", work: { start: "09:00", end: "18:00", breakStart: "13:00", breakEnd: "14:00" }, busy: [] };
const carla: EmployeeDay = { employeeId: "carla", work: { start: "09:00", end: "18:00" }, busy: [] };

const base: SlotInput = {
  date, businessHours: { open: "09:00", close: "18:00" }, businessBlocks: [], employees: [ana],
  lines: [{ minutes: 60, eligible: ["ana"] }], slotMinutes: 30,
  now: new Date("2026-10-01T00:00:00-04:00").getTime(), minNoticeHours: 3,
};
const times = (i: SlotInput) => computeSlots(i).map((s) => s.time);

test("respeta el almuerzo y el cierre", () => {
  const t = times(base);
  assert.ok(t.includes("09:00") && t.includes("14:00") && t.includes("17:00"));
  assert.ok(!t.includes("12:30")); // 12:30–13:30 cruza el almuerzo
  assert.ok(!t.includes("17:30")); // terminaría a las 18:30
});

test("no ofrece horarios que se crucen con una cita", () => {
  const t = times({ ...base, employees: [{ ...ana, busy: [{ start: at("10:00"), end: at("11:00") }] }] });
  assert.ok(!t.includes("09:30") && !t.includes("10:30"));
  assert.ok(t.includes("09:00") && t.includes("11:00"));
});

test("aplica tiempo mínimo de anticipación", () => {
  assert.equal(times({ ...base, now: at("09:00") })[0], "12:00");
});

test("negocio cerrado o bloqueado no devuelve horarios", () => {
  assert.equal(times({ ...base, businessHours: null }).length, 0);
  assert.equal(times({ ...base, businessBlocks: [{ start: at("00:00"), end: at("23:59") }] }).length, 0);
});

test("'cualquier especialista': asigna a quien esté libre", () => {
  const i = { ...base, employees: [{ ...ana, busy: [{ start: at("09:00"), end: at("12:00") }] }, carla], lines: [{ minutes: 60, eligible: ["ana", "carla"] }] };
  const first = computeSlots(i)[0];
  assert.equal(first.time, "09:00");
  assert.equal(first.assignments[0].employeeId, "carla");
});

test("reparte la carga: prefiere al especialista menos ocupado", () => {
  const i = { ...base, employees: [{ ...ana, busy: [{ start: at("15:00"), end: at("17:30") }] }, carla], lines: [{ minutes: 30, eligible: ["ana", "carla"] }] };
  assert.equal(computeSlots(i)[0].assignments[0].employeeId, "carla");
});

test("COMBO: uñas con Ana + cabello con Carla se agendan en secuencia", () => {
  const i = { ...base, employees: [ana, carla], lines: [{ minutes: 45, eligible: ["ana"] }, { minutes: 60, eligible: ["carla"] }] };
  const s = computeSlots(i)[0];
  assert.equal(s.time, "09:00");
  assert.deepEqual(s.assignments.map((a) => [a.lineIndex, a.employeeId]), [[0, "ana"], [1, "carla"]]);
  assert.equal(s.assignments[0].end, s.assignments[1].start); // sin hueco
  assert.equal(s.assignments[1].end - s.assignments[0].start, 105 * 60_000);
});

test("COMBO: Carla ocupada 09:45–10:45 → el primer horario válido es 10:00 (Ana y luego Carla)", () => {
  const i = { ...base, employees: [ana, { ...carla, busy: [{ start: at("09:45"), end: at("10:45") }] }],
    lines: [{ minutes: 45, eligible: ["ana"] }, { minutes: 60, eligible: ["carla"] }] };
  const first = computeSlots(i)[0];
  assert.equal(first.time, "10:00");
  assert.deepEqual(first.assignments.map((a) => a.employeeId), ["ana", "carla"]);
  for (const s of computeSlots(i)) for (const a of s.assignments.filter((x) => x.employeeId === "carla")) {
    assert.ok(a.end <= at("09:45") || a.start >= at("10:45")); // nunca pisa el bloqueo
  }
});

test("COMBO: prueba el orden inverso cuando es el único que cabe", () => {
  // Carla solo libre hasta las 10:00. Orden original (Ana 09:00–09:45, Carla 09:45–10:45) choca; inverso (Carla 09:00–10:00, Ana 10:00–10:45) cabe.
  const i = { ...base, employees: [ana, { ...carla, busy: [{ start: at("10:00"), end: at("18:00") }] }],
    lines: [{ minutes: 45, eligible: ["ana"] }, { minutes: 60, eligible: ["carla"] }] };
  const first = computeSlots(i)[0];
  assert.equal(first.time, "09:00");
  assert.deepEqual(first.assignments.map((a) => [a.lineIndex, a.employeeId]), [[1, "carla"], [0, "ana"]]);
  assert.equal(first.assignments[0].end, first.assignments[1].start);
});

test("COMBO: un mismo especialista no se pisa a sí mismo entre líneas", () => {
  const i = { ...base, employees: [ana], lines: [{ minutes: 60, eligible: ["ana"] }, { minutes: 60, eligible: ["ana"] }] };
  const s = computeSlots(i);
  assert.ok(s.length > 0);
  for (const slot of s) assert.equal(slot.assignments[0].end, slot.assignments[1].start);
  // 2 h seguidas en una jornada con almuerzo 13–14: 12:00 no cabe
  assert.ok(!s.some((x) => x.time === "12:00"));
});

test("COMBO: sin nadie que haga una de las líneas no hay horarios", () => {
  const i = { ...base, employees: [ana], lines: [{ minutes: 45, eligible: ["ana"] }, { minutes: 60, eligible: ["carla"] }] };
  assert.equal(computeSlots(i).length, 0);
});

test("COMBO largo: respeta almuerzo y cierre (8 h en total)", () => {
  const i = { ...base, employees: [ana, carla], lines: [{ minutes: 240, eligible: ["ana"] }, { minutes: 240, eligible: ["carla"] }] };
  // 09:00 → Ana 09:00–13:00 (justo antes del almuerzo), Carla 13:00–17:00 · 10:00 → Carla 10:00–14:00, Ana 14:00–18:00
  assert.deepEqual(computeSlots(i).map((s) => [s.time, s.assignments.map((a) => a.employeeId).join(">")]), [["09:00", "ana>carla"], ["10:00", "carla>ana"]]);
});

// ───────────── Citas simultáneas (varias a la misma hora con la misma especialista) ─────────────
const iv = (a: string, b: string) => ({ start: at(a), end: at(b) });

test("maxDepth: cuenta las citas que coinciden en un mismo instante (extremos semiabiertos)", () => {
  assert.equal(maxDepth([], at("09:00"), at("10:00")), 0);
  assert.equal(maxDepth([iv("09:00", "10:00")], at("09:00"), at("10:00")), 1);
  assert.equal(maxDepth([iv("09:00", "10:00"), iv("09:30", "10:30")], at("09:00"), at("11:00")), 2);
  assert.equal(maxDepth([iv("09:00", "10:00"), iv("10:00", "11:00")], at("09:00"), at("11:00")), 1); // seguidas, no coinciden
  assert.equal(maxDepth([iv("09:00", "10:00")], at("10:00"), at("11:00")), 0); // termina justo cuando empieza el tramo
});

test("por defecto una especialista atiende una cita a la vez (comportamiento anterior)", () => {
  const t = times({ ...base, employees: [{ ...ana, booked: [iv("10:00", "11:00")] }] });
  assert.ok(!t.includes("10:00") && !t.includes("10:30") && t.includes("11:00") && t.includes("09:00"));
});

test("con tope 2, una hora con una cita sigue ofreciéndose; con dos ya no", () => {
  const one = times({ ...base, maxConcurrent: 2, employees: [{ ...ana, booked: [iv("10:00", "11:00")] }] });
  assert.ok(one.includes("10:00") && one.includes("10:30"));
  const two = times({ ...base, maxConcurrent: 2, employees: [{ ...ana, booked: [iv("10:00", "11:00"), iv("10:00", "11:00")] }] });
  assert.ok(!two.includes("10:00") && !two.includes("10:30") && two.includes("11:00"));
});

test("el tope mide coincidencias reales: dos citas seguidas no cuentan como dos a la vez", () => {
  const t = times({ ...base, maxConcurrent: 2, employees: [{ ...ana, booked: [iv("10:00", "10:30"), iv("10:30", "11:00")] }] });
  assert.ok(t.includes("10:00")); // 10:00–11:00 coincide con una sola cita en cada instante
});

test("tope 0 = sin límite: la hora se ofrece aunque la especialista ya tenga muchas citas", () => {
  const many = Array.from({ length: 8 }, () => iv("10:00", "11:00"));
  const t = times({ ...base, maxConcurrent: 0, employees: [{ ...ana, booked: many }] });
  assert.ok(t.includes("10:00") && t.includes("10:30"));
  const capped = times({ ...base, maxConcurrent: 8, employees: [{ ...ana, booked: many }] });
  assert.ok(!capped.includes("10:00"));
});

test("los bloqueos y ausencias no se pueden compartir aunque el tope sea alto", () => {
  const t = times({ ...base, maxConcurrent: 5, employees: [{ ...ana, busy: [iv("10:00", "11:00")] }] });
  assert.ok(!t.includes("10:00") && !t.includes("10:30"));
});

test("con tope alto la carga sigue repartiéndose: prefiere a quien tiene menos citas", () => {
  const i = { ...base, maxConcurrent: 3, employees: [{ ...ana, booked: [iv("15:00", "17:30")] }, carla], lines: [{ minutes: 30, eligible: ["ana", "carla"] }] };
  assert.equal(computeSlots(i)[0].assignments[0].employeeId, "carla");
});
