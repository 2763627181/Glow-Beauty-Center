"use client";

import { useEffect, useRef, useState } from "react";
import { ButtonAnchor } from "@/components/ui/Button";
import { PinIcon } from "@/components/ui/Icons";
import s from "./LocationMap.module.css";

/**
 * Ubicación del negocio: dirección, “Cómo llegar” y mapa. El mapa de Google se carga cuando el bloque está a punto de verse
 * (no antes), así la página abre rápido aunque el mapa esté más abajo en el celular. Mientras llega se ve la dirección con los botones.
 */
export function LocationMap({ name, address, mapsUrl }: { name: string; address: string; mapsUrl: string }) {
  const [show, setShow] = useState(false);
  const box = useRef<HTMLElement>(null);
  const q = encodeURIComponent(address);

  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setShow(true); io.disconnect(); }
    }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <section ref={box} className={s.box} aria-labelledby="loc-title">
      <h2 id="loc-title" className="sr-only">Cómo llegar</h2>
      {show ? (
        <iframe className={s.map} title={`Mapa de ${name}`} src={`https://www.google.com/maps?q=${q}&z=16&output=embed`} referrerPolicy="no-referrer-when-downgrade" allowFullScreen />
      ) : (
        <div className={s.facade}>
          <span className={s.pin} aria-hidden><PinIcon width={30} height={30} /></span>
          <p className={s.title} aria-hidden>Cómo llegar</p>
          <p>{address}</p>
        </div>
      )}
      <div className={s.actions}>
        <ButtonAnchor href={`https://www.google.com/maps/dir/?api=1&destination=${q}`} target="_blank" rel="noopener" size="sm">Cómo llegar</ButtonAnchor>
        <ButtonAnchor href={mapsUrl || `https://www.google.com/maps/search/?api=1&query=${q}`} target="_blank" rel="noopener" size="sm" variant="secondary">Abrir en Google Maps</ButtonAnchor>
      </div>
    </section>
  );
}
