/**
 * Modelo común de las exportaciones (Excel, PDF y CSV salen del MISMO documento, así nunca difieren entre sí).
 * Puro: sin acceso a la base de datos ni a Next, para poder probarlo con `node --test`.
 */
import { fmtDate, fmtTime, TZ } from "../format.ts";

export const BRAND = {
  primary: "#9F4D66", blush: "#FBEEF1", cream: "#F1E8DC", ivory: "#F8F4ED", champagne: "#D3B36B",
  goldText: "#7D6428", charcoal: "#292524", text2: "#6A605D", marble: "#E7E4E1", sage: "#5B6B63", zebra: "#FBF7F3",
} as const;

/** Qué tipo de dato es una columna (decide el formato en cada archivo). */
export type Kind = "text" | "money" | "int" | "decimal" | "percent" | "date" | "datetime" | "time";
/** Color semántico de una celda (estado de la cita, estado de pago…). */
export type Tone = "ok" | "warn" | "bad" | "info" | "muted";
/** Fechas y horas viajan como texto ISO (`2026-10-05T15:00:00Z`) o `YYYY-MM-DD`. */
export type Cell = string | number | null | undefined;

export type Col = {
  key: string;
  header: string;
  kind?: Kind;
  /** Ancho aproximado en caracteres (si falta, se calcula con el contenido). */
  width?: number;
  align?: "left" | "right" | "center";
  /** Suma esta columna en la fila de totales. */
  total?: "sum";
  tone?: (v: Cell, row: Record<string, Cell>) => Tone | undefined;
  /** Dibuja una barrita proporcional en el PDF (columnas de porcentaje). */
  bar?: boolean;
  /** `false` = no se incluye en el PDF (queda en Excel y CSV, que tienen más espacio). */
  pdf?: boolean;
};

export type Section = {
  /** Nombre de la hoja de Excel (máx. 31 caracteres). */
  name: string;
  title: string;
  subtitle?: string;
  columns: Col[];
  rows: Record<string, Cell>[];
  /** Agrega la fila de totales (suma de las columnas con `total: "sum"`). */
  totals?: { label?: string; excludeKey?: string; excludeValues?: string[] };
  emptyText?: string;
  note?: string;
};

export type Kpi = { label: string; value: number | string; kind?: Kind; hint?: string };

export type Logo = { bytes: Uint8Array; mime: "image/png" | "image/jpeg"; width: number; height: number };

export type ExportDoc = {
  fileBase: string;
  title: string;
  subtitle?: string;
  business: { name: string; tagline?: string; address?: string; phone?: string; email?: string; logo?: Logo | null };
  /** ISO del momento en que se generó. */
  generatedAt: string;
  filters: [string, string][];
  kpis: Kpi[];
  sections: Section[];
  /** CSV: solo la primera tabla (datos limpios para importar) o todas las secciones apiladas. */
  csv?: "first" | "all";
  /** Máximo de filas por tabla en el PDF (el Excel y el CSV llevan todo). */
  pdfMaxRows?: number;
};

export type Format = "csv" | "xlsx" | "pdf";
export const FORMATS: Format[] = ["csv", "xlsx", "pdf"];
export const parseFormat = (v: string | null): Format => (FORMATS.includes(v as Format) ? (v as Format) : "csv");

/* ───────── Formato de valores ───────── */
const group = (n: number, decimals: number) => n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
export const num = (v: Cell) => (typeof v === "number" ? v : Number(v ?? 0) || 0);
const isEmpty = (v: Cell) => v === null || v === undefined || v === "";
const isDayOnly = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

/** `RD$ 1,500.00` (siempre dos decimales: en una tabla las cifras deben alinearse). */
export const moneyFixed = (n: number) => `RD$ ${group(n, 2)}`;

/** Texto legible para el PDF. */
export function pdfText(kind: Kind | undefined, v: Cell): string {
  if (isEmpty(v)) return "—";
  switch (kind ?? "text") {
    case "money": return moneyFixed(num(v));
    case "int": return group(num(v), 0);
    case "decimal": return group(num(v), 2);
    case "percent": return `${(num(v) * 100).toFixed(1)}%`;
    case "date": return typeof v === "string" ? fmtDate(isDayOnly(v) ? `${v}T12:00:00-04:00` : v, { day: "numeric", month: "short", year: "numeric" }) : String(v);
    case "datetime": return typeof v === "string" ? `${fmtDate(v, { day: "numeric", month: "short", year: "numeric" })}, ${fmtTime(v)}` : String(v);
    case "time": return typeof v === "string" ? fmtTime(v) : String(v);
    default: return String(v);
  }
}

/** Valor para el CSV: números como números y fechas en formato ordenable (`2026-10-05 15:00`). */
export function csvValue(kind: Kind | undefined, v: Cell): string | number {
  if (isEmpty(v)) return "";
  switch (kind ?? "text") {
    case "money": case "decimal": return Math.round(num(v) * 100) / 100;
    case "int": return num(v);
    case "percent": return `${(num(v) * 100).toFixed(1)}%`;
    case "date": return typeof v === "string" ? (isDayOnly(v) ? v : localParts(v).date) : String(v);
    case "datetime": return typeof v === "string" ? `${localParts(v).date} ${localParts(v).time}` : String(v);
    case "time": return typeof v === "string" ? localParts(v).time : String(v);
    default: return String(v);
  }
}

/** Fecha y hora en Santo Domingo como `YYYY-MM-DD` y `HH:mm`. */
export function localParts(iso: string) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return { date: `${g("year")}-${g("month")}-${g("day")}`, time: `${g("hour")}:${g("minute")}`, y: Number(g("year")), m: Number(g("month")), d: Number(g("day")), hh: Number(g("hour")), mm: Number(g("minute")) };
}

/**
 * Fecha para Excel. Excel guarda fechas sin zona horaria, así que se escribe la hora local de Santo Domingo "tal cual"
 * (3:00 PM allá se ve como 3:00 PM en la hoja, sin importar dónde se abra el archivo).
 */
export function excelDate(v: string): Date | null {
  if (isDayOnly(v)) { const [y, m, d] = v.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); }
  if (Number.isNaN(+new Date(v))) return null;
  const p = localParts(v);
  return new Date(Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm));
}

/* ───────── Totales ───────── */
export function sumColumn(sec: Section, key: string): number {
  const ex = sec.totals;
  return sec.rows.reduce((t, r) => (ex?.excludeKey && ex.excludeValues?.includes(String(r[ex.excludeKey])) ? t : t + num(r[key])), 0);
}

/** Texto seguro para el PDF: las fuentes estándar solo traen Latin-1 y algunos signos; se quitan emojis y símbolos raros. */
export function pdfSafe(s: string): string {
  return s
    .replace(/→/g, "-").replace(/←/g, "-").replace(/✓|✔/g, "Sí").replace(/✕|✗/g, "No")
    .replace(/[^ -~ -ÿ–—‘’“”•…€]/g, "")
    .replace(/\s{2,}/g, " ").trim();
}

/** Nombre de hoja válido para Excel: sin `[]:*?/\`, máx. 31 caracteres y sin repetir. */
export function sheetName(name: string, used: Set<string>): string {
  const base = name.replace(/[[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "Hoja";
  let n = base, i = 2;
  while (used.has(n.toLowerCase())) { const suffix = ` ${i++}`; n = base.slice(0, 31 - suffix.length) + suffix; }
  used.add(n.toLowerCase());
  return n;
}

export const TONE_COLORS: Record<Tone, { fg: string; bg: string }> = {
  ok: { fg: "#2F6B4F", bg: "#E4F1EA" },
  warn: { fg: "#6E561D", bg: "#F6ECD0" },
  bad: { fg: "#B3362F", bg: "#FBE9E7" },
  info: { fg: "#2B5273", bg: "#E3EDF6" },
  muted: { fg: "#5A5250", bg: "#EBE8E6" },
};

export const hexToRgb = (hex: string): [number, number, number] => {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};
