import { NextResponse } from "next/server";
import { getAvailableSlots } from "@/lib/data/availability";
import { availabilityQuerySchema } from "@/lib/validation/booking";

export async function POST(req: Request) {
  const parsed = availabilityQuerySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Solicitud no válida" }, { status: 400 });
  const { date, employeeId, items, parallel } = parsed.data;
  const res = await getAvailableSlots({ date, employeeId, items, parallel });
  // No se expone qué especialista queda en cada hora ni la agenda interna.
  return NextResponse.json({
    slots: res.slots.map((s) => ({ time: s.time, start: s.start })),
    totalMinutes: res.totalMinutes,
    error: res.error,
  }, { headers: { "Cache-Control": "no-store" } });
}
