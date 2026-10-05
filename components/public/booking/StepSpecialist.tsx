"use client";

import { CheckIcon } from "@/components/ui/Icons";
import type { Employee } from "@/types/domain";
import { useCart } from "../cart/CartProvider";
import s from "./BookingFlow.module.css";
import type { StepProps } from "./state";

export function StepSpecialist({ form, set, employees, links }: StepProps & { employees: Employee[]; links: { employee_id: string; service_id: string }[] }) {
  const cart = useCart();
  const ids = cart.items.map((i) => i.serviceId);
  // Un especialista es elegible si, para cada servicio con especialistas asignados, está incluido.
  const eligible = employees.filter((e) =>
    ids.every((sid) => {
      const rows = links.filter((l) => l.service_id === sid);
      return rows.length === 0 || rows.some((l) => l.employee_id === e.id);
    }),
  );
  const options = [{ id: "any", full_name: "Cualquier especialista disponible", specialty: "Te asignamos quien tenga el horario libre" }, ...eligible];
  return (
    <div className={s.group} role="radiogroup" aria-label="Especialista">
      {eligible.length === 0 && cart.items.length > 1 && (
        <p className={s.muted}>Tus servicios los realizan distintas especialistas: asignaremos a cada servicio a quien esté disponible y los agendaremos uno tras otro.</p>
      )}
      {options.map((o) => {
        const on = form.employeeId === o.id;
        return (
          <button key={o.id} type="button" role="radio" aria-checked={on} className={`${s.row} ${on ? s.rowOn : ""}`}
            onClick={() => set({ employeeId: o.id, slot: null })}>
            <span className={s.check}>{on && <CheckIcon width={16} height={16} />}</span>
            <span className={s.rowMain}><strong>{o.full_name}</strong>{o.specialty && <small>{o.specialty}</small>}</span>
          </button>
        );
      })}
    </div>
  );
}
