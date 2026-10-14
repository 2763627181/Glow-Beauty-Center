/**
 * Número de cada especialista (00, 01, 02…) junto a su nombre, para identificarla en el panel. Puro, sin I/O.
 * La página pública no lo usa: allí solo se muestra el nombre.
 */
export const staffNumber = (n: number | null | undefined) => (n == null ? "" : String(n).padStart(2, "0"));

/** «02 · Martina Antigua Sierra» (o solo el nombre si todavía no tiene número). */
export const staffLabel = (name: string, n?: number | null) => (n == null ? name : `${staffNumber(n)} · ${name}`);

/** Orden de las especialistas: primero por su orden manual, luego por número (las que no tienen, al final) y por último por nombre. */
export function byStaffOrder<T extends { full_name: string; employee_number?: number | null; display_order?: number | null }>(a: T, b: T): number {
  return (a.display_order ?? 0) - (b.display_order ?? 0)
    || (a.employee_number ?? 1000) - (b.employee_number ?? 1000)
    || a.full_name.localeCompare(b.full_name, "es");
}

/** Número válido para guardar: entero de 0 a 99. */
export const isValidStaffNumber = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 99;
