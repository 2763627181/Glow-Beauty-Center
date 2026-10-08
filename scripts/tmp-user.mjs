// Usuarios TEMPORALES para pruebas E2E (uno por rol). Siempre bórralos al terminar.
//   node --env-file=.env.local scripts/tmp-user.mjs create   |   delete
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const PASSWORD = "TmpE2E-pass-2026!";
const USERS = [
  { email: "tmp-admin@glow.test", name: "E2E Admin", role: "super_admin" },
  { email: "tmp-manager@glow.test", name: "E2E Gerente", role: "manager" },
  { email: "tmp-recep@glow.test", name: "E2E Recepción", role: "receptionist" },
  { email: "tmp-spec@glow.test", name: "E2E Especialista", role: "specialist", employee: "Especialista de prueba (tmp)" },
];

if (process.argv[2] === "create") {
  for (const u of USERS) {
    const { data, error } = await sb.auth.admin.createUser({ email: u.email, password: PASSWORD, email_confirm: true });
    if (error) { console.error("ERROR", u.email, error.message); process.exitCode = 1; continue; }
    let employee_id = null;
    if (u.employee) {
      // Ficha propia y oculta de la web: así las pruebas no dependen de que existan las especialistas demo
      const found = (await sb.from("employees").select("id").eq("full_name", u.employee).limit(1).maybeSingle()).data?.id;
      employee_id = found ?? (await sb.from("employees").insert({ full_name: u.employee, active: true, accepts_online_booking: false }).select("id").single()).data?.id ?? null;
    }
    await sb.from("profiles").upsert({ id: data.user.id, full_name: u.name, role: u.role, employee_id, active: true });
    console.log("creado", u.email, u.role);
  }
} else if (process.argv[2] === "delete") {
  const { data } = await sb.auth.admin.listUsers({ perPage: 200 });
  for (const u of data.users.filter((x) => x.email?.startsWith("tmp-") && x.email.endsWith("@glow.test"))) {
    await sb.from("profiles").delete().eq("id", u.id);
    const { error } = await sb.auth.admin.deleteUser(u.id);
    console.log(error ? `ERROR ${u.email}: ${error.message}` : `borrado ${u.email}`);
  }
  // La ficha de especialista de prueba se borra con sus citas (si las tuvo); no queda nada en la base
  const { data: tmpEmp } = await sb.from("employees").select("id").eq("full_name", "Especialista de prueba (tmp)");
  for (const e of tmpEmp ?? []) {
    const { data: lines } = await sb.from("appointment_services").select("appointment_id").eq("employee_id", e.id);
    const ids = [...new Set((lines ?? []).map((l) => l.appointment_id))];
    if (ids.length) await sb.from("appointments").delete().in("id", ids);
    await sb.from("employees").delete().eq("id", e.id);
  }
} else console.log("Uso: create | delete");
