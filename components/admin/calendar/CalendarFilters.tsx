"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { STATUS_META } from "@/lib/domain/status";
import u from "../ui.module.css";

export function CalendarFilters({ employees, services }: { employees: { id: string; full_name: string }[]; services: { id: string; name: string }[] }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(sp.toString());
    if (v) p.set(k, v); else p.delete(k);
    router.push(`${path}?${p.toString()}`);
  };
  const sel = (id: string, label: string, k: string, opts: [string, string][]) => (
    <>
      <label className="sr-only" htmlFor={id}>{label}</label>
      <select id={id} value={sp.get(k) ?? ""} onChange={(e) => set(k, e.target.value)}>
        <option value="">{label}</option>
        {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </>
  );
  return (
    <div className={u.filters}>
      {sel("c-emp", "Todos los especialistas", "employee", employees.map((e) => [e.id, e.full_name]))}
      {sel("c-svc", "Todos los servicios", "service", services.map((x) => [x.id, x.name]))}
      {sel("c-st", "Todos los estados", "status", Object.entries(STATUS_META).map(([k, v]) => [k, v.label]))}
    </div>
  );
}
