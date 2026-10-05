"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { STATUS_META } from "@/lib/domain/status";
import u from "./ui.module.css";

export function StatusFilter() {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  return (
    <div className={u.filters} style={{ margin: 0 }}>
      <label className="sr-only" htmlFor="f-status">Filtrar por estado</label>
      <select id="f-status" value={sp.get("status") ?? ""} onChange={(e) => {
        const p = new URLSearchParams(sp.toString());
        if (e.target.value) p.set("status", e.target.value); else p.delete("status");
        router.push(`${path}?${p.toString()}`);
      }}>
        <option value="">Todos los estados</option>
        {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
      </select>
    </div>
  );
}
