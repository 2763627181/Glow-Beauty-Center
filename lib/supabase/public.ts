import { createClient } from "@supabase/supabase-js";

/** Cliente anónimo sin cookies: permite cachear el catálogo público (ISR). Respeta RLS como rol `anon`. */
export function createPublicClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
