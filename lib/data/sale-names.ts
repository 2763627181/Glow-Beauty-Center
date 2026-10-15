import "server-only";
import { createClient } from "@/lib/supabase/server";

let installed = false;
let lastCheck = 0;

/**
 * ¿Existe la columna «nombre del cliente» de las ventas (`sales.customer_name`, migración 20)? Si la base aún no la tiene, las pantallas
 * siguen funcionando como antes (sin ese nombre) en vez de fallar. Una vez que existe no se vuelve a preguntar; si falta, se revisa cada 20 s.
 */
export async function saleNamesInstalled(): Promise<boolean> {
  if (installed) return true;
  if (Date.now() - lastCheck < 20_000) return false;
  lastCheck = Date.now();
  const { error } = await (await createClient()).from("sales").select("customer_name").limit(1);
  installed = !error;
  return installed;
}

/** Para armar un `select`: «customer_name,» si la columna existe y nada si no. */
export const nameCol = (on: boolean) => (on ? "customer_name," : "");

/** Condición `or(...)` de búsqueda por nombre: solo si la columna existe. */
export const nameLike = (on: boolean, term: string) => (on ? `customer_name.ilike.%${term}%` : null);
