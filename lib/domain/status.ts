import type { AppointmentStatus } from "@/types/domain";

export const STATUS_META: Record<AppointmentStatus, { label: string; tone: "pink" | "gold" | "sage" | "green" | "red" | "gray" | "blue"; mark: string }> = {
  solicitud: { label: "Solicitud", tone: "pink", mark: "●" },
  contactando: { label: "Contactando", tone: "gold", mark: "◔" },
  contactado: { label: "Contactado", tone: "gold", mark: "◑" },
  confirmado: { label: "Confirmado", tone: "sage", mark: "✓" },
  en_espera: { label: "En espera", tone: "blue", mark: "◷" },
  en_servicio: { label: "En servicio", tone: "blue", mark: "▶" },
  completado: { label: "Completado", tone: "green", mark: "✔" },
  cancelado: { label: "Cancelado", tone: "red", mark: "✕" },
  no_asistio: { label: "No asistió", tone: "gray", mark: "∅" },
};

export const BOARD_COLUMNS: AppointmentStatus[] = [
  "solicitud", "contactando", "contactado", "confirmado", "en_espera", "en_servicio", "completado",
];
/** Columnas de cierre del tablero: permiten cancelar (arrastrando) y reabrir citas. */
export const BOARD_CLOSED_COLUMNS: AppointmentStatus[] = ["cancelado", "no_asistio"];

export const SOURCE_LABEL: Record<string, string> = {
  website: "Web", admin: "Admin", whatsapp: "WhatsApp", phone: "Teléfono", walk_in: "Sin cita", instagram: "Instagram",
};
