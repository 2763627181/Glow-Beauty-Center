import assert from "node:assert/strict";
import { test } from "node:test";
import ExcelJS from "exceljs";
import type { ApptRow } from "../data/appointments.ts";
import { fetchAll } from "../data/paginate.ts";
import type { SaleIn } from "../domain/reports.ts";
import { buildCsv } from "./csv.ts";
import { appointmentsDoc, clientsDoc, reportDoc, salesDoc, type ClientExportRow } from "./docs.ts";
import { imageSize } from "./image.ts";
import { csvValue, excelDate, pdfSafe, pdfText, sheetName, sumColumn, type ExportDoc } from "./model.ts";
import { buildPdf } from "./pdf.ts";
import { buildXlsx } from "./xlsx.ts";

const ctx = { business: { name: "Glow Beauty Center", tagline: "Tu momento.", address: "Plaza Andalucía II, Santo Domingo", phone: "+1 (829) 619-8257" }, generatedAt: "2026-10-06T14:00:00Z" };

const appt = (o: { n: string; total: number; status: ApptRow["status"]; paid?: number; notes?: string }): ApptRow => ({
  id: o.n, request_number: o.n, status: o.status, source: "website", start_time: "2026-10-07T13:00:00Z", end_time: "2026-10-07T14:30:00Z", appointment_date: "2026-10-07",
  estimated_total: o.total, final_total: null, discount: 0, tip: 0, notes: o.notes ?? null, employee_id: null, client_id: "c1", created_at: "2026-10-05T12:00:00Z", promotion_id: null,
  client: { id: "c1", first_name: "María", last_name: "Pérez", phone: "829-555-0101", email: null }, employee: null, employees: [{ id: "e1", name: "Ana" }],
  services: [{ id: "s1", service_id: null, variant_id: null, name: "Manicure", price: o.total, final_price: o.total, duration_minutes: 45, span_minutes: null, quantity: 1, addons: [], employee_id: "e1", employee_name: "Ana", start_time: null, end_time: null, position: 0 }],
  paid: o.paid ?? 0,
}) as ApptRow;

const apptItems = [
  appt({ n: "SOL-1", status: "completado", total: 1000, paid: 1000 }),
  appt({ n: "SOL-2", status: "confirmado", total: 600 }),
  appt({ n: "SOL-3", status: "cancelado", total: 5000 }),
  appt({ n: "SOL-4", status: "no_asistio", total: 700, notes: "Escribió ✨ muy tarde" }),
];

test("formato de valores: dinero con dos decimales, fechas en hora de Santo Domingo y CSV ordenable", () => {
  assert.equal(pdfText("money", 1275.5), "RD$ 1,275.50");
  assert.equal(pdfText("percent", 0.1234), "12.3%");
  assert.equal(pdfText("date", "2026-10-07T01:30:00Z"), "6 oct 2026"); // 9:30 PM del día 6 en Santo Domingo
  assert.equal(pdfText("time", "2026-10-07T13:00:00Z"), "9:00 AM");
  assert.equal(pdfText("text", null), "—");
  assert.equal(csvValue("datetime", "2026-10-07T13:00:00Z"), "2026-10-07 09:00");
  assert.equal(csvValue("money", 10.005), 10.01);
  assert.equal(excelDate("2026-10-07T13:00:00Z")?.toISOString(), "2026-10-07T09:00:00.000Z"); // la hora local se escribe «tal cual»
  assert.equal(pdfSafe("Hola ✨ María → ñandú ✓"), "Hola María - ñandú Sí");
  assert.deepEqual([sheetName("Citas: hoy/ayer?", new Set()), sheetName("A".repeat(40), new Set())], ["Citas hoy ayer", "A".repeat(31)]);
  const used = new Set<string>(); sheetName("Datos", used);
  assert.equal(sheetName("datos", used), "datos 2");
});

test("documento de citas: totales sin canceladas ni no asistió, pendiente en cero para las cerradas", () => {
  const doc = appointmentsDoc(apptItems, ctx, { range: "upcoming", limit: 3000 });
  const sec = doc.sections[0];
  assert.equal(sec.rows.length, 4);
  assert.equal(sumColumn(sec, "total"), 1600);
  assert.equal(sec.rows.find((r) => r.n === "SOL-3")?.pend, 0);
  assert.equal(sec.rows.find((r) => r.n === "SOL-2")?.pend, 600);
  assert.equal(doc.kpis.find((k) => k.label === "Ingresos esperados")?.value, 1600);
  assert.equal(doc.sections.find((s) => s.name === "Por estado")?.rows.length, 4);
  assert.match(doc.subtitle ?? "", /Próximas · 4 resultados/);
});

test("CSV de citas: una sola tabla con números como números y fila de totales", () => {
  const csv = buildCsv(appointmentsDoc(apptItems, ctx, { range: "all", limit: 3000 }));
  const lines = csv.replace(/^﻿/, "").split("\r\n");
  assert.equal(lines[0].startsWith("Solicitud,Fecha,Hora"), true);
  assert.equal(lines.length, 1 + 4 + 1); // encabezado + citas + totales
  assert.match(lines[1], /^SOL-1,2026-10-07,9:00 AM – 10:30 AM/);
  assert.match(lines.at(-1)!, /^Total \(sin canceladas ni no asistió\)/);
});

test("Excel: hojas, encabezado fijo, filtros, tipos reales, formatos y totales con fórmula", async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await buildXlsx(appointmentsDoc(apptItems, ctx, { range: "all", limit: 3000 }))) as unknown as ArrayBuffer);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ["Resumen", "Citas", "Por estado", "Por especialista", "Por servicio"]);
  const ws = wb.getWorksheet("Citas")!;
  assert.equal(ws.getCell("A4").value, "Solicitud");
  assert.equal(ws.getCell("A5").value, "SOL-1");
  assert.ok(ws.getCell("B5").value instanceof Date, "la fecha debe ser una fecha real");
  assert.match(ws.getCell("B5").numFmt ?? "", /dd\/mm\/yyyy/);
  const header = ws.getRow(4).values as unknown[];
  const iTotal = header.indexOf("Total");
  assert.equal(typeof (ws.getRow(5).values as unknown[])[iTotal], "number");
  assert.match(ws.getCell(5, iTotal).numFmt ?? "", /RD\$/);
  assert.equal(ws.views[0].state, "frozen");
  assert.equal((ws.views[0] as { ySplit?: number }).ySplit, 4);
  assert.ok(ws.autoFilter, "debe tener filtros");
  const tot = ws.getCell(9, iTotal).value as { formula: string; result: number };
  assert.match(tot.formula, /^SUMIFS\(/);
  assert.equal(tot.result, 1600);
  assert.equal(ws.getCell(9, 1).value, "Total (sin canceladas ni no asistió)");
  const resumen = wb.getWorksheet("Resumen")!;
  assert.equal(resumen.getCell("A1").value, "Glow Beauty Center");
  const texts: string[] = [];
  resumen.eachRow((r) => r.eachCell((c) => { if (typeof c.value === "string") texts.push(c.value); }));
  assert.ok(texts.includes("Citas y solicitudes") && texts.includes("Rango"));
});

test("PDF: documento válido, varias páginas con muchas filas y sin romperse con emojis", () => {
  const many = Array.from({ length: 120 }, (_, i) => appt({ n: `SOL-${i}`, status: i % 3 ? "completado" : "confirmado", total: 500 + i, notes: "✨🌸" }));
  const pdf = buildPdf(appointmentsDoc(many, ctx, { range: "all", limit: 3000 }));
  assert.equal(Buffer.from(pdf.subarray(0, 8)).toString("latin1").startsWith("%PDF-"), true);
  const pages = Buffer.from(pdf).toString("latin1").match(/\/Type\s*\/Page\b/g)?.length ?? 0;
  assert.ok(pages >= 4, `páginas: ${pages}`);
  assert.ok(buildPdf(appointmentsDoc([], ctx, { range: "all", limit: 3000 })).length > 2000);
});

test("clientes: mejores clientes, reactivación a 90 días y ticket promedio", () => {
  const c = (o: Partial<ClientExportRow> & { first_name: string }): ClientExportRow => ({ last_name: "X", phone: "829-555-0000", email: null, active: true, created_at: "2026-01-01T12:00:00Z", visits: 0, total_spent: 0, last_visit: null, next_appointment: null, cancellations: 0, no_shows: 0, ...o });
  const doc = clientsDoc([
    c({ first_name: "Ana", visits: 4, total_spent: 4000, last_visit: "2026-09-20T15:00:00Z" }),
    c({ first_name: "Bea", visits: 2, total_spent: 9000, last_visit: "2026-05-01T15:00:00Z" }),
    c({ first_name: "Cora", visits: 1, total_spent: 500, last_visit: "2026-04-01T15:00:00Z", active: false }),
    c({ first_name: "Dina" }),
  ], ctx);
  assert.equal(doc.sections[0].rows.find((r) => r.cliente === "Ana X")?.ticket, 1000);
  assert.equal(doc.sections[0].rows.find((r) => r.cliente === "Dina X")?.ticket, null);
  assert.deepEqual(doc.sections[1].rows.map((r) => r.cliente), ["Bea X", "Ana X", "Cora X"]);
  assert.deepEqual(doc.sections[2].rows.map((r) => r.cliente), ["Bea X"]); // Cora está inactiva; Ana vino hace poco
  assert.equal(doc.kpis.find((k) => k.label === "Gasto promedio por cliente")?.value, 13500 / 3);
});

const sale = (o: { n: string; total: number; completed_at?: string; payment_status?: string }): SaleIn => ({
  id: o.n, sale_number: o.n, completed_at: o.completed_at ?? "2026-10-02T15:00:00Z", total: o.total, subtotal: o.total, discount: 0, tip: 0, payment_status: o.payment_status ?? "pagado",
  client_id: "c1", client_name: "María Pérez", employee_id: "e1", employee_name: "Ana",
  items: [{ description: "Manicure", total: o.total, service_id: "s1", category_name: "Uñas", employee_id: "e1", employee_name: "Ana", commission_pct: null }],
  payments: [{ amount: o.total, method: "efectivo", status: "pagado" }],
});

test("reporte y ventas detalladas: ingresos, porcentajes, comisiones y reembolsos fuera de los totales", () => {
  const sales = [sale({ n: "GBC-1", total: 1000 }), sale({ n: "GBC-2", total: 3000, completed_at: "2026-10-03T15:00:00Z" }), sale({ n: "GBC-3", total: 800, payment_status: "reembolsado" })];
  const range = { fromDay: "2026-10-01", toDay: "2026-10-05", label: "Personalizado" };
  const refs = { employeeCommission: { e1: 10 }, methodLabels: { efectivo: "Efectivo" } };
  const rep = reportDoc(range, sales, [{ status: "completado", start_time: "2026-10-02T15:00:00Z", created_at: "2026-10-01T12:00:00Z" }], refs, ctx);
  assert.equal(rep.kpis.find((k) => k.label === "Ingresos totales")?.value, 4000);
  const days = rep.sections[0].rows;
  assert.equal(days.length, 5);
  assert.equal(days.find((r) => r.f === "2026-10-03")?.v, 3000);
  assert.equal(rep.sections.find((s) => s.name === "Por especialista")?.rows[0].c, 400);
  assert.equal(rep.sections.find((s) => s.name === "Por servicio")?.rows[0].p, 1);
  assert.equal(rep.csv, "all");
  const det = salesDoc(range, sales, refs, ctx);
  assert.equal(det.sections[0].rows.length, 3);
  assert.equal(sumColumn(det.sections[0], "total"), 4000); // la reembolsada no suma
  assert.equal(det.sections[1].rows.length, 2); // sin artículos de ventas reembolsadas
  assert.equal(sumColumn(det.sections[1], "com"), 400);
  assert.equal(det.sections[0].rows[0].metodos, "Efectivo RD$ 1,000.00");
});

test("imageSize reconoce PNG y JPEG y rechaza lo demás", () => {
  const png = new Uint8Array(33); png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); new DataView(png.buffer).setUint32(16, 320); new DataView(png.buffer).setUint32(20, 120);
  assert.deepEqual(imageSize(png), { mime: "image/png", width: 320, height: 120 });
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x78, 0x01, 0x40, 0x03, 0x01, 0x11, 0x00]);
  assert.deepEqual(imageSize(jpg), { mime: "image/jpeg", width: 320, height: 120 });
  assert.equal(imageSize(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])), null);
});

test("fetchAll junta todas las páginas aunque el servidor corte en 1,000", async () => {
  const total = 2350, calls: [number, number][] = [];
  const rows = await fetchAll(async (from, to) => { calls.push([from, to]); return { data: Array.from({ length: Math.max(0, Math.min(to + 1, total) - from) }, (_, i) => from + i), error: null }; }, 5000);
  assert.equal(rows.length, total);
  assert.equal(new Set(rows).size, total);
  assert.deepEqual(calls, [[0, 999], [1000, 1999], [2000, 2999]]);
  const capped = await fetchAll(async (from, to) => ({ data: Array.from({ length: to - from + 1 }, (_, i) => from + i), error: null }), 1500);
  assert.equal(capped.length, 1500);
  await assert.rejects(fetchAll(async () => ({ data: null, error: { message: "boom" } }), 10), /boom/);
});

test("el documento vacío también se exporta (Excel y PDF) con el mensaje de «sin datos»", async () => {
  const doc: ExportDoc = appointmentsDoc([], ctx, { range: "all", limit: 3000 });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await buildXlsx(doc)) as unknown as ArrayBuffer);
  assert.equal(wb.getWorksheet("Citas")!.getCell("A5").value, "No hay citas con estos filtros.");
  assert.ok(buildPdf(doc).length > 1000);
});
