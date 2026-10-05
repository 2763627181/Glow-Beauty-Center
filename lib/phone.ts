/** Normaliza teléfonos dominicanos a 10 dígitos. Debe coincidir con public.normalize_phone. */
export function normalizePhone(input: string) {
  let d = (input ?? "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d;
}

export function isValidDRPhone(input: string) {
  return /^(809|829|849)\d{7}$/.test(normalizePhone(input));
}

/** Número para wa.me (con código de país). */
export function toWaNumber(input: string) {
  const d = normalizePhone(input);
  return d.length === 10 ? "1" + d : d;
}
