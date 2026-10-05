import { PageHead } from "@/components/admin/primitives";
import { AccountForms } from "@/components/admin/users/AccountForms";
import { getSession } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/permissions";
import { redirect } from "next/navigation";

export const metadata = { title: "Mi cuenta" };

export default async function AccountPage() {
  const s = await getSession();
  if (!s) redirect("/admin/login");
  return (
    <>
      <PageHead title="Mi cuenta" sub={`${s.email} · ${ROLE_LABEL[s.role]}`} />
      <AccountForms name={s.fullName} />
    </>
  );
}
