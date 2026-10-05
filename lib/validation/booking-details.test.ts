import assert from "node:assert/strict";
import { test } from "node:test";
import { validateBookingDetails } from "./booking-details.ts";

const ok = { firstName: "María", lastName: "Pérez", phone: "829-555-0101", email: "" };

test("datos válidos no producen errores (el correo es opcional)", () => {
  assert.deepEqual(validateBookingDetails(ok), {});
  assert.deepEqual(validateBookingDetails({ ...ok, email: "maria@ejemplo.com" }), {});
  assert.deepEqual(validateBookingDetails({ ...ok, phone: "+1 (809) 555-0101" }), {});
});

test("nombre, apellido y teléfono son obligatorios, con los mismos mensajes del servidor", () => {
  assert.deepEqual(validateBookingDetails({ firstName: " a ", lastName: "", phone: "123", email: "" }), {
    firstName: "Escribe tu nombre", lastName: "Escribe tu apellido", phone: "Escribe un WhatsApp válido (ej. 809-555-5555)",
  });
});

test("rechaza teléfonos que no son dominicanos y correos mal escritos", () => {
  assert.equal(validateBookingDetails({ ...ok, phone: "787-555-0101" }).phone, "Escribe un WhatsApp válido (ej. 809-555-5555)");
  for (const email of ["maria", "maria@", "@x.com", "maria@x", "ma ria@x.com"]) assert.equal(validateBookingDetails({ ...ok, email }).email, "Correo no válido", email);
});
