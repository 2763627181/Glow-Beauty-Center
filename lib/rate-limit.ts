import "server-only";
import { headers } from "next/headers";

/** Límite simple en memoria por IP (freno básico por instancia; la base de datos impone los límites reales). */
const hits = new Map<string, number[]>();

export async function tooManyRequests(scope: string, max = 10, windowMs = 60_000) {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "local";
  const key = `${scope}:${ip}`;
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
  return recent.length > max;
}
