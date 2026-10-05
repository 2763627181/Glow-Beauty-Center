"use client";

import type { Service } from "@/types/domain";
import { ServiceCard } from "./ServiceCard";

/** Reutiliza la tarjeta (variantes, complementos, WhatsApp) en la página de detalle. */
export function ServiceDetailActions({ service }: { service: Service }) {
  return <div style={{ maxWidth: 420 }}><ServiceCard service={service} level="none" /></div>;
}
