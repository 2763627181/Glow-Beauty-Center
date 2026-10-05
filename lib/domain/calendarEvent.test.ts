import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCalendarEvent, type ApptForEvent } from "./calendarEvent.ts";

const appt = (o: Partial<ApptForEvent> = {}): ApptForEvent => ({
  status: "confirmado", start_time: "2026-10-05T13:00:00Z", end_time: "2026-10-05T14:40:00Z", estimated_total: 1500, notes: null,
  clients: { first_name: "María", last_name: "Pérez", phone: "829-555-0101" }, employees: null,
  appointment_services: [{ name: "Manicure", start_time: "2026-10-05T13:00:00Z", end_time: "2026-10-05T13:45:00Z", position: 0, employees: { full_name: "Ana" } }],
  ...o,
});

test("evento de una cita simple: título, especialista, hora de Santo Domingo y color de confirmada", () => {
  const e = buildCalendarEvent(appt());
  assert.equal(e.summary, "CONFIRMADA - María Pérez - Manicure");
  assert.match(e.description, /Especialista: Ana/);
  assert.match(e.description, /Hora: 9:00 AM – 10:40 AM/);
  assert.match(e.description, /Precio estimado: RD\$ 1,500/);
  assert.doesNotMatch(e.description, /Detalle:/);
  assert.equal(e.colorId, "10");
  assert.deepEqual(e.start, { dateTime: "2026-10-05T13:00:00Z", timeZone: "America/Santo_Domingo" });
});

test("combo con dos especialistas: lista quién hace qué, en el orden agendado", () => {
  const e = buildCalendarEvent(appt({
    appointment_services: [
      { name: "Lavado y Secado", start_time: "2026-10-05T13:45:00Z", end_time: "2026-10-05T14:40:00Z", position: 1, employees: { full_name: "Carla" } },
      { name: "Manicure", start_time: "2026-10-05T13:00:00Z", end_time: "2026-10-05T13:45:00Z", position: 0, employees: { full_name: "Ana" } },
    ],
  }));
  assert.equal(e.summary, "CONFIRMADA - María Pérez - Manicure, Lavado y Secado");
  assert.match(e.description, /Especialista: Ana \+ Carla/);
  assert.match(e.description, /Detalle:\n• Manicure — Ana \(9:00 AM – 9:45 AM\)\n• Lavado y Secado — Carla \(9:45 AM – 10:40 AM\)/);
});

test("sin especialista asignado y con notas", () => {
  const e = buildCalendarEvent(appt({ notes: "Uñas cortas", appointment_services: [{ name: "Pedicure", start_time: null, end_time: null, employees: null }] }));
  assert.match(e.description, /Especialista: Sin asignar/);
  assert.match(e.description, /Notas: Uñas cortas/);
});

test("usa el especialista de la cita si las líneas no lo traen; canceladas en gris; solicitudes en amarillo", () => {
  const e = buildCalendarEvent(appt({ status: "cancelado", employees: { full_name: "Luisa" }, appointment_services: [{ name: "Gel", start_time: null, end_time: null }] }));
  assert.match(e.summary, /^CANCELADA - /);
  assert.match(e.description, /Especialista: Luisa/);
  assert.equal(e.colorId, "8");
  assert.equal(buildCalendarEvent(appt({ status: "solicitud" })).colorId, "5");
  assert.match(buildCalendarEvent(appt({ status: "solicitud" })).summary, /^Solicitud - /);
});
