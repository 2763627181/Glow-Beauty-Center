"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAccess, requireAction } from "@/lib/auth";
import { friendlyError } from "@/lib/domain/errors";
import { isValidDRPhone } from "@/lib/phone";
import { applyClientSearch } from "@/lib/data/client-search";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "./appointments";

const schema = z.object({
  first_name: z.string().trim().min(2, "Nombre requerido").max(60),
  last_name: z.string().trim().max(60).default(""),
  phone: z.string().refine(isValidDRPhone, "Teléfono no válido (809/829/849)"),
  email: z.union([z.literal(""), z.email("Correo no válido")]).optional(),
});

export async function saveClient(id: string | null, input: z.input<typeof schema>): Promise<ActionResult<{ id: string }>> {
  await requireAction("manageClients");
  const p = schema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const sb = await createClient();
  const row = { ...p.data, email: p.data.email || null };
  const { data, error } = id
    ? await sb.from("clients").update(row).eq("id", id).select("id").single()
    : await sb.from("clients").insert(row).select("id").single();
  if (error) return { ok: false, error: error.code === "23505" ? "Ya existe un cliente con ese teléfono. Búscalo o usa “Fusionar”." : "No se pudo guardar." };
  revalidatePath("/admin/clients");
  return { ok: true, id: data.id };
}

export async function saveClientNotes(id: string, notes: string): Promise<ActionResult> {
  await requireAction("manageClients");
  const sb = await createClient();
  const { error } = await sb.from("clients").update({ internal_notes: notes.slice(0, 4000) }).eq("id", id);
  if (error) return { ok: false, error: "No se pudo guardar la nota." };
  revalidatePath(`/admin/clients/${id}`);
  return { ok: true };
}

export async function setClientActive(id: string, active: boolean): Promise<ActionResult> {
  await requireAction("manageClients");
  const sb = await createClient();
  const { error } = await sb.from("clients").update({ active }).eq("id", id);
  if (error) return { ok: false, error: "No se pudo actualizar." };
  revalidatePath("/admin/clients", "layout");
  return { ok: true };
}

export async function mergeClients(keepId: string, removeId: string): Promise<ActionResult> {
  await requireAction("deleteRecords");
  const sb = await createClient();
  const { error } = await sb.rpc("merge_clients", { p_keep: keepId, p_remove: removeId });
  if (error) return { ok: false, error: friendlyError(error.message) };
  revalidatePath("/admin/clients", "layout");
  return { ok: true };
}

/** Candidatos para fusionar (por nombre o teléfono). */
export async function searchClientsForMerge(q: string, excludeId: string) {
  await requireAccess("clients");
  if (q.trim().length < 2) return [];
  const sb = await createClient();
  const { data } = await applyClientSearch(sb.from("clients").select("id,first_name,last_name,phone"), q)
    .neq("id", excludeId).limit(8);
  return (data ?? []).map((c) => ({ id: c.id, name: `${c.first_name} ${c.last_name}`.trim(), phone: c.phone }));
}
