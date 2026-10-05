import { isValidDRPhone } from "../phone.ts";

/**
 * Validación ligera de los datos de la clienta para el navegador (sin Zod: la página de reservas pesa menos).
 * Los mensajes y reglas son los mismos de `bookingSchema`, que sigue siendo la validación definitiva en el servidor.
 */
export function validateBookingDetails(d: { firstName: string; lastName: string; phone: string; email?: string }): Record<string, string> {
  const errors: Record<string, string> = {};
  if (d.firstName.trim().length < 2) errors.firstName = "Escribe tu nombre";
  if (d.lastName.trim().length < 2) errors.lastName = "Escribe tu apellido";
  if (!isValidDRPhone(d.phone)) errors.phone = "Escribe un WhatsApp válido (ej. 809-555-5555)";
  if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email)) errors.email = "Correo no válido";
  return errors;
}
