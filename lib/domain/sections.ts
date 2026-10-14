/**
 * Orden del menú del panel y del buscador de secciones. Primero las que más se usan (Caja, Manicuristas, Clientes, Nómina y Servicios,
 * en ese orden) y después el resto, en su orden de siempre. Puro, sin I/O.
 */
export const PRIORITY_HREFS = ["/admin/cash", "/admin/manicurists", "/admin/clients", "/admin/payroll", "/admin/services"] as const;

/** Pone primero las secciones prioritarias (en el orden de PRIORITY_HREFS) y deja las demás como estaban. Solo reordena las que existen. */
export function prioritize<T extends { href: string }>(items: T[], priority: readonly string[] = PRIORITY_HREFS): T[] {
  const first = priority.map((h) => items.find((i) => i.href === h)).filter((i): i is T => !!i);
  return [...first, ...items.filter((i) => !priority.includes(i.href))];
}

const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Secciones cuyo nombre contiene lo escrito (sin importar mayúsculas ni tildes). Sin texto: todas. Conserva el orden recibido. */
export function matchSections<T extends { label: string }>(items: T[], query: string): T[] {
  const q = plain(query);
  return q ? items.filter((i) => plain(i.label).includes(q)) : items;
}
