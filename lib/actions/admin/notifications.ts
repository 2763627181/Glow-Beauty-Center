"use server";

import { createClient } from "@/lib/supabase/server";

export async function markNotificationRead(id: string): Promise<{ ok: boolean }> {
  const sb = await createClient();
  const { error } = await sb.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id).is("read_at", null);
  return { ok: !error };
}

export async function markAllNotificationsRead(): Promise<{ ok: boolean }> {
  const sb = await createClient();
  const { error } = await sb.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
  return { ok: !error };
}
