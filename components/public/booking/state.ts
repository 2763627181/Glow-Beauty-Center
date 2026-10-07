export type BookingForm = {
  /** Especialistas elegidas por servicio (id del servicio → ids). Sin elección = cualquiera disponible. */
  staff: Record<string, string[]>;
  /** Los servicios empiezan a la vez (cada uno con su especialista) en vez de uno tras otro. */
  parallel: boolean;
  date: string; // YYYY-MM-DD
  slot: { time: string; start: string } | null;
  /** Huella de los servicios con los que se eligió el horario: si cambian, el horario deja de ser válido. */
  slotKey?: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  notes: string;
  website: string; // honeypot
  remember: boolean;
};

export const emptyForm: BookingForm = {
  staff: {}, parallel: false, date: "", slot: null, firstName: "", lastName: "", phone: "", email: "", notes: "", website: "", remember: true,
};

/** Minutos que dura la reserva: uno tras otro se suman; «al mismo tiempo» dura lo del servicio más largo. */
export const effectiveMinutes = (cartMinutes: number, durations: number[], parallel: boolean) =>
  parallel && durations.length > 1 ? Math.max(...durations) : cartMinutes;

export const STEPS = ["Servicios", "Profesional", "Fecha", "Datos", "Confirmar"] as const;

export type StepProps = { form: BookingForm; set: (patch: Partial<BookingForm>) => void; errors: Record<string, string> };
