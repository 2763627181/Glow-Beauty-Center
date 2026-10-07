"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Button, ButtonAnchor } from "@/components/ui/Button";
import { WhatsAppIcon } from "@/components/ui/Icons";
import { createPublicBooking } from "@/lib/actions/booking";
import { money } from "@/lib/format";
import { validateBookingDetails } from "@/lib/validation/booking-details";
import { waLink } from "@/lib/whatsapp";
import type { Employee } from "@/types/domain";
import { useCart } from "../cart/CartProvider";
import s from "./BookingFlow.module.css";
import { BookingSummary } from "./BookingSummary";
import { BookingSuccess, type Confirmed } from "./BookingSuccess";
import { StepDateTime } from "./StepDateTime";
import { StepDetails } from "./StepDetails";
import { StepServices } from "./StepServices";
import { StepSpecialist } from "./StepSpecialist";
import { effectiveMinutes, emptyForm, STEPS, type BookingForm } from "./state";

type Props = { employees: Employee[]; links: { employee_id: string; service_id: string }[]; maxDays: number; policy: string; businessName: string };
const CUSTOMER_KEY = "glow-customer-v1";

export function BookingFlow({ employees, links, maxDays, policy, businessName }: Props) {
  const cart = useCart();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<BookingForm>(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [done, setDone] = useState<Confirmed | null>(null);
  const [sheet, setSheet] = useState(false);
  const [pending, start] = useTransition();
  const heading = useRef<HTMLHeadingElement>(null);

  // Recordar los datos de la clienta en este dispositivo (solo si ella lo permite)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CUSTOMER_KEY);
      if (!raw) return;
      const c = JSON.parse(raw) as Partial<BookingForm>;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hidratación desde localStorage (solo existe en el cliente)
      setForm((f) => ({ ...f, firstName: c.firstName ?? "", lastName: c.lastName ?? "", phone: c.phone ?? "", email: c.email ?? "" }));
    } catch {}
  }, []);

  // Si cambian los servicios, el horario elegido deja de ser válido
  const itemsKey = JSON.stringify([cart.items.map((i) => [i.serviceId, i.variantId, i.addonIds, form.staff[i.serviceId] ?? []]), form.parallel]);
  /** Servicios con la(s) especialista(s) que eligió la clienta para cada uno. */
  const selection = cart.items.map((i) => ({ ...i, employeeIds: form.staff[i.serviceId] ?? [] }));
  const minutes = effectiveMinutes(cart.minutes, cart.lines.map((l) => l.duration), form.parallel);
  const slot = form.slot && form.slotKey === itemsKey ? form.slot : null;
  const view: BookingForm = { ...form, slot };
  const set = (patch: Partial<BookingForm>) => setForm((f) => ({ ...f, ...patch, ...(patch.slot ? { slotKey: itemsKey } : {}) }));

  function validateDetails() {
    const errs = validateBookingDetails({ firstName: form.firstName, lastName: form.lastName, phone: form.phone, email: form.email });
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  const canNext = [cart.items.length > 0, true, !!slot, true, true][step];
  const goTo = (n: number) => {
    setStep(n);
    window.scrollTo({ top: 0, behavior: "smooth" });
    setTimeout(() => heading.current?.focus(), 50);
  };

  function next() {
    setServerError(null);
    if (step === 3 && !validateDetails()) return;
    goTo(Math.min(step + 1, STEPS.length - 1));
  }

  function submit() {
    setServerError(null);
    if (!slot) return goTo(2);
    start(async () => {
      const res = await createPublicBooking({
        items: selection, employeeId: "any", parallel: form.parallel, start: slot.start, date: form.date, promotionId: cart.promo?.id ?? null,
        firstName: form.firstName, lastName: form.lastName, phone: form.phone, email: form.email, notes: form.notes, website: form.website,
      });
      if (!res.ok) {
        setServerError(res.error);
        if (res.field === "start") { set({ slot: null }); goTo(2); }
        return;
      }
      try {
        if (form.remember) localStorage.setItem(CUSTOMER_KEY, JSON.stringify({ firstName: form.firstName, lastName: form.lastName, phone: form.phone, email: form.email }));
        else localStorage.removeItem(CUSTOMER_KEY);
      } catch {}
      setDone({
        requestNumber: res.requestNumber, name: `${form.firstName} ${form.lastName}`.trim(), date: form.date,
        time: slot.time, start: slot.start, durationMin: minutes, phone: form.phone,
        lines: cart.lines.map((l) => ({ name: l.name, price: l.price })), total: res.total, whatsappNumber: cart.whatsappNumber,
      });
      cart.clear();
    });
  }

  if (done) return <div className={s.panel}><BookingSuccess c={done} businessName={businessName} /></div>;

  const titles = ["Elige tus servicios", "¿Con quién prefieres?", "Escoge fecha y hora", "Tus datos", "Revisa y confirma"];
  const needsConsult = cart.lines.some((l) => l.requiresConsultation);
  return (
    <div className={s.wrap}>
      <ol className={s.steps} aria-label="Progreso de la reserva">
        {STEPS.map((t, i) => (
          <li key={t} className={`${s.step} ${i <= step ? s.stepOn : ""}`} aria-current={i === step ? "step" : undefined}><i />{i + 1} {t}</li>
        ))}
      </ol>
      <div className={s.layout}>
        <div className={s.panel}>
          <h2 ref={heading} tabIndex={-1} style={{ outline: "none" }}>{titles[step]}</h2>
          {needsConsult && step >= 2 && (
            <p className={s.notice} role="note">
              Alguno de tus servicios requiere una <strong>consulta previa</strong>. Puedes reservar igual; te escribiremos para confirmar los detalles.{" "}
              <a href={waLink(cart.whatsappNumber, `Hola ${businessName} ✨ Quisiera la consulta previa para: ${cart.lines.map((l) => l.name).join(", ")}`)} target="_blank" rel="noopener">Consultar por WhatsApp</a>
            </p>
          )}
          <AnimatePresence mode="wait">
            <motion.div key={step} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
              {step === 0 && <StepServices />}
              {step === 1 && <StepSpecialist form={view} set={set} errors={errors} employees={employees} links={links} />}
              {step === 2 && <StepDateTime form={view} set={set} errors={errors} maxDays={maxDays} />}
              {step === 3 && <StepDetails form={view} set={set} errors={errors} />}
              {step === 4 && <BookingSummary form={view} employees={employees} showClient />}
            </motion.div>
          </AnimatePresence>
          {step === 4 && policy && <p className={s.muted}>Política de cancelación: {policy}</p>}
          {serverError && <p className={s.err} role="alert">{serverError}</p>}
          <div className={s.nav}>
            <Button variant="secondary" onClick={() => goTo(Math.max(0, step - 1))} disabled={step === 0 || pending}>Atrás</Button>
            {step < 4
              ? <Button onClick={next} disabled={!canNext}>Continuar</Button>
              : <Button onClick={submit} disabled={pending}>{pending ? "Enviando…" : "Confirmar solicitud"}</Button>}
          </div>
          {step === 0 && cart.items.length === 0 && (
            <ButtonAnchor variant="whatsapp" size="sm" href={waLink(cart.whatsappNumber, `Hola ${businessName} ✨ Quisiera reservar una cita.`)} target="_blank" rel="noopener"><WhatsAppIcon width={18} height={18} /> ¿Prefieres escribirnos?</ButtonAnchor>
          )}
        </div>
        <aside className={s.summary} aria-label="Resumen de tu reserva">
          <h3>Tu reserva</h3>
          <BookingSummary form={view} employees={employees} />
        </aside>
      </div>

      {cart.lines.length > 0 && (
        <div className={s.sheetBar}>
          <div><strong>{money(cart.total)}</strong><span className={s.muted}>{cart.lines.length} servicio(s)</span></div>
          <Button size="sm" variant="soft" onClick={() => setSheet(true)}>Ver resumen</Button>
        </div>
      )}
      <AnimatePresence>
        {sheet && (
          <>
            <motion.div className={s.backdrop} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSheet(false)} />
            <motion.div className={s.sheet} role="dialog" aria-label="Resumen" initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", stiffness: 320, damping: 34 }}>
              <h3 style={{ marginBottom: 12 }}>Tu reserva</h3>
              <BookingSummary form={view} employees={employees} />
              <div style={{ marginTop: 16 }}><Button block variant="secondary" onClick={() => setSheet(false)}>Cerrar</Button></div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
