import type { Metadata } from "next";
import { BookingFlow } from "@/components/public/booking/BookingFlow";
import { getEmployeeServiceLinks, getPublicEmployees, getSettings } from "@/lib/data/catalog";
import s from "../page.module.css";

export const metadata: Metadata = {
  title: "Reservar cita",
  description: "Reserva tu cita en línea: elige servicios, especialista, fecha y hora.",
  alternates: { canonical: "/booking" },
};

export default async function BookingPage() {
  const [employees, links, settings] = await Promise.all([getPublicEmployees(), getEmployeeServiceLinks(), getSettings()]);
  return (
    <div className={`container ${s.page}`}>
      <div className={s.head}>
        <span className="eyebrow">Reservas</span>
        <h1 style={{ fontSize: "clamp(2.4rem,6vw,3.8rem)" }}>{settings.content.booking_title}</h1>
        {settings.content.booking_text && <p>{settings.content.booking_text}</p>}
      </div>
      <BookingFlow employees={employees} links={links} maxDays={settings.booking.max_advance_days} policy={settings.booking.cancellation_policy} businessName={settings.business.name} />
    </div>
  );
}
