export const TZ = "America/Santo_Domingo";
export const LOCALE = "es-DO";

export function money(n: number | string | null | undefined) {
  const v = Number(n ?? 0);
  // Enteros sin decimales (RD$ 1,500); con centavos siempre dos cifras (RD$ 1,275.50)
  const cents = Math.round(v * 100) % 100 !== 0;
  return "RD$ " + v.toLocaleString("en-US", { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: 2 });
}

export function duration(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/*
 * Fechas y horas con formato PROPIO. Los datos de idioma de Intl cambian entre Node y cada navegador
 * ("oct" vs "oct."), y esa diferencia provoca errores de hidratación (React #418) en componentes que se
 * pintan en el servidor y en el cliente. Aquí el texto es idéntico en todos los entornos.
 */
const MONTH_LONG = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MONTH_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const DAY_LONG = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const DAY_SHORT = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

/** Año, mes, día y día de la semana en hora de Santo Domingo. */
function dateParts(iso: string) {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso)).split("-").map(Number);
  return { y, m, d, wd: new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay() };
}

export type DateOpts = { weekday?: "short" | "long"; day?: "numeric"; month?: "short" | "long"; year?: "numeric" };

/** "5 de octubre de 2026", "lunes, 5 de octubre", "5 oct", "octubre de 2026"… */
export function fmtDate(iso: string, o: DateOpts = { day: "numeric", month: "long", year: "numeric" }) {
  const { y, m, d, wd } = dateParts(iso);
  const day = o.day ? String(d) : "";
  let core = o.month === "long" ? `${day ? `${day} de ` : ""}${MONTH_LONG[m - 1]}` : o.month === "short" ? `${day ? `${day} ` : ""}${MONTH_SHORT[m - 1]}` : day;
  if (o.year) core = o.month === "long" ? `${core} de ${y}` : core ? `${core} ${y}` : String(y);
  if (o.weekday) core = `${o.weekday === "long" ? DAY_LONG[wd] : DAY_SHORT[wd]}${core ? `, ${core}` : ""}`;
  return core;
}

/** "9:00 AM" */
export function fmtTime(iso: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TZ }).formatToParts(new Date(iso));
  const h = Number(parts.find((p) => p.type === "hour")!.value);
  const m = parts.find((p) => p.type === "minute")!.value;
  return `${h % 12 || 12}:${m} ${h >= 12 ? "PM" : "AM"}`;
}

/** "5 oct, 9:00 AM" (agrega el año si no es el actual). */
export function fmtDateTime(iso: string) {
  const sameYear = dateParts(iso).y === dateParts(new Date().toISOString()).y;
  return `${fmtDate(iso, sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" })}, ${fmtTime(iso)}`;
}

/** "09:00" → "9:00 AM" */
export function hhmmTo12(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

/** YYYY-MM-DD de hoy en Santo Domingo. */
export function todayISO() {
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ });
}

/** Convierte "YYYY-MM-DD" + "HH:mm" (hora de Santo Domingo, UTC-4 sin DST) a ISO UTC. */
export function drToISO(date: string, time: string) {
  return new Date(`${date}T${time}:00-04:00`).toISOString();
}
