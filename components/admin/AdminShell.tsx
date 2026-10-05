"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CloseIcon, MenuIcon } from "@/components/ui/Icons";
import { logout } from "@/lib/actions/auth";
import { GlobalSearch } from "./GlobalSearch";
import { NotificationBell } from "./NotificationBell";
import { ToastProvider } from "./overlay";
import s from "./AdminShell.module.css";

export type NavItem = { href: string; label: string };
const ROLE_LABEL: Record<string, string> = { super_admin: "Super admin", manager: "Gerente", receptionist: "Recepción", specialist: "Especialista" };

function Nav({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const path = usePathname();
  const isActive = (h: string) => (h === "/admin" ? path === h : path === h || (path.startsWith(h + "/") && !items.some((o) => o.href !== h && o.href.startsWith(h + "/") && path.startsWith(o.href))));
  return (
    <nav className={s.nav} aria-label="Panel">
      {items.map((i) => (
        <Link key={i.href} href={i.href} onClick={onNavigate} className={`${s.link} ${isActive(i.href) ? s.active : ""}`} aria-current={isActive(i.href) ? "page" : undefined}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

function Profile({ name, role, email }: { name: string; role: string; email: string }) {
  return (
    <div className={s.profile}>
      <div><strong>{name}</strong><small>{ROLE_LABEL[role]} · {email}</small></div>
      <Link href="/admin/account" className={s.logout} style={{ display: "grid", placeItems: "center" }}>Mi cuenta</Link>
      <form action={logout}><button className={s.logout} type="submit" style={{ width: "100%" }}>Cerrar sesión</button></form>
    </div>
  );
}

export function AdminShell({ items, user, notifications, children }: {
  items: NavItem[]; user: { name: string; role: string; email: string };
  notifications: React.ComponentProps<typeof NotificationBell>["initial"]; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const canSeeBell = user.role !== "specialist";

  useEffect(() => {
    // La rueda del mouse no debe cambiar un precio o una cantidad por accidente al desplazar la página
    const onWheel = (e: WheelEvent) => {
      const t = e.target;
      if (t instanceof HTMLInputElement && t.type === "number" && t === document.activeElement) t.blur();
    };
    document.addEventListener("wheel", onWheel, { passive: true });
    return () => document.removeEventListener("wheel", onWheel);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <ToastProvider>
      <div className={s.shell}>
        <aside className={s.side}>
          <div className={s.logo}>Glow<small>Beauty Center</small></div>
          <Nav items={items} />
          <Profile {...user} />
        </aside>
        <div className={s.content}>
          <div className={s.top}>
            <button className={`${s.iconBtn} ${s.burger}`} onClick={() => setOpen(true)} aria-label="Abrir menú"><MenuIcon /></button>
            <GlobalSearch />
            {canSeeBell ? <NotificationBell initial={notifications} /> : <span />}
          </div>
          <main className={s.main} id="contenido">{children}</main>
        </div>
        <AnimatePresence>
          {open && (
            <>
              <motion.div className={s.overlay} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)} />
              <motion.aside className={s.drawer} role="dialog" aria-modal="true" aria-label="Menú" initial={{ x: "-100%" }} animate={{ x: 0 }} exit={{ x: "-100%" }} transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div className={s.logo}>Glow<small>Beauty Center</small></div>
                  <button className={s.iconBtn} onClick={() => setOpen(false)} aria-label="Cerrar menú"><CloseIcon /></button>
                </div>
                <Nav items={items} onNavigate={() => setOpen(false)} />
                <Profile {...user} />
              </motion.aside>
            </>
          )}
        </AnimatePresence>
      </div>
    </ToastProvider>
  );
}
