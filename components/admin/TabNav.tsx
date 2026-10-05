import Link from "next/link";
import u from "./ui.module.css";

/** Pestañas por enlace (?tab=): funcionan sin JavaScript y se pueden compartir. */
export function TabNav({ tabs, current, base }: { tabs: { key: string; label: string }[]; current: string; base: string }) {
  return (
    <nav className={u.tabs} aria-label="Secciones">
      {tabs.map((t) => (
        <Link key={t.key} href={`${base}?tab=${t.key}`} className={`${u.tab} ${current === t.key ? u.tabOn : ""}`} aria-current={current === t.key ? "page" : undefined}>{t.label}</Link>
      ))}
    </nav>
  );
}
