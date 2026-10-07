"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAccess, requireAction } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { refreshPublicSite } from "../refresh";
import type { ActionResult } from "./appointments";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const done = (path?: string) => { refreshPublicSite(); if (path) revalidatePath(path); };

/* ───────── Promociones ───────── */
const promoSchema = z.object({
  name: z.string().trim().min(2, "Nombre requerido").max(80), description: z.string().max(400).nullish(),
  original_price: z.number().min(0).nullish(), promo_price: z.number().min(0, "Precio no válido"),
  starts_on: date.nullish().or(z.literal("")), ends_on: date.nullish().or(z.literal("")),
  image_url: z.string().url().nullish(), active: z.boolean(), service_ids: z.array(z.uuid()).min(1, "Elige al menos un servicio incluido"),
});
export type PromoInput = z.input<typeof promoSchema>;

export async function savePromotion(id: string | null, input: PromoInput): Promise<ActionResult> {
  await requireAccess("promotions");
  const p = promoSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const { service_ids, ...row } = p.data;
  if (row.starts_on && row.ends_on && row.ends_on < row.starts_on) return { ok: false, error: "La fecha final no puede ser anterior a la inicial." };
  if (row.original_price != null && row.promo_price > row.original_price) return { ok: false, error: "El precio promocional no puede superar el original." };
  const sb = await createClient();
  const payload = { ...row, starts_on: row.starts_on || null, ends_on: row.ends_on || null };
  const { data, error } = id ? await sb.from("promotions").update(payload).eq("id", id).select("id").single() : await sb.from("promotions").insert(payload).select("id").single();
  if (error) return { ok: false, error: "No se pudo guardar." };
  await sb.from("promotion_services").delete().eq("promotion_id", data.id);
  await sb.from("promotion_services").insert(service_ids.map((s) => ({ promotion_id: data.id, service_id: s })));
  done("/admin/promotions");
  return { ok: true };
}

export async function deletePromotion(id: string): Promise<ActionResult> {
  await requireAccess("promotions");
  const sb = await createClient();
  const { error } = await sb.from("promotions").delete().eq("id", id);
  if (error) return { ok: false, error: "No se pudo eliminar." };
  done("/admin/promotions");
  return { ok: true };
}

/* ───────── Galería ───────── */
const CATS = ["unas", "cabello", "pedicure", "tratamientos", "glow"] as const;
export async function addGalleryItem(input: { image_url: string; storage_path?: string; title?: string; category: (typeof CATS)[number] }): Promise<ActionResult> {
  await requireAccess("gallery");
  const p = z.object({ image_url: z.string().url(), storage_path: z.string().optional(), title: z.string().max(80).optional(), category: z.enum(CATS) }).safeParse(input);
  if (!p.success) return { ok: false, error: "Datos no válidos." };
  const sb = await createClient();
  const { data: last } = await sb.from("gallery").select("display_order").order("display_order", { ascending: false }).limit(1).maybeSingle();
  const { error } = await sb.from("gallery").insert({ ...p.data, display_order: (last?.display_order ?? 0) + 1 });
  if (error) return { ok: false, error: "No se pudo guardar." };
  done("/admin/gallery");
  return { ok: true };
}

export async function updateGalleryItem(id: string, patch: { title?: string; category?: (typeof CATS)[number]; is_cover?: boolean; active?: boolean }): Promise<ActionResult> {
  await requireAccess("gallery");
  const p = z.object({ title: z.string().max(80).optional(), category: z.enum(CATS).optional(), is_cover: z.boolean().optional(), active: z.boolean().optional() }).safeParse(patch);
  if (!p.success) return { ok: false, error: "Datos no válidos." };
  const sb = await createClient();
  if (p.data.is_cover) await sb.from("gallery").update({ is_cover: false }).eq("is_cover", true); // una sola portada
  const { error } = await sb.from("gallery").update(p.data).eq("id", id);
  if (error) return { ok: false, error: "No se pudo actualizar." };
  done("/admin/gallery");
  return { ok: true };
}

export async function moveGalleryItem(id: string, dir: -1 | 1): Promise<ActionResult> {
  await requireAccess("gallery");
  const sb = await createClient();
  const { data } = await sb.from("gallery").select("id").order("display_order").order("created_at");
  const arr = data ?? [];
  const i = arr.findIndex((x) => x.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= arr.length) return { ok: true };
  [arr[i], arr[j]] = [arr[j], arr[i]];
  for (const [n, x] of arr.entries()) await sb.from("gallery").update({ display_order: n + 1 }).eq("id", x.id);
  done("/admin/gallery");
  return { ok: true };
}

export async function deleteGalleryItem(id: string): Promise<ActionResult> {
  await requireAccess("gallery");
  const sb = await createClient();
  const { data } = await sb.from("gallery").select("storage_path").eq("id", id).maybeSingle();
  const { error } = await sb.from("gallery").delete().eq("id", id);
  if (error) return { ok: false, error: "No se pudo eliminar." };
  if (data?.storage_path) await sb.storage.from("gallery").remove([data.storage_path]);
  done("/admin/gallery");
  return { ok: true };
}

/* ───────── Configuración ───────── */
const url = z.string().url("Enlace no válido").or(z.literal(""));
const hhmm = z.string().regex(/^\d{2}:\d{2}$/);
const schemas = {
  business: z.object({
    name: z.string().trim().min(2, "El nombre del negocio es obligatorio").max(80), tagline: z.string().max(120), phone: z.string().max(40),
    whatsapp: z.string().regex(/^\d{10,15}$/, "WhatsApp: solo dígitos con código de país (ej. 18095550000)").or(z.literal("")),
    email: z.email("Correo no válido").or(z.literal("")), instagram: z.string().max(60), facebook: z.string().max(80), tiktok: z.string().max(60),
    address: z.string().max(200), maps_url: url, logo_url: url,
  }),
  hours: z.record(z.string(), z.object({ open: hhmm, close: hhmm }).nullable()),
  booking: z.object({
    min_notice_hours: z.number().min(0).max(240), max_advance_days: z.number().min(1).max(365),
    slot_minutes: z.number().refine((n) => [10, 15, 20, 30, 60].includes(n), "Intervalo no válido"),
    cancel_hours: z.number().min(0).max(240), cancellation_policy: z.string().max(400),
    max_simultaneous: z.number().int("Debe ser un número entero").min(1, "Mínimo 1").max(10, "Máximo 10"),
  }),
  policies: z.object({ text: z.string().max(3000) }),
  site_content: z.object({
    hero_title: z.string().trim().min(1, "El título principal es obligatorio").max(80), hero_highlight: z.string().max(40), hero_subtitle: z.string().max(200), hero_image_url: url,
    hero_tags: z.array(z.string().trim().min(1).max(24)).max(6),
    services_title: z.string().trim().min(1).max(60), services_text: z.string().max(200), categories_title: z.string().trim().min(1).max(60),
    steps_title: z.string().trim().min(1).max(60), steps: z.array(z.object({ title: z.string().trim().min(1, "Cada paso necesita un título").max(60), text: z.string().max(160) })).min(1).max(6),
    gallery_title: z.string().trim().min(1).max(60), gallery_text: z.string().max(200),
    cta_title: z.string().trim().min(1).max(60), cta_text: z.string().max(200),
    about_title: z.string().trim().min(1).max(80), about_paragraphs: z.array(z.string().trim().min(1).max(800)).min(1).max(6), about_image_url: url,
    team_title: z.string().trim().min(1).max(60),
    services_page_title: z.string().trim().min(1).max(60), services_page_text: z.string().max(200),
    booking_title: z.string().trim().min(1).max(60), booking_text: z.string().max(200),
    contact_title: z.string().trim().min(1).max(60), contact_text: z.string().max(400),
    seo_title: z.string().trim().min(1).max(70), seo_description: z.string().trim().min(1).max(170),
  }),
  whatsapp_templates: z.object({ confirm: z.string().trim().min(5).max(500), reminder: z.string().trim().min(5).max(500), generic: z.string().trim().min(3).max(500) }),
} as const;
const PUBLIC_KEYS = new Set(["business", "hours", "booking", "policies", "site_content"]);

export async function saveSetting<K extends keyof typeof schemas>(key: K, value: z.input<(typeof schemas)[K]>): Promise<ActionResult> {
  await requireAccess("settings");
  const p = schemas[key].safeParse(value);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  if (key === "hours") for (const v of Object.values(p.data as Record<string, { open: string; close: string } | null>)) if (v && v.close <= v.open) return { ok: false, error: "La hora de cierre debe ser posterior a la de apertura." };
  const sb = await createClient();
  const { error } = await sb.from("business_settings").upsert({ key, value: p.data, is_public: PUBLIC_KEYS.has(key), updated_at: new Date().toISOString() });
  if (error) return { ok: false, error: "No se pudo guardar." };
  done("/admin/settings");
  return { ok: true };
}

/* ───────── Métodos de pago ───────── */
const slugKey = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 30);

export async function savePaymentMethod(key: string | null, input: { label: string; active: boolean }): Promise<ActionResult> {
  await requireAccess("settings");
  const p = z.object({ label: z.string().trim().min(1, "Escribe el nombre del método").max(40), active: z.boolean() }).safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const sb = await createClient();
  if (key) {
    const { error } = await sb.from("payment_methods").update(p.data).eq("key", key);
    if (error) return { ok: false, error: "No se pudo guardar." };
  } else {
    let k = slugKey(p.data.label);
    if (k.length < 2) return { ok: false, error: "Usa un nombre con letras o números." };
    const { data: ex } = await sb.from("payment_methods").select("key").eq("key", k).maybeSingle();
    if (ex) k = `${k.slice(0, 25)}_${Math.random().toString(36).slice(2, 5)}`;
    const { data: last } = await sb.from("payment_methods").select("display_order").order("display_order", { ascending: false }).limit(1).maybeSingle();
    const { error } = await sb.from("payment_methods").insert({ key: k, ...p.data, display_order: (last?.display_order ?? 0) + 1 });
    if (error) return { ok: false, error: "No se pudo crear." };
  }
  revalidatePath("/admin", "layout");
  return { ok: true };
}

export async function movePaymentMethod(key: string, dir: -1 | 1): Promise<ActionResult> {
  await requireAccess("settings");
  const sb = await createClient();
  const { data } = await sb.from("payment_methods").select("key").order("display_order").order("label");
  const arr = data ?? [];
  const i = arr.findIndex((x) => x.key === key), j = i + dir;
  if (i < 0 || j < 0 || j >= arr.length) return { ok: true };
  [arr[i], arr[j]] = [arr[j], arr[i]];
  for (const [n, x] of arr.entries()) await sb.from("payment_methods").update({ display_order: n + 1 }).eq("key", x.key);
  revalidatePath("/admin", "layout");
  return { ok: true };
}

/** Elimina un método sin pagos; si ya se usó, solo se desactiva para conservar el historial. */
export async function deletePaymentMethod(key: string): Promise<ActionResult<{ archived: boolean }>> {
  await requireAccess("settings");
  const sb = await createClient();
  const { count: total } = await sb.from("payment_methods").select("key", { count: "exact", head: true }).eq("active", true);
  const { data: cur } = await sb.from("payment_methods").select("active").eq("key", key).maybeSingle();
  if (cur?.active && (total ?? 0) <= 1) return { ok: false, error: "Debe quedar al menos un método de pago activo." };
  const { count: used } = await sb.from("payments").select("id", { count: "exact", head: true }).eq("method", key);
  if ((used ?? 0) > 0) {
    await sb.from("payment_methods").update({ active: false }).eq("key", key);
    revalidatePath("/admin", "layout");
    return { ok: true, archived: true };
  }
  const { error } = await sb.from("payment_methods").delete().eq("key", key);
  if (error) return { ok: false, error: "No se pudo eliminar." };
  revalidatePath("/admin", "layout");
  return { ok: true, archived: false };
}

/* ───────── Bloqueos del negocio / feriados / horarios especiales ───────── */
export async function addBlock(input: { employeeId: string | null; startsAt: string; endsAt: string; kind: "manual" | "feriado" | "almuerzo" | "especial"; reason: string }): Promise<ActionResult> {
  await requireAction("manageAppointments");
  const p = z.object({ employeeId: z.uuid().nullable(), startsAt: z.iso.datetime(), endsAt: z.iso.datetime(), kind: z.enum(["manual", "feriado", "almuerzo", "especial"]), reason: z.string().max(120) }).safeParse(input);
  if (!p.success || new Date(p.data.endsAt) <= new Date(p.data.startsAt)) return { ok: false, error: "Rango de fechas no válido." };
  const sb = await createClient();
  const { error } = await sb.from("schedule_blocks").insert({ employee_id: p.data.employeeId, starts_at: p.data.startsAt, ends_at: p.data.endsAt, kind: p.data.kind, reason: p.data.reason || null, created_by: (await sb.auth.getUser()).data.user?.id });
  if (error) return { ok: false, error: "No se pudo guardar el bloqueo." };
  revalidatePath("/admin/settings");
  return { ok: true };
}

export async function removeBlock(id: string): Promise<ActionResult> {
  await requireAction("manageAppointments");
  const sb = await createClient();
  const { error } = await sb.from("schedule_blocks").delete().eq("id", id);
  if (error) return { ok: false, error: "No se pudo eliminar." };
  revalidatePath("/admin/settings");
  return { ok: true };
}
