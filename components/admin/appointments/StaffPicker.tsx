"use client";

import { staffChoices } from "./lines";
import u from "../ui.module.css";

type Staff = { id: string; full_name: string; active: boolean };
type Link = { employee_id: string; service_id: string };

/**
 * Elegir las especialistas de UN servicio: se marcan con casillas (una o varias; las marcadas trabajan en el servicio al mismo
 * tiempo). Primero salen las que tienen el servicio marcado y aparte el resto del equipo (recepción puede asignar a cualquiera).
 */
export function StaffPicker({ label, serviceId, staff, links, value, onChange }: {
  label: string; serviceId: string | null | undefined; staff: Staff[]; links: Link[]; value: string[]; onChange: (ids: string[]) => void;
}) {
  const { usual, others } = staffChoices(serviceId, staff, links);
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const chip = (s: Staff) => (
    <label key={s.id} className={u.chipPick}>
      <input type="checkbox" checked={value.includes(s.id)} onChange={() => toggle(s.id)} />
      {s.full_name}
    </label>
  );
  return (
    <div role="group" aria-label={`Especialistas para ${label}`} style={{ display: "grid", gap: 6 }}>
      {usual.length > 0 && <div className={u.chips}>{usual.map(chip)}</div>}
      {others.length > 0 && (
        <>
          {usual.length > 0 && <span className={u.hint}>Otras especialistas (no tienen este servicio marcado):</span>}
          <div className={u.chips}>{others.map(chip)}</div>
        </>
      )}
      {value.length === 0 && <span className={u.hint}>Sin asignar</span>}
      {value.length > 1 && <span className={u.hint}>Las {value.length} trabajan este servicio al mismo tiempo; el precio se reparte entre ellas.</span>}
    </div>
  );
}
