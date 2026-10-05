/** Serializa JSON-LD sin permitir que un texto editable rompa la etiqueta <script> (reemplaza "<" por su escape Unicode). */
export const jsonLd = (data: unknown) => JSON.stringify(data).replace(/</g, "\u003c");
