"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { AdminData } from "@/lib/data/admin";
import { allowed, type ActionKey } from "@/lib/permissions";

const Ctx = createContext<AdminData | null>(null);

export function AdminProvider({ data, children }: { data: AdminData; children: ReactNode }) {
  return <Ctx.Provider value={data}>{children}</Ctx.Provider>;
}

export function useAdmin() {
  const d = useContext(Ctx);
  if (!d) throw new Error("useAdmin fuera de AdminProvider");
  return d;
}

/** ¿El rol actual puede realizar la acción? (solo adapta la interfaz; la BD impone el permiso real) */
export function useCan(action: ActionKey) {
  return allowed(useAdmin().role, action);
}
