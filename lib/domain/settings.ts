import { mergeSiteContent, type SiteContent } from "./siteContent";

export type BusinessInfo = {
  name: string; tagline: string; phone: string; whatsapp: string; email: string;
  instagram: string; facebook: string; tiktok: string; address: string; maps_url: string; logo_url: string;
};
export type DayHours = { open: string; close: string } | null;
export type BookingRules = { min_notice_hours: number; max_advance_days: number; slot_minutes: number; cancel_hours: number; cancellation_policy: string };

export type BusinessSettings = {
  business: BusinessInfo;
  hours: Record<string, DayHours>;
  booking: BookingRules;
  policies: { text: string };
  content: SiteContent;
};

export const DEFAULT_BUSINESS: BusinessInfo = {
  name: "Glow Beauty Center", tagline: "Tu momento. Tu belleza. Tu Glow.", phone: "", whatsapp: "", email: "",
  instagram: "", facebook: "", tiktok: "", address: "", maps_url: "", logo_url: "",
};
export const DEFAULT_HOURS: Record<string, DayHours> = {
  "0": null, "1": { open: "09:00", close: "18:00" }, "2": { open: "09:00", close: "18:00" }, "3": { open: "09:00", close: "18:00" },
  "4": { open: "09:00", close: "18:00" }, "5": { open: "09:00", close: "18:00" }, "6": { open: "09:00", close: "16:00" },
};
export const DEFAULT_BOOKING: BookingRules = {
  min_notice_hours: 3, max_advance_days: 60, slot_minutes: 15, cancel_hours: 4,
  cancellation_policy: "Cancelaciones con al menos 4 horas de anticipación.",
};

const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const s = (v: unknown, d: string) => (typeof v === "string" ? v : d);

/** Convierte filas clave→valor de business_settings en un objeto completo y tipado, con valores por defecto. */
export function normalizeSettings(map: Record<string, unknown>): BusinessSettings {
  const b = obj(map.business), bk = obj(map.booking), h = obj(map.hours);
  const business = Object.fromEntries(Object.entries(DEFAULT_BUSINESS).map(([k, d]) => [k, s(b[k], d)])) as BusinessInfo;
  const hours: Record<string, DayHours> = {};
  for (let d = 0; d < 7; d++) {
    const v = h[String(d)];
    const o = obj(v);
    hours[String(d)] = typeof o.open === "string" && typeof o.close === "string" ? { open: o.open, close: o.close } : String(d) in h ? null : DEFAULT_HOURS[String(d)];
  }
  const content = mergeSiteContent({ hero_image_url: s(b.hero_image_url, ""), ...obj(map.site_content) });
  if (!obj(map.site_content).hero_image_url && b.hero_image_url) content.hero_image_url = s(b.hero_image_url, "");
  return {
    business,
    hours,
    booking: {
      min_notice_hours: num(bk.min_notice_hours, DEFAULT_BOOKING.min_notice_hours), max_advance_days: num(bk.max_advance_days, DEFAULT_BOOKING.max_advance_days),
      slot_minutes: num(bk.slot_minutes, DEFAULT_BOOKING.slot_minutes), cancel_hours: num(bk.cancel_hours, DEFAULT_BOOKING.cancel_hours),
      cancellation_policy: s(bk.cancellation_policy, DEFAULT_BOOKING.cancellation_policy),
    },
    policies: { text: s(obj(map.policies).text, "") },
    content,
  };
}
