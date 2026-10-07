"use client";

import { CheckIcon } from "@/components/ui/Icons";
import type { Employee } from "@/types/domain";
import { useCart } from "../cart/CartProvider";
import s from "./BookingFlow.module.css";
import type { StepProps } from "./state";

/**
 * Una pregunta por servicio: «cualquier especialista disponible» o las especialistas que prefieres (puedes elegir varias:
 * todas las que marques te atienden a la vez en ese servicio). Si hay dos o más servicios, también puedes pedir que
 * te los hagan al mismo tiempo.
 */
export function StepSpecialist({ form, set, employees, links }: StepProps & { employees: Employee[]; links: { employee_id: string; service_id: string }[] }) {
  const cart = useCart();
  const staffOf = (serviceId: string) => form.staff[serviceId] ?? [];
  const setStaff = (serviceId: string, ids: string[]) => set({ staff: { ...form.staff, [serviceId]: ids }, slot: null });

  return (
    <div style={{ display: "grid", gap: 24 }}>
      {cart.lines.map((l) => {
        const sid = l.item.serviceId;
        const rows = links.filter((x) => x.service_id === sid);
        const eligible = rows.length ? employees.filter((e) => rows.some((x) => x.employee_id === e.id)) : employees;
        const chosen = staffOf(sid).filter((id) => eligible.some((e) => e.id === id));
        return (
          <fieldset key={sid} style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 10 }}>
            <legend style={{ fontWeight: 600, marginBottom: 6 }}>{l.name}</legend>
            {eligible.length === 0 && <p className={s.muted}>Por ahora no hay una especialista disponible para este servicio. Escríbenos por WhatsApp y te ayudamos.</p>}
            <div className={s.group} role="group" aria-label={`Especialistas para ${l.name}`}>
              <button type="button" aria-pressed={chosen.length === 0} className={`${s.row} ${chosen.length === 0 ? s.rowOn : ""}`} onClick={() => setStaff(sid, [])}>
                <span className={s.check}>{chosen.length === 0 && <CheckIcon width={16} height={16} />}</span>
                <span className={s.rowMain}><strong>Cualquier especialista disponible</strong><small>Te asignamos a quien tenga el horario libre</small></span>
              </button>
              {eligible.map((e) => {
                const on = chosen.includes(e.id);
                return (
                  <button key={e.id} type="button" role="checkbox" aria-checked={on} className={`${s.row} ${on ? s.rowOn : ""}`}
                    onClick={() => setStaff(sid, on ? chosen.filter((x) => x !== e.id) : [...chosen, e.id])}>
                    <span className={s.check}>{on && <CheckIcon width={16} height={16} />}</span>
                    <span className={s.rowMain}><strong>{e.full_name}</strong>{e.specialty && <small>{e.specialty}</small>}</span>
                  </button>
                );
              })}
            </div>
            {chosen.length > 1 && <p className={s.muted}>Las {chosen.length} especialistas que marcaste te atenderán <strong>al mismo tiempo</strong> en este servicio.</p>}
          </fieldset>
        );
      })}

      {cart.lines.length > 1 && (
        <label className={s.row} style={{ cursor: "pointer" }}>
          <input type="checkbox" checked={form.parallel} onChange={(e) => set({ parallel: e.target.checked, slot: null })} style={{ width: 20, height: 20 }} />
          <span className={s.rowMain}>
            <strong>Quiero que me atiendan al mismo tiempo</strong>
            <small>Por ejemplo, manicure con una especialista y pedicure con otra a la vez. Si no lo marcas, los servicios se hacen uno tras otro. Necesita especialistas libres a la misma hora.</small>
          </span>
        </label>
      )}
    </div>
  );
}
