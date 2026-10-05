/** Cálculos de citas puros (seguros para importar desde componentes cliente). */
export const apptTotal = (a: { services: { final_price: number; quantity: number }[]; discount: number; tip: number }) =>
  a.services.reduce((t, s) => t + s.final_price * s.quantity, 0) - a.discount + a.tip;

export const apptSubtotal = (a: { services: { final_price: number; quantity: number }[] }) =>
  a.services.reduce((t, s) => t + s.final_price * s.quantity, 0);
