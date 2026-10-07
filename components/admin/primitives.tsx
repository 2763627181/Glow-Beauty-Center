import type { ReactNode } from "react";
import { STATUS_META } from "@/lib/domain/status";
import type { AppointmentStatus } from "@/types/domain";
import s from "./ui.module.css";

export function StatusBadge({ status }: { status: AppointmentStatus }) {
  const m = STATUS_META[status];
  return <span className={`${s.badge} ${s[m.tone]}`}><span aria-hidden>{m.mark}</span>{m.label}</span>;
}

export function PayBadge({ status }: { status: string }) {
  const tone = { pagado: "green", parcial: "gold", pendiente: "pink", reembolsado: "gray" }[status] ?? "gray";
  return <span className={`${s.badge} ${s[tone]}`}>{status[0].toUpperCase() + status.slice(1)}</span>;
}

export function PageHead({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  return (
    <div className={s.pageHead}>
      <div><h1>{title}</h1>{sub && <p className={s.sub}>{sub}</p>}</div>
      {children && <div className={s.rowActions}>{children}</div>}
    </div>
  );
}

export function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <div className={`${s.card} ${s.stat}`}><span>{label}</span><strong>{value}</strong>{hint && <small>{hint}</small>}</div>;
}

export function EmptyState({ title, text, children }: { title: string; text?: string; children?: ReactNode }) {
  return <div className={s.empty}><strong>{title}</strong>{text && <p>{text}</p>}{children}</div>;
}

export function Skeleton({ h = 20, w = "100%" }: { h?: number; w?: number | string }) {
  return <div className={s.skeleton} style={{ height: h, width: w }} aria-hidden />;
}

export function Alert({ kind = "err", children }: { kind?: "err" | "ok" | "warn"; children: ReactNode }) {
  return <p role={kind === "err" ? "alert" : "status"} className={`${s.alert} ${kind === "err" ? s.alertErr : kind === "warn" ? s.alertWarn : s.alertOk}`}>{children}</p>;
}
