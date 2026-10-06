"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "./overlay";
import s from "./ExportMenu.module.css";

type Group = { label?: string; href: string };
const FORMATS = [
  { key: "xlsx", label: "Excel", ext: ".xlsx", hint: "Con formato, filtros y totales" },
  { key: "pdf", label: "PDF", ext: "", hint: "Listo para imprimir o compartir" },
  { key: "csv", label: "CSV", ext: "", hint: "Datos simples para otros programas" },
] as const;

/** Nombre del archivo que manda el servidor en Content-Disposition. */
function fileNameOf(res: Response, fallback: string) {
  const h = res.headers.get("Content-Disposition") ?? "";
  const star = /filename\*=UTF-8''([^;]+)/i.exec(h)?.[1];
  if (star) { try { return decodeURIComponent(star); } catch { /* usa el siguiente */ } }
  return /filename="([^"]+)"/i.exec(h)?.[1] ?? fallback;
}

/** Botón «Exportar» con Excel, PDF y CSV. Descarga con fetch para poder avisar si algo falla (en vez de bajar una página de error). */
export function ExportMenu({ groups }: { groups: Group[] }) {
  const toast = useToast();
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [alignRight, setAlignRight] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); box.current?.querySelector("button")?.focus(); } };
    document.addEventListener("mousedown", onDown); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  function toggle() {
    if (!open && box.current) setAlignRight(box.current.getBoundingClientRect().right > 300);
    setOpen((o) => !o);
  }

  async function download(href: string, format: string, key: string) {
    setBusy(key);
    try {
      const res = await fetch(`${href}${href.includes("?") ? "&" : "?"}format=${format}`, { credentials: "same-origin" });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = fileNameOf(res, `exportacion.${format}`);
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast("Archivo descargado");
      setOpen(false);
    } catch {
      toast("No se pudo generar el archivo. Inténtalo de nuevo.", "err");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={s.box} ref={box}>
      <Button size="sm" variant="secondary" aria-expanded={open} aria-controls={id} onClick={toggle}>Exportar <span aria-hidden>▾</span></Button>
      {open && (
        <div id={id} role="group" aria-label="Formatos de exportación" className={`${s.panel} ${alignRight ? s.right : s.left}`}>
          {groups.map((g, gi) => (
            <div key={g.href} className={s.group}>
              {g.label && <p className={s.title}>{g.label}</p>}
              {FORMATS.map((f) => {
                const key = `${gi}-${f.key}`;
                return (
                  <button key={f.key} type="button" className={s.item} disabled={busy !== null} onClick={() => download(g.href, f.key, key)}>
                    <strong>{busy === key ? "Generando…" : `${f.label}${f.ext ? ` (${f.ext})` : ""}`}</strong>
                    <small>{f.hint}</small>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
