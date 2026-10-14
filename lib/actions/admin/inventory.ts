"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAccess } from "@/lib/auth";
import { friendlyError } from "@/lib/domain/errors";
import { isValidDay, lotWindows } from "@/lib/domain/inventory";
import { todayISO } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "./appointments";

/**
 * Inventario: productos que se usan en los servicios, sus entradas (cuando llega un pedido) y cuándo se agotan.
 * Solo super administrador y gerencia (la base de datos también lo impone con RLS).
 */
const fail = (m?: string | null): { ok: false; error: string } => ({ ok: false, error: friendlyError(m) });
const refresh = (id?: string) => { revalidatePath("/admin/inventory"); if (id) revalidatePath(`/admin/inventory/${id}`); };
const MIN_DAY = "2020-01-01";

const day = (label: string) => z.string().refine(isValidDay, `${label} no es una fecha válida`).refine((d) => d >= MIN_DAY, `${label} es demasiado antigua`).refine((d) => d <= todayISO(), `${label} no puede ser futura`);
const optText = (max: number, label: string) => z.string().trim().max(max, `${label} es demasiado largo (máximo ${max} letras)`).nullish().transform((v) => v || null);

const supplySchema = z.object({
  name: z.string().trim().min(2, "Escribe el nombre del producto").max(80, "El nombre es demasiado largo"),
  unit: z.string().trim().min(1, "Escribe la unidad (pote, botella, caja…)").max(30, "La unidad es demasiado larga").regex(/^\S+$/, "La unidad es una sola palabra (pote, botella, caja…)"),
  expected: z.number("El rendimiento no es válido").positive("El rendimiento debe ser mayor que 0").max(10_000, "El rendimiento es demasiado grande").nullish(),
  notes: optText(500, "La nota"),
  active: z.boolean(),
  service_ids: z.array(z.uuid()).max(80, "Demasiados servicios"),
});
export type SupplyInput = z.input<typeof supplySchema>;

export async function saveSupply(id: string | null, input: SupplyInput): Promise<ActionResult<{ id: string }>> {
  await requireAccess("inventory");
  const p = supplySchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const { service_ids, expected, ...row } = p.data;
  const sb = await createClient();
  const payload = { ...row, expected_services_per_unit: expected ?? null };
  const { data, error } = id
    ? await sb.from("supplies").update(payload).eq("id", id).select("id").single()
    : await sb.from("supplies").insert(payload).select("id").single();
  if (error) return fail(error.message);
  const { data: current } = await sb.from("supply_services").select("service_id").eq("supply_id", data.id);
  const have = new Set((current ?? []).map((r) => r.service_id)), want = new Set(service_ids);
  const add = [...want].filter((s) => !have.has(s)), drop = [...have].filter((s) => !want.has(s));
  if (add.length) { const r = await sb.from("supply_services").insert(add.map((service_id) => ({ supply_id: data.id, service_id }))); if (r.error) return { ok: false, error: "Se guardó el producto, pero no sus servicios. Inténtalo de nuevo." }; }
  if (drop.length) { const r = await sb.from("supply_services").delete().eq("supply_id", data.id).in("service_id", drop); if (r.error) return { ok: false, error: "Se guardó el producto, pero no se pudieron quitar algunos servicios. Inténtalo de nuevo." }; }
  refresh(data.id);
  return { ok: true, id: data.id };
}

/** Borra el producto con todas sus entradas. */
export async function deleteSupply(id: string): Promise<ActionResult> {
  await requireAccess("inventory");
  const { error } = await (await createClient()).from("supplies").delete().eq("id", id);
  if (error) return fail(error.message);
  refresh();
  return { ok: true };
}

const lotSchema = z.object({
  received_on: day("La fecha de entrada"),
  quantity: z.number("La cantidad no es válida").positive("La cantidad debe ser mayor que 0").max(1_000_000, "La cantidad es demasiado grande"),
  unit_cost: z.number("El costo no es válido").min(0, "El costo no puede ser negativo").max(10_000_000, "El costo es demasiado grande").nullish(),
  supplier: optText(120, "El proveedor"),
  notes: optText(300, "La nota"),
});
export type LotInput = z.input<typeof lotSchema>;

export async function addLot(supplyId: string, input: LotInput): Promise<ActionResult<{ id: string }>> {
  const s = await requireAccess("inventory");
  const p = lotSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const { data, error } = await (await createClient()).from("supply_lots").insert({ supply_id: supplyId, ...p.data, unit_cost: p.data.unit_cost ?? null, created_by: s.userId }).select("id").single();
  if (error) return fail(error.message);
  refresh(supplyId);
  return { ok: true, id: data.id };
}

/** Cambia los datos de una entrada (fecha, cantidad, costo, proveedor, nota). */
export async function saveLot(lotId: string, input: LotInput): Promise<ActionResult> {
  await requireAccess("inventory");
  const p = lotSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const sb = await createClient();
  const { data: cur } = await sb.from("supply_lots").select("supply_id,depleted_on").eq("id", lotId).maybeSingle();
  if (!cur) return { ok: false, error: "Esa entrada no existe." };
  if (cur.depleted_on && p.data.received_on > cur.depleted_on) return { ok: false, error: "La fecha de entrada no puede ser posterior a la de agotado." };
  const { error } = await sb.from("supply_lots").update({ ...p.data, unit_cost: p.data.unit_cost ?? null }).eq("id", lotId);
  if (error) return fail(error.message);
  refresh(cur.supply_id);
  return { ok: true };
}

/** Marca la entrada como agotada ese día. Solo la que está en uso (la anterior tiene que estar agotada) y no antes de que empezara a usarse. */
export async function depleteLot(lotId: string, depletedOn: string): Promise<ActionResult> {
  await requireAccess("inventory");
  const d = day("La fecha de agotado").safeParse(depletedOn);
  if (!d.success) return { ok: false, error: d.error.issues[0].message };
  const sb = await createClient();
  const { data: one } = await sb.from("supply_lots").select("supply_id").eq("id", lotId).maybeSingle();
  if (!one) return { ok: false, error: "Esa entrada no existe." };
  const { data: all } = await sb.from("supply_lots").select("id,received_on,quantity,depleted_on").eq("supply_id", one.supply_id);
  const w = lotWindows((all ?? []).map((l) => ({ id: l.id, received_on: l.received_on, quantity: Number(l.quantity), depleted_on: l.depleted_on })), todayISO()).find((x) => x.lot.id === lotId);
  if (!w) return { ok: false, error: "Esa entrada no existe." };
  if (!w.open) return { ok: false, error: "Esa entrada ya está marcada como agotada." };
  if (w.waiting) return { ok: false, error: "Primero marca como agotada la entrada anterior: esta se empieza a usar cuando se acabe esa." };
  if (d.data < w.startDate) return { ok: false, error: `No puede ser antes de que empezara a usarse (${w.startDate}).` };
  const { error } = await sb.from("supply_lots").update({ depleted_on: d.data }).eq("id", lotId);
  if (error) return fail(error.message);
  refresh(one.supply_id);
  return { ok: true };
}

/** Quita la marca de agotada (si se marcó por error). Solo la última entrada agotada, para no desordenar la cronología. */
export async function reopenLot(lotId: string): Promise<ActionResult> {
  await requireAccess("inventory");
  const sb = await createClient();
  const { data: one } = await sb.from("supply_lots").select("supply_id,received_on,depleted_on").eq("id", lotId).maybeSingle();
  if (!one) return { ok: false, error: "Esa entrada no existe." };
  if (!one.depleted_on) return { ok: false, error: "Esa entrada no está marcada como agotada." };
  const { data: later } = await sb.from("supply_lots").select("id,received_on,depleted_on").eq("supply_id", one.supply_id).neq("id", lotId);
  if ((later ?? []).some((l) => l.depleted_on && (l.received_on > one.received_on || l.depleted_on > one.depleted_on))) return { ok: false, error: "Hay entradas posteriores ya agotadas: reabre primero la más reciente." };
  const { error } = await sb.from("supply_lots").update({ depleted_on: null }).eq("id", lotId);
  if (error) return fail(error.message);
  refresh(one.supply_id);
  return { ok: true };
}

export async function deleteLot(lotId: string): Promise<ActionResult> {
  await requireAccess("inventory");
  const sb = await createClient();
  const { data: one } = await sb.from("supply_lots").select("supply_id").eq("id", lotId).maybeSingle();
  const { error } = await sb.from("supply_lots").delete().eq("id", lotId);
  if (error) return fail(error.message);
  refresh(one?.supply_id);
  return { ok: true };
}
