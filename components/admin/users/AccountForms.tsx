"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { changeMyPassword, updateMyName } from "@/lib/actions/admin/users";
import { Alert } from "../primitives";
import { useToast } from "../overlay";
import u from "../ui.module.css";

export function AccountForms({ name }: { name: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [n, setN] = useState(name);
  const [pw, setPw] = useState({ a: "", b: "" });
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className={u.grid}>
      <form className={`${u.card} ${u.grid}`} onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await updateMyName(n); toast(r.ok ? "Nombre actualizado" : r.error, r.ok ? "ok" : "err"); router.refresh(); }); }}>
        <h2>Mi nombre</h2>
        <div className={u.field}><label htmlFor="ac-n">Nombre</label><input id="ac-n" value={n} onChange={(e) => setN(e.target.value)} required /></div>
        <div><Button type="submit" size="sm" disabled={pending || n.trim() === name}>Guardar nombre</Button></div>
      </form>
      <form className={`${u.card} ${u.grid}`} onSubmit={(e) => {
        e.preventDefault(); setErr(null);
        if (pw.a !== pw.b) return setErr("Las contraseñas no coinciden.");
        start(async () => { const r = await changeMyPassword(pw.a); if (!r.ok) return setErr(r.error); setPw({ a: "", b: "" }); toast("Contraseña actualizada"); });
      }}>
        <h2>Cambiar contraseña</h2>
        <div className={u.field}><label htmlFor="ac-p1">Nueva contraseña</label><input id="ac-p1" type="password" autoComplete="new-password" value={pw.a} onChange={(e) => setPw({ ...pw, a: e.target.value })} required /><span className={u.hint}>Mínimo 10 caracteres, con letras y números.</span></div>
        <div className={u.field}><label htmlFor="ac-p2">Repite la contraseña</label><input id="ac-p2" type="password" autoComplete="new-password" value={pw.b} onChange={(e) => setPw({ ...pw, b: e.target.value })} required /></div>
        {err && <Alert>{err}</Alert>}
        <div><Button type="submit" size="sm" disabled={pending || pw.a.length < 10}>Cambiar contraseña</Button></div>
      </form>
    </div>
  );
}
