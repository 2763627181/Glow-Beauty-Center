import Image from "next/image";
import s from "./Brand.module.css";

/** Marca del negocio: logo si existe; si no, el nombre con la primera palabra destacada. */
export function Brand({ name, logoUrl, light }: { name: string; logoUrl?: string; light?: boolean }) {
  if (logoUrl) return <Image src={logoUrl} alt={name} width={160} height={48} className={s.logo} loading="eager" />;
  const [first, ...rest] = name.trim().split(/\s+/);
  return <span className={`${s.text} ${light ? s.light : ""}`}>{first}{rest.length > 0 && <>{" "}<small>{rest.join(" ")}</small></>}</span>;
}
