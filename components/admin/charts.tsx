import { money } from "@/lib/format";
import type { Row } from "@/lib/domain/reports";
import u from "./ui.module.css";

/** Barras verticales accesibles (SVG) para series temporales. */
export function BarChart({ data, label, fmtLabel = (l: string) => l.slice(5), money: isMoney = true }: { data: Row[]; label: string; fmtLabel?: (l: string) => string; money?: boolean }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const W = 100 / data.length;
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox="0 0 100 52" role="img" aria-label={`${label}: ${data.map((d) => `${d.label} ${isMoney ? money(d.value) : d.value}`).join(", ")}`} style={{ width: "100%", height: "auto", overflow: "visible" }}>
        {data.map((d, i) => {
          const h = (d.value / max) * 38;
          return (
            <g key={d.label}>
              <rect x={i * W + W * 0.18} y={42 - h} width={W * 0.64} height={Math.max(h, 0.4)} rx={1.2} fill="var(--color-primary)" opacity={d.value ? 0.9 : 0.25}>
                <title>{`${d.label}: ${isMoney ? money(d.value) : d.value}`}</title>
              </rect>
              <text x={i * W + W / 2} y={49} textAnchor="middle" fontSize="3" fill="var(--color-text-secondary)">{fmtLabel(d.label)}</text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

/** Lista con barra horizontal para rankings. */
export function RankList({ rows, money: isMoney = true, empty = "Sin datos en este período" }: { rows: Row[]; money?: boolean; empty?: string }) {
  if (!rows.length) return <p className={u.sub}>{empty}</p>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
      {rows.map((r) => (
        <li key={r.label} style={{ display: "grid", gap: 4 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: "0.9rem" }}>
            <span>{r.label}</span><strong>{isMoney ? money(r.value) : r.value}</strong>
          </div>
          <div style={{ height: 6, borderRadius: 6, background: "var(--color-marble)" }} aria-hidden>
            <div style={{ height: "100%", width: `${(r.value / max) * 100}%`, borderRadius: 6, background: "var(--color-champagne)" }} />
          </div>
        </li>
      ))}
    </ol>
  );
}
