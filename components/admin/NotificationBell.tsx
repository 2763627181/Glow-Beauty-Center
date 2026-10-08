"use client";

import { fmtDateTime } from "@/lib/format";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { BellIcon } from "@/components/ui/Icons";
import { markAllNotificationsRead, markNotificationRead } from "@/lib/actions/admin/notifications";
import { clearNotifications } from "@/lib/actions/admin/records";
import { subscribeRealtime } from "@/lib/supabase/browser";
import s from "./AdminShell.module.css";
import { useToast } from "./overlay";

type N = { id: string; title: string; body: string | null; appointment_id: string | null; sale_id?: string | null; employee_id?: string | null; read_at: string | null; created_at: string };

export function NotificationBell({ initial }: { initial: N[] }) {
  const [list, setList] = useState<N[]>(initial);
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const unread = list.filter((n) => !n.read_at).length;

  useEffect(() => subscribeRealtime((sb) => sb.channel("notifications")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications" }, (p) => {
      const n = p.new as N;
      setList((l) => [n, ...l].slice(0, 30));
      toast(n.title);
    })
    .subscribe()), [toast]);

  async function read(id: string) {
    const before = list;
    setList((l) => l.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)));
    const r = await markNotificationRead(id).catch(() => ({ ok: false }));
    if (!r.ok) { setList(before); toast("No se pudo marcar como leída", "err"); }
  }
  async function readAll() {
    const before = list;
    setList((l) => l.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
    const r = await markAllNotificationsRead().catch(() => ({ ok: false }));
    if (!r.ok) { setList(before); toast("No se pudieron marcar como leídas", "err"); }
  }

  async function clear(onlyRead: boolean) {
    const before = list;
    setList((l) => (onlyRead ? l.filter((n) => !n.read_at) : []));
    const r = await clearNotifications(onlyRead).catch(() => ({ ok: false as const, error: "" }));
    if (!r.ok) { setList(before); toast("No se pudieron borrar los avisos", "err"); } else toast(r.deleted === 1 ? "Aviso borrado" : `${r.deleted} avisos borrados`);
  }

  return (
    <div style={{ position: "relative" }}>
      <button className={s.iconBtn} onClick={() => setOpen((o) => !o)} aria-label={`Notificaciones, ${unread} sin leer`} aria-expanded={open}>
        <BellIcon />
        {unread > 0 && <span className={s.dot}>{unread > 9 ? "9+" : unread}</span>}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div className={s.panel} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <div className={s.panelHead}>Notificaciones {unread > 0 && <button className={s.mini} onClick={readAll}>Marcar todo leído</button>}</div>
            {list.length === 0 && <p className={s.notif}>Sin notificaciones.</p>}
            {list.length > 0 && (
              <div className={s.panelHead} style={{ fontWeight: 400, gap: 8, justifyContent: "flex-end" }}>
                {list.some((n) => n.read_at) && <button className={s.mini} onClick={() => clear(true)}>Borrar leídas</button>}
                <button className={s.mini} onClick={() => clear(false)}>Borrar todas</button>
              </div>
            )}
            {list.map((n) => (
              <Link key={n.id} href={n.appointment_id ? `/admin/appointments/${n.appointment_id}` : n.sale_id ? `/admin/sales/${n.sale_id}` : n.employee_id ? `/admin/staff/${n.employee_id}` : "/admin/appointments"}
                className={`${s.notif} ${n.read_at ? "" : s.unread}`} onClick={() => { read(n.id); setOpen(false); }}>
                <strong>{n.title}</strong>
                <small>{n.body} · {fmtDateTime(n.created_at)}</small>
              </Link>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
