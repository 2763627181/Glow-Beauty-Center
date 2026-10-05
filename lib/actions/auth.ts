"use server";

import { redirect } from "next/navigation";
import { can, type Role } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

export type LoginState = { error?: string };

export async function login(_: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/admin");
  if (!email || !password) return { error: "Escribe tu correo y contraseña." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: "Correo o contraseña incorrectos." };

  // Debe existir un perfil de staff activo; si no, se cierra la sesión.
  const { data: u } = await supabase.auth.getUser();
  const { data: p } = await supabase.from("profiles").select("active, role").eq("id", u.user!.id).maybeSingle();
  if (!p?.active) {
    await supabase.auth.signOut();
    return { error: "Tu cuenta no tiene acceso al panel. Pide a un administrador que la active." };
  }
  const target = next.startsWith("/admin") ? next : "/admin";
  // Recepción y especialistas no tienen dashboard: entran directo a la agenda.
  redirect(target === "/admin" && !can(p.role as Role, "dashboard") ? "/admin/calendar" : target);
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/admin/login");
}
