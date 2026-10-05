"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { login, type LoginState } from "@/lib/actions/auth";
import s from "./LoginForm.module.css";

export function LoginForm({ next, noAccess }: { next: string; noAccess: boolean }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});
  const error = state.error ?? (noAccess ? "Tu cuenta no tiene acceso al panel." : undefined);
  return (
    <main className={s.page}>
      <form action={action} className={s.card}>
        <h1 className="sr-only">Ingresar al panel de administración</h1>
        <div className={s.brand} aria-hidden="true"><span>Glow</span><small>Beauty Center · Administración</small></div>
        <input type="hidden" name="next" value={next} />
        <div className={s.field}>
          <label htmlFor="email">Correo</label>
          <input id="email" name="email" type="email" autoComplete="username" required />
        </div>
        <div className={s.field}>
          <label htmlFor="password">Contraseña</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
        {error && <p className={s.error} role="alert">{error}</p>}
        <Button type="submit" block disabled={pending}>{pending ? "Ingresando…" : "Ingresar"}</Button>
      </form>
    </main>
  );
}
