/** Traduce los códigos de error que lanzan las funciones SQL a mensajes claros para la persona que usa el sistema. */
export const ERROR_MESSAGES: Record<string, string> = {
  slot_taken: "Ese horario acaba de ocuparse. Elige otra hora.",
  appt_lines_no_overlap: "Ese horario acaba de ocuparse. Elige otra hora.",
  past_date: "No se puede agendar en el pasado.",
  service_unavailable: "Uno de los servicios ya no está disponible.",
  variant_required: "Elige una opción (por ejemplo el largo) en uno de los servicios.",
  variant_unavailable: "Una de las opciones elegidas ya no está disponible.",
  addon_unavailable: "Uno de los complementos ya no está disponible.",
  invalid_phone: "Teléfono no válido.",
  invalid_name: "Escribe el nombre.",
  employee_cannot_perform: "Esa especialista no realiza uno de los servicios.",
  employee_unavailable: "Esa especialista no está activa.",
  promotion_invalid: "La promoción ya no está disponible o no coincide con los servicios.",
  too_many_requests: "Ya hay varias solicitudes abiertas con este número. Te contactaremos pronto por WhatsApp.",
  forbidden: "No tienes permiso para esta acción.",
  overpayment: "El monto supera lo pendiente. Confirma el sobrepago para continuar.",
  invalid_amount: "Monto no válido.",
  invalid_method: "Ese método de pago no existe o está desactivado.",
  appointment_not_found: "La cita no existe.",
  appointment_closed: "La cita ya está cerrada (completada, cancelada o sin asistencia) y no se puede modificar.",
  appointment_not_completable: "Una cita cancelada o sin asistencia no se puede completar.",
  no_services: "La cita debe tener al menos un servicio.",
  no_items: "Agrega al menos un artículo.",
  invalid_item: "Revisa los artículos: nombre, cantidad y precio son obligatorios.",
  discount_exceeds_subtotal: "El descuento no puede superar el subtotal.",
  sale_voided: "Esa venta está anulada.",
  sale_not_found: "La venta no existe.",
  reason_required: "Escribe el motivo.",
  booking_not_found: "No encontramos una solicitud con ese número y teléfono. Revisa los datos.",
  booking_not_cancellable: "Esta cita ya no se puede cancelar desde aquí (está en curso, completada o cancelada).",
  booking_too_late: "Ya no es posible cancelar en línea por la política de cancelación. Escríbenos por WhatsApp.",
  client_not_found: "El cliente no existe.",
  nothing_selected: "Selecciona al menos un registro.",
  too_many_selected: "Selecciona 300 o menos a la vez.",
  invalid_kind: "No se pudo identificar qué eliminar.",
  payroll_paid: "Esa nómina ya está pagada. Reábrela si necesitas corregirla.",
  payroll_period_locked: "El período de una nómina no se puede cambiar; elimínala y crea otra.",
  payment_not_refundable: "Ese pago no se puede reembolsar.",
};

export function friendlyError(message: string | undefined | null, fallback = "No se pudo completar la acción. Intenta de nuevo."): string {
  if (!message) return fallback;
  const key = Object.keys(ERROR_MESSAGES).find((k) => message.includes(k));
  return key ? ERROR_MESSAGES[key] : fallback;
}
