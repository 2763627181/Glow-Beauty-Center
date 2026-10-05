import { CountUp } from "./CountUp";
import u from "./ui.module.css";

export function Kpi({ label, value, format = "money", hint }: { label: string; value: number; format?: "money" | "int" | "pct"; hint?: string }) {
  return (
    <div className={`${u.card} ${u.stat}`}>
      <span>{label}</span>
      <strong><CountUp value={value} format={format} /></strong>
      {hint && <small>{hint}</small>}
    </div>
  );
}
