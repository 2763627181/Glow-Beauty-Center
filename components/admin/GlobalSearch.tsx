"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { globalSearch, type SearchResults } from "@/lib/actions/admin/search";
import s from "./GlobalSearch.module.css";

/** Buscador global (atajo: “/”). Encuentra clientes, citas y ventas desde cualquier pantalla. */
export function GlobalSearch() {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<SearchResults | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (q.trim().length < 2) { setRes(null); setBusy(false); return; } // eslint-disable-line react-hooks/set-state-in-effect
    setBusy(true);
    let cancel = false;
    const t = setTimeout(async () => {
      const r = await globalSearch(q).catch(() => null);
      if (!cancel) { setRes(r); setBusy(false); }
    }, 250);
    return () => { cancel = true; clearTimeout(t); };
  }, [q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(tag)) { e.preventDefault(); input.current?.focus(); }
      if (e.key === "Escape") { setOpen(false); input.current?.blur(); }
    };
    const onClick = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("keydown", onKey); document.addEventListener("mousedown", onClick);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onClick); };
  }, []);

  const close = () => { setOpen(false); setQ(""); };
  const empty = res && !res.clients.length && !res.appointments.length && !res.sales.length;
  return (
    <div className={s.box} ref={box} role="search">
      <label className="sr-only" htmlFor="gsearch">Buscar clientes, citas o ventas</label>
      <input ref={input} id="gsearch" className={s.input} type="search" placeholder="Buscar cliente, cita o venta…" aria-keyshortcuts="/" autoComplete="off" value={q} onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }} />
      <kbd className={s.kbd} aria-hidden="true">/</kbd>
      {open && q.trim().length >= 2 && (
        <div className={s.panel} aria-live="polite">
          {busy && !res && <p className={s.note}>Buscando…</p>}
          {empty && <p className={s.note}>Sin resultados para “{q}”.</p>}
          {res && res.clients.length > 0 && (
            <section><h3>Clientes</h3>{res.clients.map((c) => <Link key={c.id} href={`/admin/clients/${c.id}`} onClick={close}><strong>{c.name}</strong><small>{c.phone}</small></Link>)}</section>
          )}
          {res && res.appointments.length > 0 && <section><h3>Citas</h3>{res.appointments.map((a) => <Link key={a.id} href={`/admin/appointments/${a.id}`} onClick={close}><strong>{a.title}</strong><small>{a.sub}</small></Link>)}</section>}
          {res && res.sales.length > 0 && <section><h3>Ventas</h3>{res.sales.map((x) => <Link key={x.id} href={`/admin/sales/${x.id}`} onClick={close}><strong>{x.title}</strong><small>{x.sub}</small></Link>)}</section>}
        </div>
      )}
    </div>
  );
}
