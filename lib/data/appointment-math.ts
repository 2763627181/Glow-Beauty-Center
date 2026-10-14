/** Cálculos de citas puros (seguros para importar desde componentes cliente). */
/** Total de la cita = servicios − descuento. La propina NO entra: se anota aparte para la especialista. */
export const apptTotal = (a: { services: { final_price: number; quantity: number }[]; discount: number; tip?: number }) =>
  a.services.reduce((t, s) => t + s.final_price * s.quantity, 0) - a.discount;

export const apptSubtotal = (a: { services: { final_price: number; quantity: number }[] }) =>
  a.services.reduce((t, s) => t + s.final_price * s.quantity, 0);
