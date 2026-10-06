/**
 * Lee TODAS las filas de una consulta (hasta `limit`) en páginas de 1,000.
 * Supabase corta cada respuesta en 1,000 filas aunque se pida `.limit(5000)`: sin paginar, los reportes y exportaciones
 * de períodos largos se quedaban cortos sin avisar. La consulta debe tener un orden estable (con desempate por id).
 */
export const PAGE = 1000;

export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  limit: number,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < limit; from += PAGE) {
    const to = Math.min(from + PAGE, limit) - 1;
    const { data, error } = await page(from, to);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if ((data?.length ?? 0) < to - from + 1) break;
  }
  return out;
}
