"use client";

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/ui/Button";
import { CloseIcon } from "@/components/ui/Icons";
import s from "./overlay.module.css";

/* ───────── Modal ───────── */
/** Pila de modales abiertos: Escape y Tab solo actúan sobre el de más arriba (p. ej. una confirmación sobre una ficha). */
const stack: symbol[] = [];
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  // `onClose` casi siempre llega como función nueva en cada render del padre. Si el efecto dependiera de ella,
  // cada tecla escrita en un formulario lo volvería a ejecutar y le robaría el foco al campo.
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });

  useEffect(() => {
    if (!open) return;
    const me = Symbol("modal");
    stack.push(me);
    const prev = document.activeElement as HTMLElement | null;
    // Si un campo ya tomó el foco (autoFocus), se respeta. Si no: con mouse/teclado el foco va al primer campo de texto
    // (la recepcionista empieza a escribir de inmediato); en pantallas táctiles va al cuadro, para no abrir el teclado sin pedirlo.
    const box = ref.current;
    if (box && !box.contains(document.activeElement)) {
      const fine = window.matchMedia?.("(pointer: fine)").matches ?? true;
      const field = fine ? box.querySelector<HTMLElement>('[data-autofocus], input:not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="hidden"]):not([disabled]), textarea:not([disabled])') : null;
      (field ?? box).focus();
    }
    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== me) return;
      if (e.key === "Escape") { e.preventDefault(); closeRef.current(); return; }
      if (e.key !== "Tab" || !ref.current) return;
      // Foco atrapado dentro del diálogo (Tab / Shift+Tab dan la vuelta)
      const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0);
      if (items.length === 0) { e.preventDefault(); return; }
      const first = items[0], last = items[items.length - 1], active = document.activeElement;
      if (e.shiftKey && (active === first || active === ref.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (active === last || !ref.current.contains(active))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      stack.splice(stack.indexOf(me), 1);
      if (prev && document.contains(prev)) prev.focus();
    };
  }, [open]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className={s.backdrop} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
          <motion.div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={id} className={`${s.modal} ${wide ? s.wide : ""}`}
            initial={{ opacity: 0, scale: 0.96, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }} transition={{ duration: 0.2 }}>
            <header className={s.head}>
              <h2 id={id}>{title}</h2>
              <button className={s.x} onClick={onClose} aria-label="Cerrar"><CloseIcon /></button>
            </header>
            <div className={s.body}>{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ───────── Confirm ───────── */
export function ConfirmDialog({ open, title, text, confirmLabel = "Confirmar", danger, onConfirm, onClose }: {
  open: boolean; title: string; text: string; confirmLabel?: string; danger?: boolean; onConfirm: () => void; onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p style={{ marginBottom: 20 }}>{text}</p>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Button variant="secondary" onClick={onClose}>Volver</Button>
        <Button variant={danger ? "danger" : "primary"} onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</Button>
      </div>
    </Modal>
  );
}

/* ───────── Toast ───────── */
type Toast = { id: number; kind: "ok" | "err"; text: string };
const ToastCtx = createContext<(text: string, kind?: "ok" | "err") => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: "ok" | "err" = "ok") => {
    const id = Date.now() + Math.random();
    setList((l) => [...l, { id, kind, text }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), 4200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className={s.toasts} aria-live="polite">
        <AnimatePresence>
          {list.map((t) => (
            <motion.div key={t.id} layout className={`${s.toast} ${t.kind === "err" ? s.toastErr : ""}`} role={t.kind === "err" ? "alert" : "status"}
              initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}>
              {t.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}
