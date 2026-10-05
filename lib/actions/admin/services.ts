"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAccess } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { refreshPublicSite } from "../refresh";
import type { ActionResult } from "./appointments";

const num = z.number().min(0);
const schema = z.object({
  name: z.string().trim().min(2, "Nombre requerido").max(120),
  category_id: z.uuid("Elige una categoría"),
  short_description: z.string().max(200).nullish(),
  description: z.string().max(2000).nullish(),
  price: num, price_from: z.boolean(),
  duration_minutes: z.number().int().min(1, "La duración debe ser mayor a 0").max(720),
  buffer_before_minutes: z.number().int().min(0).max(240), buffer_after_minutes: z.number().int().min(0).max(240),
  commission_pct: z.number().min(0).max(100).nullish(),
  requires_consultation: z.boolean(), featured: z.boolean(), active: z.boolean(), pending_review: z.boolean(),
  image_url: z.string().url().nullish(),
  variants: z.array(z.object({ id: z.uuid().optional(), name: z.string().trim().min(1, "Cada variante necesita un nombre"), price: num, duration_minutes: z.number().int().min(1), active: z.boolean() })),
  addons: z.array(z.object({ id: z.uuid().optional(), name: z.string().trim().min(1, "Cada complemento necesita un nombre"), price: num, duration_minutes: z.number().int().min(0), active: z.boolean() })),
  employee_ids: z.array(z.uuid()),
});
export type ServiceInput = z.input<typeof schema>;

const slugify = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
const uniqueSlug = async (sb: Awaited<ReturnType<typeof createClient>>, table: "services" | "service_categories", base: string) => {
  let slug = slugify(base) || "item";
  const { data } = await sb.from(table).select("id").eq("slug", slug).maybeSingle();
  if (data) slug += `-${Math.random().toString(36).slice(2, 6)}`;
  return slug;
};
const done = () => { refreshPublicSite(); revalidatePath("/admin/services"); };

export async function saveService(id: string | null, input: ServiceInput): Promise<ActionResult<{ id: string }>> {
  await requireAccess("services");
  const p = schema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const { variants, addons, employee_ids, ...svc } = p.data;
  const sb = await createClient();

  let sid = id;
  if (id) {
    const { error } = await sb.from("services").update(svc).eq("id", id);
    if (error) return { ok: false, error: "No se pudo guardar el servicio." };
  } else {
    const slug = await uniqueSlug(sb, "services", svc.name);
    const { data: last } = await sb.from("services").select("display_order").eq("category_id", svc.category_id).order("display_order", { ascending: false }).limit(1).maybeSingle();
    const { data, error } = await sb.from("services").insert({ ...svc, slug, display_order: (last?.display_order ?? 0) + 1 }).select("id").single();
    if (error) return { ok: false, error: "No se pudo crear el servicio." };
    sid = data.id;
  }

  // Variantes y complementos: sincronizar (borrar los quitados, actualizar o crear el resto)
  for (const [table, rows] of [["service_variants", variants], ["service_addons", addons]] as const) {
    const keep = rows.filter((r) => r.id).map((r) => r.id!);
    const del = sb.from(table).delete().eq("service_id", sid!);
    const { error: e1 } = keep.length ? await del.not("id", "in", `(${keep.join(",")})`) : await del;
    if (e1) return { ok: false, error: "No se pudieron actualizar las opciones." };
    for (const [i, r] of rows.entries()) {
      const row = { ...r, service_id: sid!, ...(table === "service_variants" ? { display_order: i } : {}) };
      const { error } = r.id ? await sb.from(table).update(row).eq("id", r.id) : await sb.from(table).insert(row);
      if (error) return { ok: false, error: "No se pudo guardar una opción." };
    }
  }

  await sb.from("employee_services").delete().eq("service_id", sid!);
  if (employee_ids.length) await sb.from("employee_services").insert(employee_ids.map((e) => ({ employee_id: e, service_id: sid! })));
  done();
  return { ok: true, id: sid! };
}

export async function toggleService(id: string, active: boolean): Promise<ActionResult> {
  await requireAccess("services");
  const sb = await createClient();
  const { error } = await sb.from("services").update({ active }).eq("id", id);
  if (error) return { ok: false, error: "No se pudo actualizar." };
  done();
  return { ok: true };
}

export async function moveService(id: string, dir: -1 | 1): Promise<ActionResult> {
  await requireAccess("services");
  const sb = await createClient();
  const { data: cur } = await sb.from("services").select("id,category_id").eq("id", id).single();
  if (!cur) return { ok: false, error: "No encontrado." };
  const { data: list } = await sb.from("services").select("id").eq("category_id", cur.category_id).order("display_order").order("name");
  const arr = list ?? [];
  const i = arr.findIndex((x) => x.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= arr.length) return { ok: true };
  [arr[i], arr[j]] = [arr[j], arr[i]];
  for (const [n, x] of arr.entries()) await sb.from("services").update({ display_order: n + 1 }).eq("id", x.id);
  done();
  return { ok: true };
}

/** Elimina un servicio nunca usado; si ya tiene historial (citas o ventas) lo archiva (desactiva) para conservarlo. */
export async function deleteService(id: string): Promise<ActionResult<{ archived: boolean }>> {
  await requireAccess("services");
  const sb = await createClient();
  const [{ count: a }, { count: s }, { count: p }] = await Promise.all([
    sb.from("appointment_services").select("id", { count: "exact", head: true }).eq("service_id", id),
    sb.from("sale_items").select("id", { count: "exact", head: true }).eq("service_id", id),
    sb.from("promotion_services").select("service_id", { count: "exact", head: true }).eq("service_id", id),
  ]);
  if ((a ?? 0) + (s ?? 0) > 0) {
    const { error } = await sb.from("services").update({ active: false }).eq("id", id);
    if (error) return { ok: false, error: "No se pudo archivar." };
    done();
    return { ok: true, archived: true };
  }
  if ((p ?? 0) > 0) return { ok: false, error: "Este servicio forma parte de una promoción. Quítalo de la promoción primero." };
  const { error } = await sb.from("services").delete().eq("id", id);
  if (error) return { ok: false, error: "No se pudo eliminar." };
  done();
  return { ok: true, archived: false };
}

export async function duplicateService(id: string): Promise<ActionResult<{ id: string }>> {
  await requireAccess("services");
  const sb = await createClient();
  const { data: s } = await sb.from("services").select("*, service_variants(*), service_addons(*)").eq("id", id).single();
  if (!s) return { ok: false, error: "Servicio no encontrado." };
  const name = `${s.name} (copia)`;
  const { id: _id, created_at: _c, updated_at: _u, service_variants: vars, service_addons: adds, ...rest } = s; // eslint-disable-line @typescript-eslint/no-unused-vars
  const { data: n, error } = await sb.from("services").insert({ ...rest, name, slug: await uniqueSlug(sb, "services", name), active: false, featured: false, display_order: s.display_order + 1 }).select("id").single();
  if (error) return { ok: false, error: "No se pudo duplicar." };
  if (vars?.length) await sb.from("service_variants").insert(vars.map(({ id: _v, service_id: _s, ...v }: Record<string, unknown>) => ({ ...v, service_id: n.id }))); // eslint-disable-line @typescript-eslint/no-unused-vars
  if (adds?.length) await sb.from("service_addons").insert(adds.map(({ id: _a, service_id: _s, ...v }: Record<string, unknown>) => ({ ...v, service_id: n.id }))); // eslint-disable-line @typescript-eslint/no-unused-vars
  const { data: links } = await sb.from("employee_services").select("employee_id").eq("service_id", id);
  if (links?.length) await sb.from("employee_services").insert(links.map((l) => ({ employee_id: l.employee_id, service_id: n.id })));
  done();
  return { ok: true, id: n.id };
}

/* ───────── Categorías ───────── */
const catSchema = z.object({
  name: z.string().trim().min(2, "Nombre requerido").max(60), description: z.string().max(200).nullish(),
  image_url: z.string().url().nullish(), active: z.boolean(),
});
export type CategoryInput = z.input<typeof catSchema>;

export async function saveCategory(id: string | null, input: CategoryInput): Promise<ActionResult> {
  await requireAccess("services");
  const p = catSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const sb = await createClient();
  if (id) {
    const { error } = await sb.from("service_categories").update(p.data).eq("id", id);
    if (error) return { ok: false, error: "No se pudo guardar." };
  } else {
    const { data: last } = await sb.from("service_categories").select("display_order").order("display_order", { ascending: false }).limit(1).maybeSingle();
    const { error } = await sb.from("service_categories").insert({ ...p.data, slug: await uniqueSlug(sb, "service_categories", p.data.name), display_order: (last?.display_order ?? 0) + 1 });
    if (error) return { ok: false, error: "No se pudo crear." };
  }
  done();
  return { ok: true };
}

export async function moveCategory(id: string, dir: -1 | 1): Promise<ActionResult> {
  await requireAccess("services");
  const sb = await createClient();
  const { data } = await sb.from("service_categories").select("id").order("display_order").order("name");
  const arr = data ?? [];
  const i = arr.findIndex((x) => x.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= arr.length) return { ok: true };
  [arr[i], arr[j]] = [arr[j], arr[i]];
  for (const [n, x] of arr.entries()) await sb.from("service_categories").update({ display_order: n + 1 }).eq("id", x.id);
  done();
  return { ok: true };
}

export async function deleteCategory(id: string): Promise<ActionResult> {
  await requireAccess("services");
  const sb = await createClient();
  const { count } = await sb.from("services").select("id", { count: "exact", head: true }).eq("category_id", id);
  if ((count ?? 0) > 0) return { ok: false, error: `Esta categoría tiene ${count} servicio(s). Muévelos a otra categoría o elimínalos antes.` };
  const { error } = await sb.from("service_categories").delete().eq("id", id);
  if (error) return { ok: false, error: "No se pudo eliminar." };
  done();
  return { ok: true };
}

/* ───────── Productos (para ventas y cobros) ───────── */
const prodSchema = z.object({ name: z.string().trim().min(1, "Nombre requerido").max(80), price: z.number().min(0, "El precio no puede ser negativo"), active: z.boolean() });
export type ProductInput = z.input<typeof prodSchema>;

export async function saveProduct(id: string | null, input: ProductInput): Promise<ActionResult> {
  await requireAccess("services");
  const p = prodSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const sb = await createClient();
  const { error } = id ? await sb.from("products").update(p.data).eq("id", id) : await sb.from("products").insert(p.data);
  if (error) return { ok: false, error: "No se pudo guardar." };
  revalidatePath("/admin", "layout");
  return { ok: true };
}

export async function deleteProduct(id: string): Promise<ActionResult> {
  await requireAccess("services");
  const sb = await createClient();
  const { error } = await sb.from("products").delete().eq("id", id);
  if (error) return { ok: false, error: "No se pudo eliminar." };
  revalidatePath("/admin", "layout");
  return { ok: true };
}
