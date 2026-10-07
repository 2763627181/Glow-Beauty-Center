/**
 * Equipos de especialistas en el panel: cada servicio de una cita puede tener ninguna, una o varias especialistas, y puede
 * marcarse «al mismo tiempo que el servicio anterior». Aquí se convierte esa elección en las líneas que guarda la base de
 * datos (una por especialista). Puro, sin I/O.
 *
 * - Sin especialistas: una línea sin asignar.
 * - Una: una línea.
 * - Varias: un equipo; todas empiezan a la vez y comparten la clave `team` (la base de datos reparte el precio entre ellas).
 */
export type TeamPick = { employeeIds: string[]; parallel?: boolean };
export type ExpandedLine<T> = { item: T; itemIndex: number; employeeId: string | null; parallel: boolean; team: string | null };

export function expandTeams<T extends TeamPick>(items: T[]): ExpandedLine<T>[] {
  return items.flatMap((item, k): ExpandedLine<T>[] => {
    const ids = [...new Set(item.employeeIds)];
    if (!ids.length) return [{ item, itemIndex: k, employeeId: null, parallel: k > 0 && !!item.parallel, team: null }];
    return ids.map((id, j) => ({ item, itemIndex: k, employeeId: id, parallel: j > 0 || (k > 0 && !!item.parallel), team: ids.length > 1 ? `t${k}` : null }));
  });
}
