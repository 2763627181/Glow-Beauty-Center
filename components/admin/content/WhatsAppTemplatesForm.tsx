"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { saveSetting } from "@/lib/actions/admin/content";
import { DEFAULT_WA_TEMPLATES, renderTemplate, WA_VARIABLES, type WaTemplates } from "@/lib/domain/whatsappTemplates";
import { Alert } from "../primitives";
import u from "../ui.module.css";
import { useSave } from "./SettingsForms";

const SAMPLE = { nombre: "María", servicios: "Manicure, Pintura gel", fecha: "lunes, 5 de octubre", hora: "10:00 AM", total: "RD$ 1,300", negocio: "Glow Beauty Center" };
const LABEL: Record<keyof WaTemplates, string> = { confirm: "Confirmación de cita", reminder: "Recordatorio", generic: "Mensaje libre" };

/** Plantillas de los mensajes de WhatsApp que el personal envía a las clientas. */
export function WhatsAppTemplatesForm({ initial }: { initial: WaTemplates }) {
  const [t, setT] = useState(initial);
  const [focus, setFocus] = useState<keyof WaTemplates>("confirm");
  const refs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const { pending, err, save } = useSave();

  const insert = (v: string) => {
    const el = refs.current[focus];
    const start = el?.selectionStart ?? t[focus].length, end = el?.selectionEnd ?? start;
    setT({ ...t, [focus]: t[focus].slice(0, start) + v + t[focus].slice(end) });
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(start + v.length, start + v.length); });
  };

  return (
    <form className={u.grid} onSubmit={(e) => { e.preventDefault(); save(() => saveSetting("whatsapp_templates", t), "Plantillas guardadas"); }}>
      <section className={u.card}>
        <h2>Plantillas de WhatsApp</h2>
        <p className={u.hint} style={{ marginBottom: 10 }}>Se usan en el botón “Hablar por WhatsApp” de las citas. Toca una variable para insertarla donde está el cursor.</p>
        <div className={u.rowActions} style={{ marginBottom: 12 }}>
          {WA_VARIABLES.map((v) => <button key={v} type="button" className={`${u.badge} ${u.sage}`} style={{ border: 0, minHeight: 34, cursor: "pointer" }} onClick={() => insert(v)}>{v}</button>)}
        </div>
        {(Object.keys(LABEL) as (keyof WaTemplates)[]).map((k) => (
          <div key={k} className={u.field} style={{ marginBottom: 14 }}>
            <label htmlFor={`wa-${k}`}>{LABEL[k]}</label>
            <textarea id={`wa-${k}`} ref={(el) => { refs.current[k] = el; }} rows={3} maxLength={500} value={t[k]} onFocus={() => setFocus(k)} onChange={(e) => setT({ ...t, [k]: e.target.value })} />
            <span className={u.hint}>Vista previa: {renderTemplate(t[k], SAMPLE)}</span>
          </div>
        ))}
        {err && <Alert>{err}</Alert>}
        <div className={u.rowActions}>
          <Button type="submit" size="sm" disabled={pending}>{pending ? "Guardando…" : "Guardar plantillas"}</Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => setT(DEFAULT_WA_TEMPLATES)}>Restablecer originales</Button>
        </div>
      </section>
    </form>
  );
}
