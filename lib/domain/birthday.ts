/** Cumpleaños del personal: se guardan solo día y mes (no hace falta saber el año de nacimiento). */

export const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
/** Días máximos de cada mes (febrero admite el 29). */
export const MAX_DAY = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export const isValidBirthday = (month: number, day: number) =>
  Number.isInteger(month) && Number.isInteger(day) && month >= 1 && month <= 12 && day >= 1 && day <= MAX_DAY[month - 1];

export const birthdayLabel = (month: number, day: number) => `${day} de ${MONTHS[month - 1]}`;

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/**
 * Días que faltan para el próximo cumpleaños (0 = hoy). `today` es una fecha YYYY-MM-DD (hora de Santo Domingo).
 * Quien cumple el 29 de febrero se celebra el 28 en los años no bisiestos.
 */
export function daysUntilBirthday(month: number, day: number, today: string): number {
  const [y, m, d] = today.split("-").map(Number);
  const base = Date.UTC(y, m - 1, d);
  const occurrence = (year: number) => Date.UTC(year, month - 1, month === 2 && day === 29 && !isLeap(year) ? 28 : day);
  let t = occurrence(y);
  if (t < base) t = occurrence(y + 1);
  return Math.round((t - base) / 86_400_000);
}

export const cumpleLabel = (days: number) => (days === 0 ? "Hoy" : days === 1 ? "Mañana" : `En ${days} días`);
