import "server-only";
import { createClient } from "@supabase/supabase-js";

/** Cliente service_role. SOLO servidor: omite RLS. Úsalo tras validar permisos. */
export function createAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
