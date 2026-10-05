"use client";

import { fmtDateTime } from "@/lib/format";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { createUser, deleteUser, resetUserPassword, updateUser } from "@/lib/actions/admin/users";
import { ROLE_LABEL, type Role } from "@/lib/permissions";
import { Alert } from "../primitives";
import { ConfirmDialog, Modal, useToast } from "../overlay";
import u from "../ui.module.css";

export type UserRow = { id: string; email: string; full_name: string; role: Role; employee_id: string | null; active: boolean; last_sign_in: string | null };
const ROLES: Role[] = ["super_admin", "manager", "receptionist", "specialist"];
const ROLE_HELP: Record<Role, string> = {
  super_admin: "Acceso completo, incluidos usuarios y permisos.",
  manager: "Dashboard, ventas, reportes, clientes, servicios, agenda y configuración.",
  receptionist: "Citas, clientes, reservaciones y cobros.",
  specialist: "Solo sus citas y clientes asignados; inicia y completa sus servicios.",
};

export function UsersManager({ users, employees, me }: { users: UserRow[]; employees: { id: string; full_name: string }[]; me: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [modal, setModal] = useState<null | { kind: "new" } | { kind: "edit"; u: UserRow } | { kind: "pw"; u: UserRow }>(null);
  const [del, setDel] = useState<UserRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({ email: "", password: "", fullName: "", role: "receptionist" as Role, employeeId: "", active: true });
  const [pw, setPw] = useState("");

  const open = (m: NonNullable<typeof modal>) => {
    setError(null); setPw("");
    if (m.kind === "new") setF({ email: "", password: "", fullName: "", role: "receptionist", employeeId: "", active: true });
    if (m.kind === "edit") setF({ email: m.u.email, password: "", fullName: m.u.full_name, role: m.u.role, employeeId: m.u.employee_id ?? "", active: m.u.active });
    setModal(m);
  };
  const submit = () => start(async () => {
    setError(null);
    const r = modal?.kind === "new"
      ? await createUser({ email: f.email, password: f.password, fullName: f.fullName, role: f.role, employeeId: f.employeeId || null })
      : modal?.kind === "edit" ? await updateUser(modal.u.id, { fullName: f.fullName, role: f.role, employeeId: f.employeeId || null, active: f.active })
      : modal?.kind === "pw" ? await resetUserPassword(modal.u.id, pw) : { ok: false as const, error: "" };
    if (!r.ok) return setError(r.error);
    toast(modal?.kind === "new" ? "Usuario creado" : modal?.kind === "pw" ? "Contraseña actualizada" : "Usuario actualizado");
    setModal(null); router.refresh();
  });

  return (
    <>
      <div style={{ marginBottom: 16 }}><Button size="sm" onClick={() => open({ kind: "new" })}>+ Nuevo usuario</Button></div>
      <div className={u.card}>
        <div className={u.tableWrap}>
          <table className={`${u.table} ${u.stack}`}>
            <thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Último ingreso</th><th>Estado</th><th><span className="sr-only">Acciones</span></th></tr></thead>
            <tbody>
              {users.map((x) => (
                <tr key={x.id}>
                  <td data-label="Nombre"><strong>{x.full_name}</strong>{x.id === me && <span className={`${u.badge} ${u.pink}`} style={{ marginLeft: 6 }}>Tú</span>}
                    {x.employee_id && <div className={u.hint}>Vinculado a {employees.find((e) => e.id === x.employee_id)?.full_name ?? "especialista"}</div>}</td>
                  <td data-label="Correo">{x.email}</td>
                  <td data-label="Rol">{ROLE_LABEL[x.role]}</td>
                  <td data-label="Último ingreso">{x.last_sign_in ? fmtDateTime(x.last_sign_in) : "Nunca"}</td>
                  <td data-label="Estado"><span className={`${u.badge} ${x.active ? u.green : u.gray}`}>{x.active ? "Activo" : "Desactivado"}</span></td>
                  <td><div className={u.rowActions}>
                    <Button size="sm" variant="soft" onClick={() => open({ kind: "edit", u: x })}>Editar</Button>
                    <Button size="sm" variant="secondary" onClick={() => open({ kind: "pw", u: x })}>Contraseña</Button>
                    {x.id !== me && <Button size="sm" variant="danger" onClick={() => setDel(x)}>Eliminar</Button>}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={modal?.kind === "new" || modal?.kind === "edit"} onClose={() => setModal(null)} title={modal?.kind === "new" ? "Nuevo usuario" : "Editar usuario"}>
        <form className={u.grid} onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <div className={u.field}><label htmlFor="us-n">Nombre</label><input id="us-n" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} required /></div>
          {modal?.kind === "new" && (
            <>
              <div className={u.field}><label htmlFor="us-e">Correo</label><input id="us-e" type="email" autoComplete="off" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></div>
              <div className={u.field}><label htmlFor="us-p">Contraseña temporal</label><input id="us-p" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required /><span className={u.hint}>Mínimo 10 caracteres, con letras y números. La persona puede cambiarla en “Mi cuenta”.</span></div>
            </>
          )}
          <div className={u.field}><label htmlFor="us-r">Rol</label>
            <select id="us-r" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
            <span className={u.hint}>{ROLE_HELP[f.role]}</span></div>
          <div className={u.field}><label htmlFor="us-emp">Vincular a especialista {f.role === "specialist" ? "(obligatorio)" : "(opcional)"}</label>
            <select id="us-emp" value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })}><option value="">—</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}</select></div>
          {modal?.kind === "edit" && <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Cuenta activa (si se desactiva, no puede entrar al panel)</label>}
          {error && <Alert>{error}</Alert>}
          <Button type="submit" block disabled={pending}>{pending ? "Guardando…" : "Guardar"}</Button>
        </form>
      </Modal>

      <Modal open={modal?.kind === "pw"} onClose={() => setModal(null)} title={`Contraseña de ${modal?.kind === "pw" ? modal.u.full_name : ""}`}>
        <form className={u.grid} onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <div className={u.field}><label htmlFor="us-np">Nueva contraseña</label><input id="us-np" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required /><span className={u.hint}>Mínimo 10 caracteres, con letras y números.</span></div>
          {error && <Alert>{error}</Alert>}
          <Button type="submit" block disabled={pending || pw.length < 10}>{pending ? "Guardando…" : "Cambiar contraseña"}</Button>
        </form>
      </Modal>

      <ConfirmDialog open={!!del} danger title={`¿Eliminar a ${del?.full_name}?`} confirmLabel="Eliminar" onClose={() => setDel(null)}
        text="Se borra su cuenta y ya no podrá entrar. Las citas, ventas y auditoría que realizó se conservan. Si solo quieres quitarle el acceso por un tiempo, mejor desactívala."
        onConfirm={() => del && start(async () => { const r = await deleteUser(del.id); toast(r.ok ? "Usuario eliminado" : r.error, r.ok ? "ok" : "err"); router.refresh(); })} />
    </>
  );
}
