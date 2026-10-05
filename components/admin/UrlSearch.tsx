"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import u from "./ui.module.css";

/** Buscador con debounce (300 ms) que guarda el término en la URL (?q=). */
export function UrlSearch({ placeholder, param = "q", label = "Buscar" }: { placeholder: string; param?: string; label?: string }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get(param) ?? "");
  useEffect(() => {
    const t = setTimeout(() => {
      const p = new URLSearchParams(sp.toString());
      if (q.trim()) p.set(param, q.trim()); else p.delete(param);
      p.delete("page");
      if (p.toString() !== sp.toString()) router.replace(`${path}?${p.toString()}`);
    }, 300);
    return () => clearTimeout(t);
  }, [q, router, sp, path, param]);
  return (
    <div className={u.filters} style={{ margin: 0 }}>
      <label className="sr-only" htmlFor={`search-${param}`}>{label}</label>
      <input id={`search-${param}`} type="search" placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 260 }} />
    </div>
  );
}
