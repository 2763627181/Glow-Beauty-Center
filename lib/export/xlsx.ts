import ExcelJS from "exceljs";
import { BRAND, TONE_COLORS, excelDate, num, pdfText, sheetName, sumColumn, type Col, type ExportDoc, type Kind, type Section } from "./model.ts";
import { fmtDate, fmtTime } from "../format.ts";

const argb = (hex: string) => `FF${hex.replace("#", "").toUpperCase()}`;
const solid = (hex: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb: argb(hex) } });
const FONT = "Calibri";
const SERIF = "Cambria";

const NUMFMT: Record<Kind, string | undefined> = {
  text: undefined, money: '"RD$" #,##0.00', int: "#,##0", decimal: "#,##0.00", percent: "0.0%",
  date: "dd/mm/yyyy", datetime: "dd/mm/yyyy h:mm AM/PM", time: "h:mm AM/PM",
};
const RIGHT: Kind[] = ["money", "int", "decimal", "percent"];
const alignOf = (c: Col): "left" | "right" | "center" => c.align ?? (RIGHT.includes(c.kind ?? "text") ? "right" : ["date", "datetime", "time"].includes(c.kind ?? "text") ? "center" : "left");
const hair = (hex: string): Partial<ExcelJS.Border> => ({ style: "hair", color: { argb: argb(hex) } });

const genText = (iso: string) => `${fmtDate(iso, { day: "numeric", month: "long", year: "numeric" })}, ${fmtTime(iso)}`;

/** Libro de Excel con formato: hoja «Resumen» + una hoja por tabla (encabezado fijo, filtros, totales con fórmula, listo para imprimir). */
export async function buildXlsx(doc: ExportDoc): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = doc.business.name; wb.lastModifiedBy = doc.business.name; wb.company = doc.business.name;
  wb.title = doc.title; wb.subject = doc.subtitle ?? doc.title; wb.created = new Date(doc.generatedAt); wb.modified = new Date(doc.generatedAt);

  const used = new Set<string>();
  const summary = wb.addWorksheet(sheetName("Resumen", used), { views: [{ showGridLines: false }], properties: { tabColor: { argb: argb(BRAND.primary) } } });
  const names = doc.sections.map((s) => sheetName(s.name, used));
  const logoId = doc.business.logo ? wb.addImage({ buffer: Buffer.from(doc.business.logo.bytes) as unknown as ExcelJS.Buffer, extension: doc.business.logo.mime === "image/png" ? "png" : "jpeg" }) : null;

  buildSummary(summary, doc, names, logoId);
  const landscapeDoc = doc.sections.some((s) => s.columns.length > 7);
  doc.sections.forEach((sec, i) => buildSection(wb.addWorksheet(names[i], { properties: { tabColor: { argb: argb(BRAND.champagne) } } }), sec, doc, landscapeDoc));

  return new Uint8Array(await wb.xlsx.writeBuffer());
}

/* ───────────────────────── Hoja «Resumen» ───────────────────────── */
function buildSummary(ws: ExcelJS.Worksheet, doc: ExportDoc, names: string[], logoId: number | null) {
  const COLS = 8;
  for (let c = 1; c <= COLS; c++) ws.getColumn(c).width = 15.5;
  const merge = (r: number, c1: number, c2: number) => { ws.mergeCells(r, c1, r, c2); return ws.getCell(r, c1); };

  // Franja de marca
  for (let r = 1; r <= 3; r++) for (let c = 1; c <= COLS; c++) ws.getCell(r, c).fill = solid(BRAND.blush);
  ws.getRow(1).height = 34; ws.getRow(2).height = 16; ws.getRow(3).height = 16;
  let nameCol = 1;
  if (logoId !== null && doc.business.logo) {
    const h = 44, w = Math.min(150, Math.round((doc.business.logo.width / doc.business.logo.height) * h));
    ws.addImage(logoId, { tl: { col: 0.15, row: 0.15 }, ext: { width: w, height: h } });
    nameCol = 3;
  }
  const name = merge(1, nameCol, COLS);
  name.value = doc.business.name; name.font = { name: SERIF, size: 22, bold: true, color: { argb: argb(BRAND.primary) } }; name.alignment = { vertical: "middle" };
  const tag = merge(2, nameCol, COLS);
  tag.value = doc.business.tagline ?? "Reporte generado por el sistema de administración"; tag.font = { name: FONT, size: 10, italic: true, color: { argb: argb(BRAND.text2) } };
  const contact = merge(3, nameCol, COLS);
  contact.value = [doc.business.address, doc.business.phone, doc.business.email].filter(Boolean).join("  ·  ");
  contact.font = { name: FONT, size: 9, color: { argb: argb(BRAND.text2) } };
  for (let c = 1; c <= COLS; c++) ws.getCell(3, c).border = { bottom: { style: "medium", color: { argb: argb(BRAND.champagne) } } };

  // Título
  ws.getRow(5).height = 26;
  const t = merge(5, 1, COLS); t.value = doc.title; t.font = { name: SERIF, size: 18, bold: true, color: { argb: argb(BRAND.charcoal) } }; t.alignment = { vertical: "middle" };
  let r = 6;
  if (doc.subtitle) { const s = merge(r++, 1, COLS); s.value = doc.subtitle; s.font = { name: FONT, size: 11, color: { argb: argb(BRAND.text2) } }; }
  const g = merge(r++, 1, COLS); g.value = `Generado el ${genText(doc.generatedAt)}`; g.font = { name: FONT, size: 9, italic: true, color: { argb: argb(BRAND.text2) } };
  r++;

  const heading = (text: string) => {
    const h = merge(r, 1, COLS); h.value = text.toUpperCase();
    h.font = { name: FONT, size: 9, bold: true, color: { argb: argb(BRAND.goldText) } };
    for (let c = 1; c <= COLS; c++) ws.getCell(r, c).border = { bottom: { style: "thin", color: { argb: argb(BRAND.champagne) } } };
    ws.getRow(r).height = 20; r++;
  };

  if (doc.filters.length) {
    heading("Filtros aplicados");
    for (const [k, v] of doc.filters) {
      const a = merge(r, 1, 2); a.value = k; a.font = { name: FONT, size: 10, bold: true, color: { argb: argb(BRAND.charcoal) } };
      const b = merge(r, 3, COLS); b.value = v; b.font = { name: FONT, size: 10, color: { argb: argb(BRAND.charcoal) } };
      r++;
    }
    r++;
  }

  if (doc.kpis.length) {
    heading("Indicadores");
    for (let i = 0; i < doc.kpis.length; i += 4) {
      const row = doc.kpis.slice(i, i + 4);
      ws.getRow(r).height = 17; ws.getRow(r + 1).height = 30; ws.getRow(r + 2).height = 15;
      row.forEach((k, j) => {
        const c1 = 1 + j * 2;
        const lab = merge(r, c1, c1 + 1); lab.value = k.label; lab.font = { name: FONT, size: 9, bold: true, color: { argb: argb(BRAND.text2) } }; lab.alignment = { vertical: "bottom", wrapText: true };
        const val = merge(r + 1, c1, c1 + 1);
        const kind = k.kind ?? (typeof k.value === "number" ? "int" : "text");
        val.value = typeof k.value === "number" ? k.value : String(k.value);
        if (typeof k.value === "number" && NUMFMT[kind]) val.numFmt = NUMFMT[kind]!;
        val.font = { name: SERIF, size: 18, bold: true, color: { argb: argb(BRAND.primary) } }; val.alignment = { horizontal: "left", vertical: "middle" };
        const hint = merge(r + 2, c1, c1 + 1); hint.value = k.hint ?? ""; hint.font = { name: FONT, size: 8, italic: true, color: { argb: argb(BRAND.text2) } };
        for (let rr = r; rr <= r + 2; rr++) for (let cc = c1; cc <= c1 + 1; cc++) {
          const cell = ws.getCell(rr, cc);
          cell.fill = solid(BRAND.ivory);
          cell.border = {
            left: cc === c1 ? { style: "thin", color: { argb: argb(BRAND.marble) } } : undefined,
            right: cc === c1 + 1 ? { style: "thin", color: { argb: argb(BRAND.marble) } } : undefined,
            top: rr === r ? { style: "thin", color: { argb: argb(BRAND.marble) } } : undefined,
            bottom: rr === r + 2 ? { style: "thin", color: { argb: argb(BRAND.marble) } } : undefined,
          };
        }
      });
      r += 4; // 3 filas de tarjeta + 1 de espacio
    }
  }

  if (doc.sections.length) {
    heading("Contenido de este archivo");
    doc.sections.forEach((sec, i) => {
      const a = merge(r, 1, 2);
      a.value = { text: names[i], hyperlink: `#'${names[i].replace(/'/g, "''")}'!A1` };
      a.font = { name: FONT, size: 10, bold: true, underline: true, color: { argb: argb(BRAND.primary) } };
      const b = merge(r, 3, 7); b.value = sec.title; b.font = { name: FONT, size: 10, color: { argb: argb(BRAND.charcoal) } };
      const n = ws.getCell(r, 8); n.value = `${sec.rows.length} fila${sec.rows.length === 1 ? "" : "s"}`; n.font = { name: FONT, size: 9, color: { argb: argb(BRAND.text2) } }; n.alignment = { horizontal: "right" };
      r++;
    });
  }

  ws.pageSetup = { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.7, header: 0.3, footer: 0.3 } };
  ws.headerFooter.oddFooter = `&L&8${doc.business.name.replace(/&/g, "&&")}&R&8Página &P de &N`;
}

/* ───────────────────────── Hoja de datos ───────────────────────── */
function buildSection(ws: ExcelJS.Worksheet, sec: Section, doc: ExportDoc, landscape: boolean) {
  const cols = sec.columns, N = cols.length, HEAD = 4, first = HEAD + 1, last = HEAD + sec.rows.length;

  // Ancho de columnas según el contenido
  cols.forEach((c, i) => {
    const longest = sec.rows.reduce((m, r) => Math.max(m, pdfText(c.kind, r[c.key]).length), 0);
    ws.getColumn(i + 1).width = c.width ?? Math.min(58, Math.max(10, Math.ceil(c.header.length * 1.1) + 3, longest + 2));
  });

  // Título y subtítulo
  ws.getRow(1).height = 30;
  ws.mergeCells(1, 1, 1, N);
  const t = ws.getCell(1, 1); t.value = sec.title; t.font = { name: SERIF, size: 16, bold: true, color: { argb: argb(BRAND.primary) } }; t.alignment = { vertical: "middle" };
  for (let c = 1; c <= N; c++) ws.getCell(1, c).border = { bottom: { style: "medium", color: { argb: argb(BRAND.champagne) } } };
  ws.mergeCells(2, 1, 2, N);
  const s = ws.getCell(2, 1);
  s.value = [sec.subtitle, doc.filters.map(([k, v]) => `${k}: ${v}`).join("  ·  ")].filter(Boolean).join("   —   ") || doc.title;
  s.font = { name: FONT, size: 9, italic: true, color: { argb: argb(BRAND.text2) } }; s.alignment = { wrapText: true, vertical: "top" };
  ws.getRow(2).height = 18; ws.getRow(3).height = 6;

  // Encabezado
  ws.getRow(HEAD).height = 28;
  cols.forEach((c, i) => {
    const cell = ws.getCell(HEAD, i + 1);
    cell.value = c.header;
    cell.fill = solid(BRAND.primary);
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { horizontal: alignOf(c) === "left" ? "left" : "center", vertical: "middle", wrapText: true };
    cell.border = { right: { style: "thin", color: { argb: argb("#B96A82") } } };
  });

  if (!sec.rows.length) {
    ws.mergeCells(first, 1, first, N);
    const e = ws.getCell(first, 1); e.value = sec.emptyText ?? "Sin datos para este período."; e.font = { name: FONT, size: 11, italic: true, color: { argb: argb(BRAND.text2) } };
    e.alignment = { horizontal: "center", vertical: "middle" }; ws.getRow(first).height = 34;
  }

  // Filas
  sec.rows.forEach((row, ri) => {
    const r = first + ri;
    const zebra = ri % 2 === 1;
    cols.forEach((c, ci) => {
      const cell = ws.getCell(r, ci + 1);
      const kind = c.kind ?? "text", v = row[c.key];
      if (v === null || v === undefined || v === "") cell.value = null;
      else if (kind === "date" || kind === "datetime" || kind === "time") cell.value = typeof v === "string" ? excelDate(v) : null;
      else if (kind === "text") cell.value = String(v);
      else cell.value = num(v);
      if (NUMFMT[kind]) cell.numFmt = NUMFMT[kind]!;
      cell.font = { name: FONT, size: 10, color: { argb: argb(BRAND.charcoal) } };
      cell.alignment = { horizontal: alignOf(c), vertical: "middle", wrapText: kind === "text" };
      if (zebra) cell.fill = solid(BRAND.zebra);
      cell.border = { bottom: hair(BRAND.marble) };
      const tone = c.tone?.(v, row);
      if (tone) {
        cell.font = { name: FONT, size: 10, bold: true, color: { argb: argb(TONE_COLORS[tone].fg) } };
        cell.fill = solid(TONE_COLORS[tone].bg);
        cell.alignment = { horizontal: "center", vertical: "middle" };
      }
    });
  });

  // Totales (fórmulas reales: si filtras, el total se recalcula)
  let end = last;
  if (sec.totals && sec.rows.length) {
    const r = last + 1; end = r; ws.getRow(r).height = 22;
    const ex = sec.totals;
    const exIdx = ex.excludeKey ? cols.findIndex((c) => c.key === ex.excludeKey) : -1;
    cols.forEach((c, ci) => {
      const cell = ws.getCell(r, ci + 1);
      cell.fill = solid(BRAND.cream);
      cell.font = { name: FONT, size: 10, bold: true, color: { argb: argb(BRAND.charcoal) } };
      cell.border = { top: { style: "thin", color: { argb: argb(BRAND.primary) } }, bottom: { style: "double", color: { argb: argb(BRAND.primary) } } };
      cell.alignment = { vertical: "middle", horizontal: ci === 0 ? "left" : alignOf(c) };
      if (ci === 0) cell.value = ex.label ?? `Total (${sec.rows.length})`;
      if (c.total) {
        const L = ws.getColumn(ci + 1).letter, range = `${L}${first}:${L}${last}`;
        let formula = `SUBTOTAL(109,${range})`;
        if (exIdx >= 0 && ex.excludeValues?.length) {
          const EL = ws.getColumn(exIdx + 1).letter, er = `$${EL}$${first}:$${EL}$${last}`;
          formula = `SUMIFS(${range},${ex.excludeValues.map((v) => `${er},"<>${v.replace(/"/g, '""')}"`).join(",")})`;
        }
        cell.value = { formula, result: Math.round(sumColumn(sec, c.key) * 100) / 100 };
        if (NUMFMT[c.kind ?? "text"]) cell.numFmt = NUMFMT[c.kind ?? "text"]!;
      }
    });
  }
  if (sec.note) {
    const r = end + 2; ws.mergeCells(r, 1, r, N);
    const n = ws.getCell(r, 1); n.value = sec.note; n.font = { name: FONT, size: 9, italic: true, color: { argb: argb(BRAND.text2) } }; n.alignment = { wrapText: true, vertical: "top" };
    ws.getRow(r).height = 28;
  }

  // Encabezado fijo, filtros e impresión
  ws.views = [{ state: "frozen", xSplit: 0, ySplit: HEAD, showGridLines: false }];
  if (sec.rows.length) ws.autoFilter = { from: { row: HEAD, column: 1 }, to: { row: last, column: N } };
  ws.pageSetup = {
    paperSize: 9, orientation: landscape || N > 7 ? "landscape" : "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    printTitlesRow: `${HEAD}:${HEAD}`, margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.7, header: 0.3, footer: 0.3 },
  };
  ws.headerFooter.oddFooter = `&L&8${doc.business.name.replace(/&/g, "&&")}  ·  ${doc.title.replace(/&/g, "&&")}&C&8&A&R&8Página &P de &N`;
}
