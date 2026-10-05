export type AppointmentStatus =
  | "solicitud" | "contactando" | "contactado" | "confirmado" | "en_espera"
  | "en_servicio" | "completado" | "cancelado" | "no_asistio";

export type AppointmentSource = "website" | "admin" | "whatsapp" | "phone" | "walk_in" | "instagram";
export type PaymentMethod = "efectivo" | "tarjeta" | "transferencia" | "otro";
export type PaymentStatus = "pendiente" | "parcial" | "pagado" | "reembolsado";

export type Category = { id: string; name: string; slug: string; description: string | null; display_order: number; image_url: string | null };

export type ServiceVariant = { id: string; service_id: string; name: string; price: number; duration_minutes: number };
export type ServiceAddon = { id: string; service_id: string; name: string; price: number; duration_minutes: number };

export type Service = {
  id: string;
  category_id: string;
  name: string;
  slug: string;
  short_description: string | null;
  description: string | null;
  price: number;
  price_from: boolean;
  duration_minutes: number;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  requires_consultation: boolean;
  image_url: string | null;
  featured: boolean;
  display_order: number;
  variants: ServiceVariant[];
  addons: ServiceAddon[];
};

export type Employee = { id: string; full_name: string; avatar_url: string | null; specialty: string | null; bio: string | null };

export type Promotion = {
  id: string; name: string; description: string | null; original_price: number | null; promo_price: number;
  ends_on: string | null; image_url: string | null; service_ids: string[];
};

export type GalleryItem = { id: string; title: string | null; category: string; image_url: string; is_cover: boolean };

export type { BusinessSettings } from "@/lib/domain/settings";

export type Catalog = { categories: Category[]; services: Service[] };

/** Línea elegida por el cliente en el carrito / reserva. */
export type SelectionItem = { serviceId: string; variantId?: string | null; addonIds: string[] };
