"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { addAppointmentNote } from "@/lib/actions/admin/appointments";
import { useToast } from "../overlay";
import u from "../ui.module.css";

export function NoteForm({ appointmentId }: { appointmentId: string }) {
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();
  return (
    <form className={u.field} onSubmit={(e) => {
      e.preventDefault();
      start(async () => {
        const r = await addAppointmentNote(appointmentId, text);
        if (r.ok) { setText(""); router.refresh(); toast("Nota guardada"); } else toast(r.error, "err");
      });
    }}>
      <label htmlFor="note">Agregar nota interna</label>
      <textarea id="note" value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} />
      <div><Button size="sm" type="submit" disabled={pending || !text.trim()}>Guardar nota</Button></div>
    </form>
  );
}
