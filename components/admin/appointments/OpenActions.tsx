"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import type { ApptRow } from "@/lib/data/appointments";
import { AppointmentModal } from "./AppointmentModal";

export function OpenActions({ appt }: { appt: ApptRow }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Acciones</Button>
      <AppointmentModal appt={open ? appt : null} onClose={() => setOpen(false)} />
    </>
  );
}
