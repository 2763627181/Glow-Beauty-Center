import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import s from "./Button.module.css";

type Variant = "primary" | "secondary" | "soft" | "whatsapp" | "danger";
type Common = { variant?: Variant; size?: "md" | "sm"; block?: boolean; children: ReactNode; className?: string };

const cls = (v: Variant, size: string, block?: boolean, extra?: string) =>
  [s.btn, s[v], size === "sm" && s.sm, block && s.block, extra].filter(Boolean).join(" ");

export function Button({ variant = "primary", size = "md", block, className, children, ...rest }: Common & ComponentProps<"button">) {
  return (
    <button className={cls(variant, size, block, className)} {...rest}>
      {children}
    </button>
  );
}

export function ButtonLink({ variant = "primary", size = "md", block, className, children, ...rest }: Common & ComponentProps<typeof Link>) {
  return (
    <Link className={cls(variant, size, block, className)} {...rest}>
      {children}
    </Link>
  );
}

/** <a> externo (WhatsApp, tel:, etc.). */
export function ButtonAnchor({ variant = "primary", size = "md", block, className, children, ...rest }: Common & ComponentProps<"a">) {
  return (
    <a className={cls(variant, size, block, className)} {...rest}>
      {children}
    </a>
  );
}
