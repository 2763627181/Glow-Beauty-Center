import { staffChoices } from "./lines";

type Staff = { id: string; full_name: string; active: boolean };
type Link = { employee_id: string; service_id: string };

/**
 * Opciones del selector de especialista de un servicio. Recepción y gerencia pueden asignar a CUALQUIER especialista activa:
 * primero aparecen las que tienen el servicio marcado y, aparte, el resto del equipo.
 */
export function StaffOptions({ serviceId, staff, links }: { serviceId: string | null | undefined; staff: Staff[]; links: Link[] }) {
  const { usual, others } = staffChoices(serviceId, staff, links);
  const opt = (s: Staff) => <option key={s.id} value={s.id}>{s.full_name}</option>;
  if (!others.length) return <>{usual.map(opt)}</>;
  if (!usual.length) return <>{others.map(opt)}</>;
  return (
    <>
      <optgroup label="Hacen este servicio">{usual.map(opt)}</optgroup>
      <optgroup label="Otras especialistas">{others.map(opt)}</optgroup>
    </>
  );
}
