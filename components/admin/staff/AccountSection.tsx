"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { createStaffAccount, setAccountActive } from "@/lib/actions/admin/staff";
import { Alert } from "../primitives";
import { useToast } from "../overlay";
import u from "../ui.module.css";

type Acc = { id: string; full_name: string | null; role: string; active: boolean; employee_id: string | null };
const ROLES = [["manager", "Gerente"], ["receptionist", "Recepción"], ["specialist", "Especialista"]] as const;

export function AccountSection({ employeeId, employeeName, accounts }: { employeeId: string | null; employeeName: string; accounts: Acc[] }) {
  const [f, setF] = useState({ email: "", password: "", role: "specialist" as "manager" | "receptionist" | "specialist" });
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();
  return (
    <section className={u.card}>
      <h2>Acceso al panel</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
        {accounts.map((a) => (
          <li key={a.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
            <span>{a.full_name} · {ROLES.find(([k]) => k === a.role)?.[1] ?? a.role} <span className={`${u.badge} ${a.active ? u.green : u.gray}`}>{a.active ? "Activa" : "Desactivada"}</span></span>
            <Button size="sm" variant="secondary" onClick={() => start(async () => { const r = await setAccountActive(a.id, !a.active); if (r.ok) router.refresh(); else toast(r.error, "err"); })}>{a.active ? "Desactivar" : "Activar"}</Button>
          </li>
        ))}
        {accounts.length === 0 && <li className={u.sub}>Esta persona aún no tiene acceso.</li>}
      </ul>
      <div className={u.form2} style={{ marginTop: 12 }}>
        <div className={u.field}><label htmlFor="a-em">Correo</label><input id="a-em" type="email" autoComplete="off" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
        <div className={u.field}><label htmlFor="a-pw">Contraseña (mín. 10)</label><input id="a-pw" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></div>
        <div className={u.field}><label htmlFor="a-role">Rol</label>
          <select id="a-role" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as typeof f.role })}>{ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        {err && <div className={u.span2}><Alert>{err}</Alert></div>}
        <div className={u.span2}><Button size="sm" disabled={pending || !f.email || f.password.length < 10} onClick={() => start(async () => {
          setErr(null);
          const r = await createStaffAccount({ employeeId, fullName: employeeName, ...f });
          if (r.ok) { setF({ email: "", password: "", role: "specialist" }); toast("Cuenta creada"); router.refresh(); } else setErr(r.error);
        })}>Crear cuenta</Button></div>
      </div>
    </section>
  );
}
