"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import s from "./Reveal.module.css";

/** Aparición suave al hacer scroll (IntersectionObserver nativo + CSS). Respeta prefers-reduced-motion y funciona sin JavaScript. */
export function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setShown(true); io.disconnect(); }
    }, { rootMargin: "0px 0px -60px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`${s.reveal} ${shown ? s.in : ""} ${className ?? ""}`} style={delay ? { transitionDelay: `${delay}s` } : undefined}>
      {children}
    </div>
  );
}
