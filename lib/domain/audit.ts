import { fmtDateTime } from "@/lib/format";
/** Presentación legible de la bitácora de auditoría (puro). */

export const ENTITY_LABEL: Record<string, string> = {
  appointments: "Citas", appointment_services: "Servicios de cita", payments: "Pagos", sales: "Ventas", services: "Servicios",
  clients: "Clientes", employees: "Especialistas", service_categories: "Categorías", service_variants: "Variantes", service_addons: "Complementos",
  promotions: "Promociones", gallery: "Galería", business_settings: "Configuración", profiles: "Usuarios", payment_methods: "Métodos de pago",
  products: "Productos", schedule_blocks: "Bloqueos", payroll_runs: "Nómina", payroll_lines: "Volantes de nómina",
};

export const ACTION_LABEL: Record<string, string> = {
  insert: "Creó", update: "Editó", delete: "Eliminó", complete_appointment: "Completó cita", void_sale: "Anuló venta", quick_sale: "Venta rápida",
};

const FIELD_LABEL: Record<string, string> = {
  status: "estado", price: "precio", final_price: "precio final", estimated_total: "total estimado", final_total: "total final", total: "total",
  discount: "descuento", tip: "propina", employee_id: "especialista", start_time: "inicio", end_time: "fin", notes: "notas", name: "nombre",
  active: "activo", amount: "monto", method: "método", payment_status: "estado de pago", duration_minutes: "duración", commission_pct: "comisión %",
  role: "rol", full_name: "nombre", phone: "teléfono", email: "correo", title: "título", category: "categoría", display_order: "orden",
  featured: "destacado", image_url: "imagen", label: "etiqueta", value: "valor", quantity: "cantidad", voided_at: "anulada",
  commission: "comisión", tips: "propinas", base_salary: "sueldo base", bonus: "bonos", deductions: "descuentos", net: "neto a pagar",
  sales_total: "ventas", services_count: "servicios", paid_on: "fecha de pago", paid_method: "método de pago", paid_reference: "referencia",
  period_start: "desde", period_end: "hasta", parallel: "al mismo tiempo que el anterior", team_id: "equipo", birth_month: "mes de cumpleaños", birth_day: "día de cumpleaños",
};
const IGNORE = new Set(["updated_at", "created_at", "id", "phone_normalized"]);

const show = (v: unknown) => {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return fmtDateTime(v);
  if (typeof v === "object") return JSON.stringify(v).slice(0, 60);
  return String(v).length > 60 ? String(v).slice(0, 57) + "…" : String(v);
};

/** Campos que cambiaron entre `before` y `after`: [{ field, from, to }]. */
export function diffRecords(before: Record<string, unknown> | null, after: Record<string, unknown> | null) {
  if (!before || !after) return [];
  return Object.keys(after)
    .filter((k) => !IGNORE.has(k) && JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    .map((k) => ({ field: FIELD_LABEL[k] ?? k, from: show(before[k]), to: show(after[k]) }));
}

/** Resumen de una línea para mostrar en la tabla. */
export function summarizeAudit(action: string, before: Record<string, unknown> | null, after: Record<string, unknown> | null): string {
  const rec = (after ?? before ?? {}) as Record<string, unknown>;
  const who = (rec.name ?? rec.full_name ?? rec.title ?? rec.sale_number ?? rec.label ?? rec.key ?? rec.description ?? "") as string;
  if (action === "update") {
    const d = diffRecords(before, after);
    return d.length ? d.slice(0, 3).map((x) => `${x.field}: ${x.from} → ${x.to}`).join(" · ") + (d.length > 3 ? ` · +${d.length - 3} más` : "") : "Sin cambios visibles";
  }
  if (action === "complete_appointment" || action === "void_sale" || action === "quick_sale") {
    const a = after ?? {};
    return [a.sale_number, a.total != null ? `RD$ ${a.total}` : "", a.reason ? `motivo: ${a.reason}` : ""].filter(Boolean).join(" · ");
  }
  return who ? String(who) : "";
}
