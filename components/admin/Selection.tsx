"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import u from "./ui.module.css";

/** Selección de filas de una lista (para acciones en bloque). Los ids que ya no están en la lista se descartan solos. */
export function useSelection(allIds: string[]) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const ids = allIds.filter((id) => picked.has(id));
  const all = allIds.length > 0 && ids.length === allIds.length;
  return {
    ids, all, has: (id: string) => picked.has(id),
    toggle: (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }),
    toggleAll: () => setPicked(all ? new Set() : new Set(allIds)),
    clear: () => setPicked(new Set()),
  };
}

export function SelectBox({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return <input type="checkbox" checked={checked} onChange={onChange} aria-label={label} style={{ width: 18, height: 18, accentColor: "var(--color-primary)" }} />;
}

/** Barra que aparece al marcar filas: «3 seleccionadas · Eliminar seleccionadas · Quitar selección». */
export function BulkBar({ text, deleteLabel, onDelete, onClear }: { text: string; deleteLabel: string; onDelete: () => void; onClear: () => void }) {
  return (
    <div role="region" aria-label="Acciones sobre la selección" className={u.bulkBar}>
      <strong>{text}</strong>
      <Button size="sm" variant="danger" onClick={onDelete}>{deleteLabel}</Button>
      <Button size="sm" variant="secondary" onClick={onClear}>Quitar selección</Button>
    </div>
  );
}
