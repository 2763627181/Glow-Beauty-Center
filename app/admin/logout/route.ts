import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Destino cuando alguien tiene sesión de Supabase pero ya no tiene acceso al panel (cuenta desactivada o sin perfil de personal).
 * Cierra esa sesión y vuelve al ingreso con el aviso. Sin esto, el login lo devolvería al panel y el panel al login (bucle infinito).
 * Una persona del personal con acceso vigente no se desconecta por aquí (no se puede cerrar la sesión de otro con un enlace).
 */
export async function GET(request: NextRequest) {
  if (await getSession()) return NextResponse.redirect(new URL("/admin", request.url));
  const sb = await createClient();
  await sb.auth.signOut();
  return NextResponse.redirect(new URL("/admin/login?error=sin-acceso", request.url));
}
