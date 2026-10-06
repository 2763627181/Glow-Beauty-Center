/** Tipo y tamaño de un PNG o JPEG leyendo solo su encabezado (el logo del negocio va a los PDF y Excel). */
export function imageSize(b: Uint8Array): { mime: "image/png" | "image/jpeg"; width: number; height: number } | null {
  // PNG: firma de 8 bytes y, luego, el bloque IHDR con ancho y alto
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const width = dv.getUint32(16), height = dv.getUint32(20);
    return width > 0 && height > 0 ? { mime: "image/png", width, height } : null;
  }
  // JPEG: se recorren los marcadores hasta el SOF (Start Of Frame)
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = (b[i + 2] << 8) | b[i + 3];
      if ((marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const height = (b[i + 5] << 8) | b[i + 6], width = (b[i + 7] << 8) | b[i + 8];
        return width > 0 && height > 0 ? { mime: "image/jpeg", width, height } : null;
      }
      i += 2 + len;
    }
  }
  return null;
}
