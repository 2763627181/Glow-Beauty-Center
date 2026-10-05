export type BookingForm = {
  employeeId: string | "any";
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
  employeeId: "any", date: "", slot: null, firstName: "", lastName: "", phone: "", email: "", notes: "", website: "", remember: true,
};

export const STEPS = ["Servicios", "Profesional", "Fecha", "Datos", "Confirmar"] as const;

export type StepProps = { form: BookingForm; set: (patch: Partial<BookingForm>) => void; errors: Record<string, string> };
