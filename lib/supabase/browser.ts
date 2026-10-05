import { createBrowserClient } from "@supabase/ssr";
import type { RealtimeChannel } from "@supabase/supabase-js";

export function createBrowserSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}

/**
 * Abre un canal de Realtime solo después de cargar la sesión y entregarle su token a Realtime.
 * Si el canal se une antes, el servidor evalúa las políticas RLS como «anon» y los eventos nunca llegan
 * (las tablas del panel solo las ve el personal). `build` crea y suscribe el canal; se devuelve la función para cerrarlo.
 */
export function subscribeRealtime(build: (sb: ReturnType<typeof createBrowserSupabase>) => RealtimeChannel): () => void {
  const sb = createBrowserSupabase();
  let channel: RealtimeChannel | null = null;
  let closed = false;
  void sb.auth.getSession().then(({ data }) => {
    if (closed) return;
    if (data.session) sb.realtime.setAuth(data.session.access_token);
    channel = build(sb);
  });
  return () => {
    closed = true;
    if (channel) void sb.removeChannel(channel);
  };
}
