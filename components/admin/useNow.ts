"use client";

import { useSyncExternalStore } from "react";

/*
 * Reloj compartido (se actualiza cada 30 s). En el servidor y en el primer pintado del navegador devuelve null,
 * así que el texto que depende de la hora ("en 2 h", la línea de "ahora" en la agenda) nunca difiere entre
 * servidor y cliente y no provoca errores de hidratación.
 */
let snapshot = 0;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function subscribe(cb: () => void) {
  listeners.add(cb);
  if (!timer) timer = setInterval(() => { snapshot = Date.now(); listeners.forEach((l) => l()); }, 30_000);
  return () => {
    listeners.delete(cb);
    if (!listeners.size && timer) { clearInterval(timer); timer = undefined; }
  };
}

export function useNow(): number | null {
  return useSyncExternalStore(subscribe, () => (snapshot ||= Date.now()), () => null);
}
