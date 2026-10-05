"use client";

import { useSyncExternalStore } from "react";

const subscribe = (cb: () => void) => {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => { window.removeEventListener("online", cb); window.removeEventListener("offline", cb); };
};

/** Aviso cuando se pierde la conexión (útil en el panel desde el teléfono y al reservar). */
export function OfflineBanner() {
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
  if (online) return null;
  return (
    <div role="alert" style={{ position: "fixed", insetInline: 0, top: 0, zIndex: 300, background: "#292524", color: "#fff", textAlign: "center", padding: "8px 12px", fontSize: "0.88rem" }}>
      Sin conexión a internet. Los cambios no se guardarán hasta que vuelva.
    </div>
  );
}
