import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { BRAND, TONE_COLORS, hexToRgb, num, pdfSafe, pdfText, sumColumn, type Col, type ExportDoc, type Section } from "./model.ts";
import { fmtDate, fmtTime } from "../format.ts";

type RGB = [number, number, number];
const rgb = (hex: string): RGB => hexToRgb(hex);
const MAX_ROWS = 2500;

/** Ancho fijo (mm) de las columnas con datos cortos; el texto largo usa el espacio que sobra. */
const pdfCols = (s: Section) => s.columns.filter((c) => c.pdf !== false);
const alignOf = (c: Col): "left" | "right" | "center" =>
  c.align ?? (["money", "int", "decimal", "percent"].includes(c.kind ?? "text") ? "right" : ["date", "datetime", "time"].includes(c.kind ?? "text") ? "center" : "left");

const genText = (iso: string) => `${fmtDate(iso, { day: "numeric", month: "short", year: "numeric" })}, ${fmtTime(iso)}`;

/** PDF con formato de marca: portada con indicadores, tablas con encabezado de color, filas alternas, totales y numeración de páginas. */
export function buildPdf(doc: ExportDoc): Uint8Array {
  const landscape = doc.sections.some((s) => pdfCols(s).length > 6);
  const pdf = new jsPDF({ orientation: landscape ? "landscape" : "portrait", unit: "mm", format: "a4", compress: true });
  pdf.setProperties({ title: pdfSafe(doc.title), subject: pdfSafe(doc.subtitle ?? doc.title), author: pdfSafe(doc.business.name), creator: pdfSafe(doc.business.name) });
  const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight(), M = 14, inner = W - 2 * M;
  const TOP = 22, BOTTOM = 16;

  const text = (s: string, x: number, y: number, o?: { align?: "left" | "right" | "center"; maxWidth?: number }) => pdf.text(pdfSafe(s), x, y, o);
  const color = (c: RGB) => pdf.setTextColor(c[0], c[1], c[2]);

  /* ── Portada ── */
  pdf.setFillColor(...rgb(BRAND.blush)); pdf.rect(0, 0, W, 32, "F");
  pdf.setDrawColor(...rgb(BRAND.champagne)); pdf.setLineWidth(0.8); pdf.line(0, 32, W, 32);
  let nameX = M;
  const logo = doc.business.logo;
  if (logo) {
    const h = 17, w = Math.min(52, (logo.width / logo.height) * h);
    try { pdf.addImage(logo.bytes, logo.mime === "image/png" ? "PNG" : "JPEG", M, 7.5, w, h); nameX = M + w + 5; } catch { /* un logo dañado no debe impedir el reporte */ }
  }
  pdf.setFont("times", "bold"); pdf.setFontSize(22); color(rgb(BRAND.primary));
  text(doc.business.name, nameX, logo ? 15 : 16);
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(8); color(rgb(BRAND.text2));
  if (doc.business.tagline) text(doc.business.tagline, nameX, logo ? 21 : 22);
  const right = [doc.business.address, [doc.business.phone, doc.business.email].filter(Boolean).join("  ·  ")].filter(Boolean) as string[];
  right.forEach((line, i) => text(line, W - M, 12 + i * 4.5, { align: "right", maxWidth: inner * 0.5 }));
  text(`Generado el ${genText(doc.generatedAt)}`, W - M, 12 + right.length * 4.5 + 1, { align: "right" });

  let y = 45;
  pdf.setFont("times", "bold"); pdf.setFontSize(20); color(rgb(BRAND.charcoal));
  text(doc.title, M, y);
  if (doc.subtitle) { y += 6.5; pdf.setFont("helvetica", "normal"); pdf.setFontSize(10); color(rgb(BRAND.text2)); text(doc.subtitle, M, y); }

  // Filtros: «Etiqueta: valor» con la etiqueta en negrita, ajustados al ancho
  if (doc.filters.length) {
    y += 7; let x = M;
    pdf.setFontSize(8.5);
    for (const [k, v] of doc.filters) {
      const label = `${pdfSafe(k)}: `, val = pdfSafe(v) + "      ";
      pdf.setFont("helvetica", "bold"); const lw = pdf.getTextWidth(label);
      pdf.setFont("helvetica", "normal"); const vw = pdf.getTextWidth(val);
      if (x + lw + vw > W - M && x > M) { x = M; y += 5; }
      pdf.setFont("helvetica", "bold"); color(rgb(BRAND.charcoal)); pdf.text(label, x, y);
      pdf.setFont("helvetica", "normal"); color(rgb(BRAND.text2)); pdf.text(val, x + lw, y);
      x += lw + vw;
    }
  }

  // Indicadores (tarjetas)
  if (doc.kpis.length) {
    y += 9;
    const perRow = landscape ? 5 : 4, gap = 3, cw = (inner - gap * (perRow - 1)) / perRow, ch = 21;
    doc.kpis.forEach((k, i) => {
      if (i > 0 && i % perRow === 0) y += ch + gap;
      if (y + ch > H - BOTTOM) { pdf.addPage(); y = TOP; }
      const x = M + (i % perRow) * (cw + gap);
      pdf.setFillColor(...rgb(BRAND.ivory)); pdf.setDrawColor(...rgb(BRAND.marble)); pdf.setLineWidth(0.2);
      pdf.roundedRect(x, y, cw, ch, 2, 2, "FD");
      pdf.setFillColor(...rgb(BRAND.champagne)); pdf.rect(x, y + 3, 0.9, ch - 6, "F");
      pdf.setFont("helvetica", "bold"); pdf.setFontSize(6.5); color(rgb(BRAND.text2));
      const label = pdf.splitTextToSize(pdfSafe(k.label).toUpperCase(), cw - 7).slice(0, 2) as string[];
      label.forEach((l, li) => pdf.text(l, x + 4, y + 5 + li * 3));
      pdf.setFont("times", "bold"); pdf.setFontSize(15); color(rgb(BRAND.primary));
      text(pdfText(k.kind ?? (typeof k.value === "number" ? "int" : "text"), k.value), x + 4, y + 15, { maxWidth: cw - 6 });
      if (k.hint) { pdf.setFont("helvetica", "italic"); pdf.setFontSize(6.3); color(rgb(BRAND.text2)); text(k.hint, x + 4, y + 18.8, { maxWidth: cw - 6 }); }
    });
    y += ch;
  }

  /* ── Secciones ── */
  const maxRows = doc.pdfMaxRows ?? MAX_ROWS;
  for (const sec of doc.sections) {
    const cols = pdfCols(sec);
    // Una tabla corta no se parte entre páginas: si no cabe completa, empieza en la siguiente
    const needed = sec.rows.length <= 14 ? 40 + sec.rows.length * 7.7 : 36;
    if (y + needed > H - BOTTOM) { pdf.addPage(); y = TOP; } else y += 12;
    pdf.setFont("times", "bold"); pdf.setFontSize(14); color(rgb(BRAND.primary));
    text(sec.title, M, y);
    if (sec.subtitle) { pdf.setFont("helvetica", "normal"); pdf.setFontSize(8); color(rgb(BRAND.text2)); text(sec.subtitle, M, y + 4.6); }
    pdf.setDrawColor(...rgb(BRAND.champagne)); pdf.setLineWidth(0.3); pdf.line(M, y + (sec.subtitle ? 7 : 3), W - M, y + (sec.subtitle ? 7 : 3));
    y += sec.subtitle ? 10 : 6;

    if (!sec.rows.length) {
      pdf.setFont("helvetica", "italic"); pdf.setFontSize(9.5); color(rgb(BRAND.text2));
      text(sec.emptyText ?? "Sin datos para este período.", M, y + 6);
      y += 10;
      continue;
    }

    const shown = sec.rows.slice(0, maxRows);
    const barMax = new Map(cols.filter((c) => c.bar).map((c) => [c.key, Math.max(0.0001, ...shown.map((r) => num(r[c.key])))]));
    const showTotals = !!sec.totals && cols.some((c) => c.total);
    const widths = measureWidths(pdf, cols, shown, inner, showTotals ? sec : null);
    autoTable(pdf, {
      startY: y,
      theme: "plain",
      margin: { top: TOP, bottom: BOTTOM, left: M, right: M },
      tableWidth: inner,
      showHead: "everyPage",
      showFoot: "lastPage",
      head: [cols.map((c) => pdfSafe(c.header))],
      body: shown.map((r) => cols.map((c) => pdfSafe(pdfText(c.kind, r[c.key])))),
      foot: showTotals ? [footRow(cols, sec)] : undefined,
      styles: { font: "helvetica", fontSize: 8, textColor: rgb(BRAND.charcoal), cellPadding: { top: 2.1, bottom: 2.1, left: 2, right: 2 }, overflow: "linebreak", valign: "middle", lineColor: rgb(BRAND.marble), lineWidth: { bottom: 0.1 } },
      headStyles: { fillColor: rgb(BRAND.primary), textColor: [255, 255, 255], fontStyle: "bold", fontSize: 7.8, lineWidth: 0, cellPadding: { top: 2.8, bottom: 2.8, left: 2, right: 2 } },
      alternateRowStyles: { fillColor: rgb(BRAND.zebra) },
      footStyles: { fillColor: rgb(BRAND.cream), textColor: rgb(BRAND.charcoal), fontStyle: "bold", fontSize: 8.4, lineColor: rgb(BRAND.primary), lineWidth: { top: 0.4, bottom: 0 } },
      columnStyles: Object.fromEntries(cols.map((c, i) => [i, { halign: alignOf(c), ...(widths[i] ? { cellWidth: widths[i] } : {}) }])),
      didParseCell: (d) => {
        if (d.section === "head") { const c = cols[d.column.index]; if (c) d.cell.styles.halign = alignOf(c); return; } // el encabezado se alinea igual que sus cifras
        if (d.section !== "body") return;
        const col = cols[d.column.index], row = shown[d.row.index];
        const tone = col?.tone?.(row?.[col.key], row);
        if (tone) {
          d.cell.styles.textColor = rgb(TONE_COLORS[tone].fg); d.cell.styles.fillColor = rgb(TONE_COLORS[tone].bg);
          d.cell.styles.fontStyle = "bold"; d.cell.styles.halign = "center";
        }
      },
      didDrawCell: (d) => {
        if (d.section !== "body") return;
        const col = cols[d.column.index];
        if (!col?.bar) return;
        const v = num(shown[d.row.index]?.[col.key]) / (barMax.get(col.key) ?? 1);
        const w = Math.max(0.4, (d.cell.width - 4) * Math.min(1, v));
        pdf.setFillColor(...rgb(BRAND.champagne)); pdf.roundedRect(d.cell.x + 2, d.cell.y + d.cell.height - 1.9, w, 0.9, 0.4, 0.4, "F");
      },
    });
    y = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
    const extra = [
      sec.rows.length > shown.length ? `Se muestran las primeras ${shown.length.toLocaleString("en-US")} de ${sec.rows.length.toLocaleString("en-US")} filas (los totales incluyen todas). El Excel trae la lista completa.` : "",
      sec.note ?? "",
    ].filter(Boolean);
    if (extra.length) {
      pdf.setFont("helvetica", "italic"); pdf.setFontSize(7.8); color(rgb(BRAND.text2));
      const lines = pdf.splitTextToSize(pdfSafe(extra.join(" ")), inner) as string[];
      if (y + 4 + lines.length * 3.6 > H - BOTTOM) { pdf.addPage(); y = TOP - 4; }
      pdf.text(lines, M, y + 4.5); y += 4.5 + lines.length * 3.6;
    }
  }

  /* ── Encabezado corrido (páginas 2+) y pie con numeración (todas) ── */
  const pages = pdf.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    pdf.setPage(p);
    if (p > 1) {
      pdf.setFont("times", "bold"); pdf.setFontSize(11); color(rgb(BRAND.primary)); text(doc.business.name, M, 10);
      pdf.setFont("helvetica", "normal"); pdf.setFontSize(8); color(rgb(BRAND.text2)); text(doc.title, W - M, 10, { align: "right" });
      pdf.setDrawColor(...rgb(BRAND.champagne)); pdf.setLineWidth(0.4); pdf.line(M, 13, W - M, 13);
    }
    pdf.setDrawColor(...rgb(BRAND.marble)); pdf.setLineWidth(0.25); pdf.line(M, H - 11, W - M, H - 11);
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(7.5); color(rgb(BRAND.text2));
    text(`${doc.business.name}  ·  ${doc.title}`, M, H - 6.8);
    text(`Página ${p} de ${pages}`, W - M, H - 6.8, { align: "right" });
  }
  return new Uint8Array(pdf.output("arraybuffer"));
}

/**
 * Ancho (mm) de las columnas de datos cortos, medido con el texto real para que no se partan en dos líneas
 * («SOL-A1B2C3 / D4», «Contactand / o»). Las columnas de texto largo (servicios, nombres largos, notas…) quedan en `auto`
 * y se reparten lo que sobra. Si no cabe, primero se recortan las columnas más anchas y, si aún no alcanza, todas por igual.
 * Si TODAS son de datos cortos, se estiran para ocupar el ancho de la página.
 */
function measureWidths(pdf: jsPDF, cols: Col[], rows: Record<string, string | number | null | undefined>[], inner: number, totalsOf: Section | null): (number | undefined)[] {
  const PAD = 5.2, LONG = 24, RESERVE = 34;
  const measured = cols.map((c) => {
    pdf.setFont("helvetica", c.tone ? "bold" : "normal"); pdf.setFontSize(8);
    const cells = rows.map((r) => pdfSafe(pdfText(c.kind, r[c.key])));
    if (totalsOf && c.total) cells.push(pdfText(c.kind, sumColumn(totalsOf, c.key)));
    const longest = cells.reduce((m, s) => Math.max(m, s.length), 0);
    if (!c.width && longest > LONG) return undefined; // texto largo: auto
    const content = cells.reduce((m, s) => Math.max(m, pdf.getTextWidth(s)), 0);
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(7.8);
    const head = pdf.getTextWidth(pdfSafe(c.header)) / (c.header.includes(" ") ? 2 : 1); // el encabezado sí puede partirse en espacios
    return Math.min(46, Math.max(14, Math.ceil(Math.max(content, head) + PAD)));
  });
  const autoCount = measured.filter((w) => w === undefined).length;
  const room = inner - autoCount * RESERVE;
  const sum = () => measured.reduce<number>((t, w) => t + (w ?? 0), 0);
  if (autoCount === 0) { const k = Math.min(3.2, inner / sum()); return measured.map((w) => Math.min(72, Math.floor((w ?? 0) * k))); }
  for (const cap of [40, 34, 30]) if (sum() > room) measured.forEach((w, i) => { if (w !== undefined && w > cap) measured[i] = cap; });
  if (sum() > room) { const k = room / sum(); return measured.map((w) => (w === undefined ? undefined : Math.max(14, Math.floor(w * k)))); }
  return measured;
}

/** Fila de totales: la etiqueta ocupa todas las columnas anteriores a la primera suma (así no se parte en varias líneas). */
function footRow(cols: Col[], sec: Section) {
  const first = Math.max(1, cols.findIndex((c) => c.total));
  return [
    { content: pdfSafe(sec.totals?.label ?? `Total (${sec.rows.length})`), colSpan: first, styles: { halign: "left" as const } },
    ...cols.slice(first).map((c) => ({ content: c.total ? pdfText(c.kind, sumColumn(sec, c.key)) : "", styles: { halign: alignOf(c) } })),
  ];
}
