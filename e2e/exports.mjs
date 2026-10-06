import { mkdirSync, writeFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { BASE, OUT, assert, expectVisible, launch, login, section, setPage, step, summary } from "./h.mjs";

/* Exportaciones: Excel, PDF y CSV de citas, clientes y reportes. Solo LEE datos (no modifica nada).
   Los archivos se guardan en e2e/shots/exports/ para poder abrirlos y revisarlos. */
const DIR = `${OUT}/exports`;
mkdirSync(DIR, { recursive: true });
const MIME = { xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", pdf: "application/pdf", csv: "text/csv" };
const EXPORTS = [
  ["citas", "/admin/appointments/export?range=all", ["Citas", "Por estado", "Por especialista", "Por servicio"]],
  ["clientes", "/admin/clients/export?", ["Clientes", "Mejores clientes", "Para reactivar"]],
  ["reporte", "/admin/reports/export?range=30d&type=resumen", ["Ventas por día", "Por servicio", "Por categoría", "Por especialista", "Métodos de pago", "Mejores clientes", "Citas por estado", "Demanda por día", "Demanda por hora"]],
  ["ventas", "/admin/reports/export?range=30d&type=ventas", ["Ventas", "Detalle de artículos"]],
];

const { browser, page, errors } = await launch();
setPage(page);
await login(page, "tmp-admin@glow.test");

section("Archivos de descarga (cada módulo en los tres formatos)");
for (const [name, url, sheets] of EXPORTS) {
  for (const format of ["xlsx", "pdf", "csv"]) {
    await step(`${name} · ${format}`, async () => {
      const res = await page.request.get(`${BASE}${url}${url.includes("?") ? "&" : "?"}format=${format}`);
      assert(res.status() === 200, "estado " + res.status());
      assert((res.headers()["content-type"] ?? "").startsWith(MIME[format]), "tipo: " + res.headers()["content-type"]);
      const disp = res.headers()["content-disposition"] ?? "";
      assert(new RegExp(`attachment; filename="glow-[^"]+\\.${format}"`).test(disp), "nombre del archivo: " + disp);
      assert((res.headers()["cache-control"] ?? "").includes("no-store"), "no debe guardarse en caché");
      const body = await res.body();
      writeFileSync(`${DIR}/${name}.${format}`, body);
      if (format === "pdf") assert(body.subarray(0, 5).toString() === "%PDF-" && body.length > 3000, "PDF inválido");
      if (format === "csv") assert(body.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), "el CSV debe llevar BOM (tildes en Excel)");
      if (format === "xlsx") {
        assert(body.subarray(0, 2).toString() === "PK", "XLSX inválido");
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(body);
        const names = wb.worksheets.map((w) => w.name);
        assert(names[0] === "Resumen" && sheets.every((s) => names.includes(s)), "hojas: " + names.join(" | "));
        for (const ws of wb.worksheets.slice(1)) assert(ws.getCell("A4").value, `la hoja «${ws.name}» no tiene encabezado`);
      }
    });
  }
}

await step("Sin permiso de reportes (recepción) no se puede descargar nada", async () => {
  const { browser: b2, page: p2 } = await launch();
  await login(p2, "tmp-recep@glow.test");
  for (const [, url] of EXPORTS) for (const f of ["xlsx", "pdf"]) assert((await p2.request.get(`${BASE}${url}${url.includes("?") ? "&" : "?"}format=${f}`)).status() === 403, "debe ser 403");
  await b2.close();
});
await step("Sin sesión tampoco se puede descargar", async () => {
  const res = await (await browser.newContext()).request.get(`${BASE}/admin/clients/export?format=xlsx`, { maxRedirects: 0 });
  assert([302, 303, 307, 308, 403].includes(res.status()), "estado " + res.status());
});

section("Botón «Exportar» en la pantalla");
const download = async (open, formatLabel) => {
  await page.getByRole("button", { name: /^Exportar/ }).click();
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), page.getByRole("button", { name: new RegExp(`^${formatLabel}`) }).first().click()]);
  const path = `${DIR}/ui-${dl.suggestedFilename()}`;
  await dl.saveAs(path);
  return { name: dl.suggestedFilename(), path };
};
await step("Citas: el menú ofrece Excel, PDF y CSV y descarga con los filtros de la pantalla", async () => {
  await page.goto(BASE + "/admin/appointments?range=all");
  await page.getByRole("button", { name: /^Exportar/ }).click();
  for (const f of ["Excel", "PDF", "CSV"]) await expectVisible(page.getByRole("button", { name: new RegExp(`^${f}`) }), `opción ${f}`);
  await page.keyboard.press("Escape");
  const x = await download(null, "Excel");
  assert(/^glow-citas-\d{4}-\d{2}-\d{2}\.xlsx$/.test(x.name), "nombre: " + x.name);
  await expectVisible(page.getByText("Archivo descargado"), "aviso de descarga");
});
await step("Clientes: descarga el PDF", async () => {
  await page.goto(BASE + "/admin/clients");
  const x = await download(null, "PDF");
  assert(/^glow-clientes-.*\.pdf$/.test(x.name), "nombre: " + x.name);
});
await step("Reportes: dos grupos (reporte completo y ventas detalladas) y respeta el rango elegido", async () => {
  await page.goto(BASE + "/admin/reports?range=7d");
  await page.getByRole("button", { name: /^Exportar/ }).click();
  await expectVisible(page.getByText("Reporte completo"), "grupo reporte"); await expectVisible(page.getByText("Ventas detalladas"), "grupo ventas");
  await page.keyboard.press("Escape");
  const x = await download(null, "Excel");
  assert(/^glow-reporte-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.xlsx$/.test(x.name), "nombre: " + x.name);
});
await step("Si el servidor falla se avisa con un mensaje claro (no se descarga una página de error)", async () => {
  await page.goto(BASE + "/admin/clients");
  await page.route("**/admin/clients/export**", (r) => r.fulfill({ status: 500, body: "boom" }));
  await page.getByRole("button", { name: /^Exportar/ }).click();
  await page.getByRole("button", { name: /^Excel/ }).click();
  await expectVisible(page.getByText("No se pudo generar el archivo"), "mensaje de error");
  await page.unroute("**/admin/clients/export**");
  const expected = errors.findIndex((e) => /status of 500/.test(e)); // el 500 de esta prueba es a propósito
  if (expected >= 0) errors.splice(expected, 1);
});

const code = summary(errors);
await browser.close();
process.exit(code);
