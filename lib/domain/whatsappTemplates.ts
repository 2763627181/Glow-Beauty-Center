/** Plantillas de mensajes de WhatsApp editables por el administrador. Variables: {nombre} {servicios} {fecha} {hora} {total} {negocio} */

export type WaTemplates = { confirm: string; reminder: string; generic: string };

export const DEFAULT_WA_TEMPLATES: WaTemplates = {
  confirm: "Hola {nombre} ✨ Te escribimos de {negocio}. Tu cita de {servicios} quedó confirmada para el {fecha} a las {hora}. ¡Te esperamos!",
  reminder: "Hola {nombre} ✨ Te recordamos tu cita en {negocio}: {servicios}, {fecha} a las {hora}. ¿Nos confirmas tu asistencia?",
  generic: "Hola {nombre} ✨ Te escribimos de {negocio}.",
};

export const WA_VARIABLES = ["{nombre}", "{servicios}", "{fecha}", "{hora}", "{total}", "{negocio}"] as const;

export function renderTemplate(template: string, vars: Record<string, string>) {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k] : m));
}

export function mergeTemplates(raw: unknown): WaTemplates {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pick = (k: keyof WaTemplates) => (typeof r[k] === "string" && (r[k] as string).trim() ? (r[k] as string) : DEFAULT_WA_TEMPLATES[k]);
  return { confirm: pick("confirm"), reminder: pick("reminder"), generic: pick("generic") };
}
