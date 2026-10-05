"use client";

import { animate, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { money } from "@/lib/format";

/** Número que cuenta hacia su valor al aparecer. */
export function CountUp({ value, format = "money" }: { value: number; format?: "money" | "int" | "pct" }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const fmt = (n: number) => (format === "money" ? money(Math.round(n)) : format === "pct" ? `${Math.round(n * 100)}%` : String(Math.round(n)));
  const [text, setText] = useState(fmt(reduce ? value : 0));
  useEffect(() => {
    if (!inView) return;
    if (reduce) { setText(fmt(value)); return; } // eslint-disable-line react-hooks/set-state-in-effect
    const c = animate(0, value, { duration: 0.9, ease: "easeOut", onUpdate: (n) => setText(fmt(n)) });
    return () => c.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, value, reduce]);
  return <span ref={ref}>{text}</span>;
}
