/** Reparte en carriles las citas que coinciden en el tiempo para dibujarlas una al lado de la otra (sin esconder ninguna). */

export type Span = { start: number; end: number }; // ms
export type Laned<T> = T & { lane: number; lanes: number };

/**
 * Cada bloque recibe su carril (0, 1, 2…) y la cantidad de carriles de su grupo de bloques que se tocan entre sí.
 * Los bloques que no coinciden con ninguno conservan un solo carril a todo el ancho.
 */
export function layoutLanes<T extends Span>(items: T[]): Laned<T>[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Laned<T>[] = [];
  let group: Laned<T>[] = [];
  let groupEnd = -Infinity;
  let laneEnds: number[] = [];

  const flush = () => {
    for (const g of group) g.lanes = laneEnds.length;
    out.push(...group);
    group = []; laneEnds = []; groupEnd = -Infinity;
  };

  for (const it of sorted) {
    if (group.length && it.start >= groupEnd) flush();
    let lane = laneEnds.findIndex((e) => e <= it.start);
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(it.end); } else laneEnds[lane] = it.end;
    group.push({ ...it, lane, lanes: 1 });
    groupEnd = Math.max(groupEnd, it.end);
  }
  flush();
  return out;
}
