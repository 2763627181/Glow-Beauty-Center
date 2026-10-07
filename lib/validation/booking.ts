import { z } from "zod";
import { isValidDRPhone } from "@/lib/phone";

export const selectionSchema = z.object({
  serviceId: z.uuid(),
  variantId: z.uuid().nullish(),
  addonIds: z.array(z.uuid()).max(10).default([]),
  employeeIds: z.array(z.uuid()).max(6).default([]),
});

export const availabilityQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  employeeId: z.union([z.literal("any"), z.uuid()]).default("any"),
  parallel: z.boolean().default(false),
  items: z.array(selectionSchema).min(1).max(12),
});

export const bookingSchema = z.object({
  items: z.array(selectionSchema).min(1, "Selecciona al menos un servicio").max(12),
  employeeId: z.union([z.literal("any"), z.uuid()]).default("any"),
  parallel: z.boolean().default(false),
  start: z.iso.datetime(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  promotionId: z.uuid().nullish(),
  firstName: z.string().trim().min(2, "Escribe tu nombre").max(60),
  lastName: z.string().trim().min(2, "Escribe tu apellido").max(60),
  phone: z.string().refine(isValidDRPhone, "Escribe un WhatsApp válido (ej. 809-555-5555)"),
  email: z.union([z.literal(""), z.email("Correo no válido")]).optional(),
  notes: z.string().trim().max(500).optional(),
  website: z.string().max(0).optional(), // honeypot anti-bots
});
export type BookingInput = z.infer<typeof bookingSchema>;
