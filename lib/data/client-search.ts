/**
 * Búsqueda de clientes por varias palabras: "maria perez" encuentra a María Pérez aunque el nombre y el apellido
 * estén en columnas distintas. Cada palabra debe aparecer en nombre, apellido, correo o teléfono (Y entre palabras).
 * Se encadenan varios .or(): PostgREST los combina con AND.
 */
type OrCapable<T> = { or: (filters: string) => T };

/** Palabras de búsqueda ya saneadas (sin caracteres que rompan el filtro de PostgREST). */
export function searchTokens(raw: string): string[] {
  return raw.replace(/[%,()*\\]/g, " ").split(/\s+/).map((t) => t.trim()).filter((t) => t.length > 0).slice(0, 5);
}

export function applyClientSearch<T extends OrCapable<T>>(query: T, raw: string): T {
  let q = query;
  for (const t of searchTokens(raw)) {
    const digits = t.replace(/\D/g, "");
    const parts = [`first_name.ilike.%${t}%`, `last_name.ilike.%${t}%`, `email.ilike.%${t}%`];
    if (digits.length >= 3) parts.push(`phone_normalized.like.%${digits}%`);
    q = q.or(parts.join(","));
  }
  return q;
}

/** Texto de búsqueda saneado para usarlo dentro de un filtro .ilike de PostgREST. */
export const cleanTerm = (raw: string) => raw.replace(/[%,()*\\]/g, " ").trim();
