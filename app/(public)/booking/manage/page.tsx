import type { Metadata } from "next";
import { Suspense } from "react";
import { ManageFromUrl } from "@/components/public/booking/ManageFromUrl";
import { getSettings } from "@/lib/data/catalog";
import s from "../../page.module.css";

export const metadata: Metadata = { title: "Consultar o cancelar mi cita", robots: { index: false } };

export default async function ManagePage() {
  const st = await getSettings();
  return (
    <div className={`container ${s.page}`}>
      <div className={s.head}>
        <span className="eyebrow">Mi cita</span>
        <h1 style={{ fontSize: "clamp(2.2rem,6vw,3.4rem)" }}>Consultar o cancelar</h1>
        <p>Escribe el número de solicitud que recibiste al reservar y tu WhatsApp.</p>
      </div>
      <Suspense><ManageFromUrl whatsapp={st.business.whatsapp || process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || ""} business={st.business.name} /></Suspense>
    </div>
  );
}
