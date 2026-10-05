import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Respaldo de pg_cron (que ya corre cada 5 min dentro de la base de datos): genera los avisos internos de «cita en menos de
 * 1 hora» y «pago pendiente». Útil solo si el proyecto no tiene pg_cron. Protegido con CRON_SECRET
 * (Vercel Cron lo envía como `Authorization: Bearer <CRON_SECRET>`).
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return new NextResponse("No autorizado", { status: 401 });
  const { data, error } = await createAdminClient().rpc("generate_reminders");
  if (error) return NextResponse.json({ ok: false }, { status: 500 });
  return NextResponse.json({ ok: true, created: data });
}
