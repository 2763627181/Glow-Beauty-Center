"use client";

import { useRef, useState, type InputHTMLAttributes } from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "inputMode"> & {
  value: number | null;
  /** Recibe el número escrito, o `emptyValue` (por defecto null) mientras el campo está vacío. */
  onValue: (v: number | null) => void;
  emptyValue?: number | null;
  integer?: boolean;
};

const show = (v: number | null) => (v === null || Number.isNaN(v) ? "" : String(v));
const parse = (t: string) => {
  const s = t.trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/**
 * Campo numérico que no pelea con quien escribe: se puede borrar todo, escribir decimales a medias ("12.") y no antepone
 * ceros ("01800"). El padre guarda un número; el texto que se ve es el que la persona escribió hasta que sale del campo.
 */
export function NumInput({ value, onValue, emptyValue = null, integer, onBlur, onFocus, onMouseUp, step, ...rest }: Props) {
  const [text, setText] = useState(show(value));
  const [seen, setSeen] = useState(value);
  const justFocused = useRef(false);
  // Si el valor cambia desde afuera (se eligió otro servicio, “restablecer”, el padre lo ajustó a un mínimo…), el texto se actualiza.
  if (value !== seen) {
    setSeen(value);
    if ((parse(text) ?? emptyValue) !== value) setText(show(value));
  }
  return (
    <input
      {...rest}
      type="number"
      // sin `step` fijo el navegador no rechaza precios como 1,275 ni 199.99
      step={step ?? (integer ? 1 : "any")}
      inputMode={integer ? "numeric" : "decimal"}
      value={text}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        const v = parse(t) ?? emptyValue;
        setSeen(v);
        onValue(v);
      }}
      // Al entrar al campo se selecciona todo: lo que se escriba reemplaza el valor (no queda «0349.75»)
      onFocus={(e) => {
        const el = e.currentTarget;
        el.select();
        justFocused.current = true;
        setTimeout(() => { justFocused.current = false; }, 300);
        onFocus?.(e);
      }}
      onMouseUp={(e) => { if (justFocused.current) { e.preventDefault(); justFocused.current = false; } onMouseUp?.(e); }}
      onBlur={(e) => { setText(show(value)); onBlur?.(e); }}
    />
  );
}
