import { toCSV } from "../domain/reports.ts";
import { csvValue, sumColumn, type ExportDoc } from "./model.ts";

/** CSV (UTF-8 con BOM para que Excel respete las tildes). Una sola tabla limpia, o todas las secciones apiladas según `doc.csv`. */
export function buildCsv(doc: ExportDoc): string {
  const sections = doc.csv === "all" ? doc.sections : doc.sections.slice(0, 1);
  const rows: (string | number)[][] = [];
  if (doc.csv === "all") {
    rows.push([doc.business.name], [doc.title], ...(doc.subtitle ? [[doc.subtitle]] : []), ...doc.filters.map(([k, v]) => [k, v]), []);
    if (doc.kpis.length) rows.push(["Indicador", "Valor"], ...doc.kpis.map((k) => [k.label, csvValue(k.kind, k.value)]), []);
  }
  sections.forEach((sec, i) => {
    if (doc.csv === "all") rows.push([sec.title]);
    rows.push(sec.columns.map((c) => c.header));
    for (const r of sec.rows) rows.push(sec.columns.map((c) => csvValue(c.kind, r[c.key])));
    if (sec.totals && sec.rows.length) rows.push(sec.columns.map((c, idx) => (c.total ? Math.round(sumColumn(sec, c.key) * 100) / 100 : idx === 0 ? (sec.totals?.label ?? "Total") : "")));
    if (i < sections.length - 1) rows.push([]);
  });
  return toCSV(rows);
}
