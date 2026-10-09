"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Alert } from "../primitives";
import { Modal, useToast } from "../overlay";
import u from "../ui.module.css";

/** Pide un motivo obligatorio antes de hacer algo que queda en Auditoría (anular un movimiento, reabrir un cierre). */
export function ReasonModal({ title, text, confirmLabel, doneMessage, danger, run, onClose }: {
  title: string; text: string; confirmLabel: string; doneMessage: string; danger?: boolean;
  run: (reason: string) => Promise<{ ok: boolean; error?: string }>; onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, start] = useTransition();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal open onClose={onClose} title={title}>
      <form className={u.grid} onSubmit={(e) => {
        e.preventDefault(); setError(null);
        if (!reason.trim()) return setError("Escribe el motivo.");
        start(async () => {
          const r = await run(reason.trim());
          if (!r.ok) return setError(r.error ?? "No se pudo completar.");
          toast(doneMessage); router.refresh(); onClose();
        });
      }}>
        <p>{text}</p>
        <div className={u.field}><label htmlFor="rs-reason">Motivo (obligatorio)</label><textarea id="rs-reason" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        {error && <Alert>{error}</Alert>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button type="button" variant="secondary" onClick={onClose}>Volver</Button>
          <Button type="submit" variant={danger ? "danger" : "primary"} disabled={busy}>{busy ? "Guardando…" : confirmLabel}</Button>
        </div>
      </form>
    </Modal>
  );
}
