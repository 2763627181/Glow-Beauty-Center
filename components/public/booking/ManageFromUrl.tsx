"use client";

import { useSearchParams } from "next/navigation";
import { ManageBooking } from "./ManageBooking";

/** Lee ?number= de la URL (en el cliente, para que la página siga siendo estática). */
export function ManageFromUrl({ whatsapp, business }: { whatsapp: string; business: string }) {
  const number = useSearchParams().get("number") ?? "";
  return <ManageBooking initialNumber={number} whatsapp={whatsapp} business={business} />;
}
