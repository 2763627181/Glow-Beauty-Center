"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAction } from "@/lib/auth";
import { round2 } from "@/lib/domain/cash";
import { friendlyError } from "@/lib/domain/errors";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "./appointments";

/**
 * Caja: abrir y cerrar el turno, registrar entradas y salidas de efectivo, anular movimientos y reabrir un cierre.
 * Los permisos y las reglas (una sola caja abierta, una salida no puede ser mayor al efectivo que hay, la nota obligatoria si hay
 * diferencia…) las impone la base de datos; aquí solo se validan los datos y se traducen los errores.
 */
const fail = (m?: string | null): { ok: false; error: string } => ({ ok: false, error: friendlyError(m) });
const refresh = () => revalidatePath("/admin", "layout");
const money = (label: string, min = 0) => z.number({ error: `${label} no es válido` }).finite().min(min, `${label} no puede ser negativo`).max(1_000_000_000, `${label} es demasiado grande`);
const note = z.string().trim().max(300, "La nota es demasiado larga (máximo 300 letras)").optional();

export async function openCash(input: { opening: number; note?: string }): Promise<ActionResult<{ id: string; number: string }>> {
  await requireAction("manageCash");
  const p = z.object({ opening: money("El fondo inicial"), note }).safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const { data, error } = await (await createClient()).rpc("open_cash_session", { p_opening: round2(p.data.opening), p_note: p.data.note || null });
  if (error) return fail(error.message);
  refresh();
  return { ok: true, id: data.id, number: data.number };
}

export async function closeCash(input: { counted: number; note?: string }): Promise<ActionResult<{ id: string; number: string; expected: number; difference: number }>> {
  await requireAction("manageCash");
  const p = z.object({ counted: money("El efectivo contado"), note }).safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const { data, error } = await (await createClient()).rpc("close_cash_session", { p_counted: round2(p.data.counted), p_note: p.data.note || null });
  if (error) return fail(error.message);
  refresh();
  return { ok: true, id: data.id, number: data.number, expected: Number(data.expected), difference: Number(data.difference) };
}

const movement = z.object({
  kind: z.enum(["entrada", "salida"]),
  category: z.enum(["pago_especialista", "propina", "compra", "gasto", "retiro", "aporte", "otro"]),
  amount: money("El monto").refine((v) => v > 0, "Escribe un monto mayor a 0"),
  description: z.string().trim().max(200, "El detalle es demasiado largo (máximo 200 letras)").optional(),
  employeeId: z.uuid().nullish(),
});
export type CashMovementInput = z.input<typeof movement>;

export async function addCashMovement(input: CashMovementInput): Promise<ActionResult<{ expected: number }>> {
  await requireAction("manageCash");
  const p = movement.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const { data, error } = await (await createClient()).rpc("add_cash_movement", {
    p_kind: p.data.kind, p_category: p.data.category, p_amount: round2(p.data.amount), p_description: p.data.description || null, p_employee: p.data.employeeId ?? null,
  });
  if (error) return fail(error.message);
  refresh();
  return { ok: true, expected: Number(data.expected) };
}

const reason = z.string().trim().min(1, "Escribe el motivo.").max(300, "El motivo es demasiado largo (máximo 300 letras)");

export async function voidCashMovement(id: string, why: string): Promise<ActionResult<{ expected: number }>> {
  await requireAction("voidCash");
  const p = z.object({ id: z.uuid(), why: reason }).safeParse({ id, why });
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const { data, error } = await (await createClient()).rpc("void_cash_movement", { p_movement: p.data.id, p_reason: p.data.why });
  if (error) return fail(error.message);
  refresh();
  return { ok: true, expected: Number(data.expected) };
}

export async function reopenCash(id: string, why: string): Promise<ActionResult> {
  await requireAction("voidCash");
  const p = z.object({ id: z.uuid(), why: reason }).safeParse({ id, why });
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const { error } = await (await createClient()).rpc("reopen_cash_session", { p_session: p.data.id, p_reason: p.data.why });
  if (error) return fail(error.message);
  refresh();
  return { ok: true };
}
