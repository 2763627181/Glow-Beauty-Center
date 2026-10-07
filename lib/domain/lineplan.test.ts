import assert from "node:assert/strict";
import { test } from "node:test";
import { computeSlots, toBlocks, totalMinutesOf, type EmployeeDay, type SlotInput } from "./availability.ts";
import { buildLinePlan, servicesFromAssignments } from "./lineplan.ts";

const date = "2026-10-12";
const at = (hhmm: string) => new Date(`${date}T${hhmm}:00-04:00`).getTime();
const day = (id: string, o: Partial<EmployeeDay> = {}): EmployeeDay => ({ employeeId: id, work: { start: "09:00", end: "18:00" }, busy: [], ...o });
const base: SlotInput = {
  date, businessHours: { open: "09:00", close: "18:00" }, businessBlocks: [], employees: [day("santa"), day("esther")],
  lines: [], slotMinutes: 30, now: new Date("2026-10-01T00:00:00-04:00").getTime(), minNoticeHours: 3,
};
const times = (i: SlotInput) => computeSlots(i).map((s) => s.time);

test("bloques: una línea «parallel» se une al bloque anterior y el total dura lo de la línea más larga", () => {
  const lines = [{ minutes: 45 }, { minutes: 60, parallel: true }, { minutes: 30 }];
  assert.deepEqual(toBlocks(lines), [[0, 1], [2]]);
  assert.equal(totalMinutesOf(lines), 60 + 30);
  assert.equal(totalMinutesOf([{ minutes: 45 }, { minutes: 60 }]), 105); // sin «parallel»: uno tras otro, como siempre
  assert.equal(totalMinutesOf([{ minutes: 45, parallel: true }]), 45); // la primera línea nunca es paralela
});

test("al mismo tiempo: manicure con Esther y pedicure con Santa empiezan juntas", () => {
  const s = computeSlots({ ...base, lines: [{ minutes: 45, eligible: ["esther"] }, { minutes: 60, eligible: ["santa"], parallel: true }] })[0];
  assert.equal(s.time, "09:00");
  const [a, b] = [...s.assignments].sort((x, y) => x.lineIndex - y.lineIndex);
  assert.equal(a.start, b.start);
  assert.equal(a.employeeId, "esther"); assert.equal(b.employeeId, "santa");
});

test("sin «al mismo tiempo» las mismas líneas van una tras otra (comportamiento anterior)", () => {
  const s = computeSlots({ ...base, lines: [{ minutes: 45, eligible: ["esther"] }, { minutes: 60, eligible: ["santa"] }] })[0];
  const [a, b] = [...s.assignments].sort((x, y) => x.start - y.start);
  assert.equal(b.start, a.end);
});

test("al mismo tiempo: el bloque dura lo del servicio más largo y cabe en el cierre", () => {
  const lines = [{ minutes: 45, eligible: ["esther"] }, { minutes: 120, eligible: ["santa"], parallel: true }];
  const t = times({ ...base, lines });
  assert.ok(t.includes("16:00") && !t.includes("16:30")); // 16:00 + 2 h = 18:00; 16:30 ya no cabe
});

test("al mismo tiempo: si una de las dos especialistas está ocupada ese rato, no se ofrece", () => {
  const busy = [{ start: at("10:00"), end: at("11:00") }];
  const t = times({ ...base, employees: [day("santa"), day("esther", { busy })], lines: [{ minutes: 60, eligible: ["esther"] }, { minutes: 60, eligible: ["santa"], parallel: true }] });
  assert.ok(!t.includes("10:00") && !t.includes("10:30") && t.includes("11:00") && t.includes("09:00"));
});

test("equipo: dos especialistas en el mismo servicio exigen que las dos estén libres a la vez", () => {
  const busy = [{ start: at("09:00"), end: at("10:00") }];
  const lines = [{ minutes: 60, eligible: ["santa"] }, { minutes: 60, eligible: ["esther"], parallel: true }];
  const t = times({ ...base, employees: [day("santa", { busy }), day("esther")], lines });
  assert.equal(t[0], "10:00");
});

test("una especialista no puede estar en dos líneas del mismo bloque", () => {
  const lines = [{ minutes: 60, eligible: ["santa"] }, { minutes: 60, eligible: ["santa"], parallel: true }];
  assert.equal(computeSlots({ ...base, lines }).length, 0);
  const ok = computeSlots({ ...base, lines: [{ minutes: 60, eligible: ["santa", "esther"] }, { minutes: 60, eligible: ["santa", "esther"], parallel: true }] })[0];
  assert.deepEqual(ok.assignments.map((a) => a.employeeId).sort(), ["esther", "santa"]); // «cualquiera» + «cualquiera»: reparte entre las dos
});

test("plan de líneas: sin elección cualquiera sirve; con varias elegidas forman un equipo", () => {
  const items = [{ serviceId: "mani", name: "Manicure", minutes: 45, employeeIds: [] }, { serviceId: "pedi", name: "Pedicure", minutes: 60, employeeIds: ["santa", "esther"] }];
  const p = buildLinePlan({ items, online: ["santa", "esther", "mayra"], linked: { mani: ["santa", "esther"], pedi: ["santa", "esther", "mayra"] }, parallel: false });
  assert.equal(p.error, undefined);
  assert.deepEqual(p.lines, [
    { minutes: 45, eligible: ["santa", "esther"], parallel: false },
    { minutes: 60, eligible: ["santa"], parallel: false },
    { minutes: 60, eligible: ["esther"], parallel: true },
  ]);
  assert.deepEqual(p.plan, [{ itemIndex: 0, teamKey: null }, { itemIndex: 1, teamKey: "t1" }, { itemIndex: 1, teamKey: "t1" }]);
});

test("plan de líneas: «al mismo tiempo» une cada servicio con el anterior", () => {
  const items = [{ serviceId: "mani", name: "Manicure", minutes: 45, employeeIds: ["esther"] }, { serviceId: "pedi", name: "Pedicure", minutes: 60, employeeIds: ["santa"] }];
  const p = buildLinePlan({ items, online: ["santa", "esther"], linked: {}, parallel: true });
  assert.deepEqual(p.lines.map((l) => l.parallel), [false, true]);
  assert.equal(totalMinutesOf(p.lines), 60);
});

test("plan de líneas: avisa quién no hace el servicio y cuándo nadie lo hace", () => {
  const items = [{ serviceId: "mani", name: "Manicure", minutes: 45, employeeIds: ["mayra"] }];
  const e = buildLinePlan({ items, online: ["santa", "mayra"], linked: { mani: ["santa"] }, parallel: false, nameOf: (id) => (id === "mayra" ? "Mayra" : id) });
  assert.match(e.error!, /Mayra no realiza «Manicure»/);
  const none = buildLinePlan({ items: [{ ...items[0], employeeIds: [] }], online: ["mayra"], linked: { mani: ["santa"] }, parallel: false });
  assert.match(none.error!, /Por ahora no hay una especialista disponible para «Manicure»/);
  const legacy = buildLinePlan({ items: [{ ...items[0], employeeIds: [] }], online: ["santa", "mayra"], linked: { mani: ["santa"] }, legacyEmployeeId: "mayra", parallel: false });
  assert.equal(legacy.error, "Esa especialista no realiza todos los servicios elegidos.");
});

test("de la asignación a las líneas de la cita: orden agendado, «parallel» solo desde la segunda de cada bloque y el equipo agrupado", () => {
  const items = [{ serviceId: "mani", variantId: null, addonIds: [] as string[] }, { serviceId: "pedi", variantId: "v1", addonIds: [] as string[] }];
  const plan = [{ itemIndex: 0, teamKey: null }, { itemIndex: 1, teamKey: "t1" }, { itemIndex: 1, teamKey: "t1" }];
  const out = servicesFromAssignments(
    [{ lineIndex: 2, employeeId: "esther", start: 10, end: 20 }, { lineIndex: 0, employeeId: "mayra", start: 0, end: 10 }, { lineIndex: 1, employeeId: "santa", start: 10, end: 20 }],
    plan, items);
  assert.deepEqual(out.map((s) => [s.service_id, s.employee_id, s.parallel, s.team]), [
    ["mani", "mayra", false, null], ["pedi", "santa", false, "t1"], ["pedi", "esther", true, "t1"],
  ]);
  assert.equal(out[1].variant_id, "v1");
});
