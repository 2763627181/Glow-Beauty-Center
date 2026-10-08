/** Textos y reglas puras de los diálogos para eliminar registros (sin I/O). */

/** Lo que se borraría, tal como lo cuenta la función `describe_deletion` de la base de datos. */
export type DeletionInfo = {
  appointments: number; sales: number; sales_total: number; payments: number; paid_total: number;
  linked_appointments?: number; clients_with_history?: number; clients_clean?: number;
};
/** Lo que realmente se borró (resultado de las funciones `delete_*`). */
export type DeletionResult = { appointments?: number; sales?: number; payments?: number; clients?: number; skipped?: number; reopened?: number };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const join = (parts: string[]) => (parts.length <= 1 ? parts[0] ?? "" : `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}`);

/** «Se eliminaron 1 cliente, 2 citas, 1 venta y 1 pago». */
export function summarizeResult(r: DeletionResult): string {
  const parts: string[] = [];
  if (r.clients) parts.push(plural(r.clients, "cliente", "clientes"));
  if (r.appointments) parts.push(plural(r.appointments, "cita", "citas"));
  if (r.sales) parts.push(plural(r.sales, "venta", "ventas"));
  if (r.payments) parts.push(plural(r.payments, "pago", "pagos"));
  let msg = parts.length ? `Se eliminó: ${join(parts)}` : "No se eliminó nada";
  if (r.reopened) msg += `. ${plural(r.reopened, "cita volvió", "citas volvieron")} a «confirmada»`;
  if (r.skipped) msg += r.skipped === 1 ? ". 1 cliente se conservó porque tiene historial" : `. ${r.skipped} clientes se conservaron porque tienen historial`;
  return msg + ".";
}

/** ¿Hay dinero registrado entre lo que se borraría? Entonces se pide una confirmación extra. */
export const involvesMoney = (i: Pick<DeletionInfo, "sales" | "payments">) => i.sales > 0 || i.payments > 0;
