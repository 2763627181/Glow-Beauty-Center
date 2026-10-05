"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { subscribeRealtime } from "@/lib/supabase/browser";

/** Refresca los datos del servidor cuando cambian las tablas indicadas (Supabase Realtime). */
export function LiveRefresh({ tables = ["appointments"] }: { tables?: string[] }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const key = tables.join(",");
  useEffect(() => {
    const close = subscribeRealtime((sb) => {
      const ch = sb.channel(`live-${key}`);
      for (const t of key.split(",")) {
        ch.on("postgres_changes", { event: "*", schema: "public", table: t }, () => {
          clearTimeout(timer.current);
          timer.current = setTimeout(() => router.refresh(), 500);
        });
      }
      return ch.subscribe();
    });
    return () => { close(); clearTimeout(timer.current); };
  }, [key, router]);
  return null;
}
