import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

export const BASE = process.env.BASE ?? "http://localhost:3000";
export const PASSWORD = "TmpE2E-pass-2026!";
export const OUT = dirname(fileURLToPath(import.meta.url)) + "/shots";
mkdirSync(OUT, { recursive: true });

export async function launch({ mobile = false, locale = "es-DO" } = {}) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 850 },
    deviceScaleFactor: mobile ? 2 : 1, locale, isMobile: mobile, hasTouch: mobile,
  });
  const page = await ctx.newPage();
  // Después de cada navegación se espera a que la página termine de cargar e hidratarse: un `fill()` demasiado rápido
  // (antes de que React tome el control del campo) se perdería, y una persona real no escribe en 50 ms.
  const goto = page.goto.bind(page);
  page.goto = async (url, opts) => { const r = await goto(url, opts); await page.waitForLoadState("networkidle").catch(() => {}); return r; };
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 200)));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (/favicon|Failed to load resource.*(404|401)|net::ERR/i.test(t)) return;
    errors.push("console: " + t.slice(0, 220));
  });
  return { browser, ctx, page, errors };
}

export async function login(page, email, password = PASSWORD) {
  await page.goto(`${BASE}/admin/login`);
  await page.getByLabel("Correo").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 20000 });
}

const results = [];
let current = null;
/** Página por defecto para las capturas de pantalla de los pasos que fallan. */
export const setPage = (p) => { current = p; };
export async function step(name, fn, page = current) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  OK   ${name} (${Date.now() - t0} ms)`);
  } catch (e) {
    results.push({ name, ok: false, err: String(e.message ?? e).split("\n")[0].slice(0, 260) });
    console.log(`  FAIL ${name}\n       ${String(e.message ?? e).split("\n")[0].slice(0, 260)}`);
    if (page) await page.screenshot({ path: `${OUT}/FAIL-${name.replace(/[^a-z0-9]+/gi, "_").slice(0, 60)}.png` }).catch(() => {});
  }
}
export const section = (t) => console.log(`\n— ${t} —`);
export function summary(errors = []) {
  const fails = results.filter((r) => !r.ok);
  console.log(`\n${results.length - fails.length}/${results.length} pasos correctos`);
  if (errors.length) { console.log("Errores de consola/página:"); [...new Set(errors)].slice(0, 15).forEach((e) => console.log("  •", e)); }
  return fails.length + (errors.length ? 1 : 0);
}
export async function expectVisible(locator, msg, timeout = 8000) {
  await locator.first().waitFor({ state: "visible", timeout }).catch(() => { throw new Error(`No se ve: ${msg}`); });
}
export function assert(cond, msg) { if (!cond) throw new Error(msg); }
/** Espera (hasta `timeout` ms) a que `fn` devuelva un valor verdadero; útil para efectos asíncronos como guardados. */
export async function until(fn, msg, timeout = 8000) {
  const t0 = Date.now();
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { /* reintentar */ }
    if (Date.now() - t0 > timeout) throw new Error(`Nunca se cumplió: ${msg}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}
