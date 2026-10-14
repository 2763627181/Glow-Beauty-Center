import assert from "node:assert/strict";
import { test } from "node:test";
import { addDays, analyzeSupply, daysBetween, isValidDay, judge, lotWindows, narrate, plural, progressLines, summarizeSupply, type Lot, type Supply, type Usage } from "./inventory.ts";

const supply = (o: Partial<Supply> = {}): Supply => ({ name: "Pintura de gel", unit: "pote", expected: null, ...o });
const lot = (id: string, received_on: string, quantity: number, depleted_on: string | null = null): Lot => ({ id, received_on, quantity, depleted_on });
/** `n` servicios, uno por cliente distinto, repartidos desde `from` de dos en dos días. */
const services = (n: number, from: string, step = 2): Usage[] => Array.from({ length: n }, (_, i) => ({ date: addDays(from, i * step), clientKey: `c${i}`, qty: 1 }));

test("fechas: días entre dos fechas, sumar días y validar", () => {
  assert.equal(daysBetween("2026-10-01", "2026-10-21"), 20);
  assert.equal(daysBetween("2026-12-25", "2027-01-05"), 11);
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.ok(isValidDay("2026-02-28") && !isValidDay("2026-02-30") && !isValidDay("2026-2-3") && !isValidDay(null));
});

test("plural de la unidad", () => {
  assert.equal(plural("pote", 1), "pote");
  assert.equal(plural("pote", 10), "potes");
  assert.equal(plural("unidad", 2), "unidades");
  assert.equal(plural("lápiz", 3), "lápices");
  assert.equal(plural("litro", 0.5), "litros");
});

test("el ejemplo del dueño: 10 clientes, 10 potes y 20 días → 1 pote por cliente, 1 pote cada 2 días, consumo elevado", () => {
  const [a] = analyzeSupply(supply(), [lot("l1", "2026-10-01", 10, "2026-10-21")], services(10, "2026-10-01"), "2026-10-30");
  assert.equal(a.services, 10);
  assert.equal(a.clients, 10);
  assert.equal(a.days, 20);
  assert.equal(a.units, 10);
  assert.equal(a.unitsPerService, 1);
  assert.equal(a.daysPerUnit, 2);
  assert.equal(a.verdict, "alto");
  const n = narrate(a, supply(), ["Manicure"])!;
  assert.equal(n.intro, "Si 10 clientes utilizaron Manicure y se agotaron 10 potes de Pintura de gel en 20 días, podemos deducir lo siguiente:");
  assert.deepEqual(n.points, ["Consumo promedio: 1 pote por cliente.", "Duración promedio: 1 pote cada 2 días."]);
  assert.equal(n.problem, "Posible problema: existe un consumo excesivo de producto, desperdicio, uso no registrado o un control deficiente del inventario.");
  assert.equal(n.conclusion, "Si solamente se atendieron 10 clientes en esos 20 días, el consumo de 10 potes parece elevado y sería necesario investigar cómo se está utilizando el producto.");
});

test("un servicio por pote o más sin referencia es sospechoso; con mejor rendimiento no hay referencia para juzgar", () => {
  assert.equal(judge(10, 1, null), "alto");
  assert.equal(judge(10, 0.5, null), "alto");
  assert.equal(judge(20, 2, null), "sin_referencia");
  assert.equal(judge(0, null, 8), "sin_servicios");
});

test("con lo esperado configurado: ratio < 0.5 muy alto, < 0.8 alto, entre 0.8 y 1.3 normal, > 1.3 rinde más", () => {
  assert.equal(judge(10, 3, 8), "muy_alto");
  assert.equal(judge(10, 5, 8), "alto");
  assert.equal(judge(10, 8, 8), "normal");
  assert.equal(judge(10, 10, 8), "normal");
  assert.equal(judge(10, 12, 8), "bajo");
});

test("una entrada que rinde lo esperado sale normal y sin «posible problema»", () => {
  const s = supply({ expected: 8 });
  const [a] = analyzeSupply(s, [lot("l1", "2026-10-01", 5, "2026-10-21")], services(40, "2026-10-01", 0), "2026-10-30");
  assert.equal(a.servicesPerUnit, 8);
  assert.equal(a.verdict, "normal");
  const n = narrate(a, s, ["Manicure"])!;
  assert.equal(n.problem, null);
  assert.match(n.conclusion, /dentro de lo normal/);
  assert.match(n.points.join(" "), /lo esperado es 8/);
});

test("se agotó sin ningún servicio registrado: se pide investigar el uso no registrado", () => {
  const [a] = analyzeSupply(supply(), [lot("l1", "2026-10-01", 3, "2026-10-11")], [], "2026-10-30");
  assert.equal(a.verdict, "sin_servicios");
  const n = narrate(a, supply(), ["Manicure"])!;
  assert.match(n.problem ?? "", /Posible problema/);
  assert.match(n.conclusion, /sin que se registrara ningún servicio/);
  assert.match(n.points[0], /no se registró ningún servicio/);
});

test("el día en que se agota cuenta para esa entrada y los servicios fuera de fechas no cuentan", () => {
  const u: Usage[] = [
    { date: "2026-09-30", clientKey: "a", qty: 1 }, // antes de la entrada
    { date: "2026-10-01", clientKey: "b", qty: 1 }, { date: "2026-10-21", clientKey: "c", qty: 1 }, // el primer día y el de agotado cuentan
    { date: "2026-10-22", clientKey: "d", qty: 1 }, // después
  ];
  const [a] = analyzeSupply(supply(), [lot("l1", "2026-10-01", 2, "2026-10-21")], u, "2026-10-30");
  assert.equal(a.services, 2);
});

test("clientes distintos y servicios: dos servicios al mismo cliente cuentan como 2 servicios y 1 cliente", () => {
  const u: Usage[] = [{ date: "2026-10-02", clientKey: "x", qty: 1 }, { date: "2026-10-03", clientKey: "x", qty: 1 }, { date: "2026-10-04", clientKey: "y", qty: 2 }];
  const [a] = analyzeSupply(supply(), [lot("l1", "2026-10-01", 2, "2026-10-10")], u, "2026-10-30");
  assert.equal(a.services, 4);
  assert.equal(a.clients, 2);
  const n = narrate(a, supply(), ["Manicure"])!;
  assert.match(n.intro, /^Si se realizaron 4 servicios de Manicure \(a 2 clientes\) y se agotaron 2 potes/);
  assert.match(n.points[0], /por servicio \(1 pote por cliente\)/);
});

test("entradas en orden de llegada: la nueva empieza cuando se agota la anterior, sin contar dos veces los mismos servicios", () => {
  const lots = [lot("a", "2026-10-01", 5, "2026-10-21"), lot("b", "2026-10-10", 5, "2026-11-10")];
  const w = lotWindows(lots, "2026-11-15");
  assert.equal(w[0].usageFrom, "2026-10-01");
  assert.equal(w[1].startDate, "2026-10-21"); // aunque llegó el 10, se usó desde que se acabó la anterior
  assert.equal(w[1].usageFrom, "2026-10-22");
  const u = [...services(10, "2026-10-01", 1), ...services(6, "2026-10-22", 1)].map((x, i) => ({ ...x, clientKey: `k${i}` }));
  const [a, b] = analyzeSupply(supply(), lots, u, "2026-11-15");
  assert.equal(a.services + b.services, 16);
  assert.equal(b.days, 20);
  assert.equal(b.services, 6);
});

test("un hueco entre entradas no se cuenta: la nueva empieza el día que llega", () => {
  const w = lotWindows([lot("a", "2026-10-01", 5, "2026-10-05"), lot("b", "2026-10-20", 5)], "2026-10-25");
  assert.equal(w[1].startDate, "2026-10-20");
  assert.equal(w[1].usageFrom, "2026-10-20");
  assert.equal(w[1].waiting, false);
});

test("si llega una entrada y la anterior sigue en uso, la nueva espera su turno y no se analiza", () => {
  const lots = [lot("a", "2026-10-01", 5), lot("b", "2026-10-10", 5)];
  const [a, b] = analyzeSupply(supply(), lots, services(5, "2026-10-01"), "2026-10-20");
  assert.equal(a.window.waiting, false);
  assert.equal(b.window.waiting, true);
  assert.equal(b.services, 0);
  assert.equal(narrate(b, supply(), []), null);
  assert.match(progressLines(b, supply())[0], /En espera/);
});

test("entrada en uso: lleva N días y N servicios, y con rendimiento esperado estima lo que queda", () => {
  const s = supply({ expected: 5 });
  const [a] = analyzeSupply(s, [lot("a", "2026-10-01", 10)], services(10, "2026-10-01", 1), "2026-10-11");
  assert.equal(a.units, null);
  assert.equal(a.verdict, null);
  assert.equal(a.days, 10);
  assert.equal(a.services, 10);
  assert.deepEqual(a.estimate, { used: 2, remaining: 8, daysLeft: 40 });
  const p = progressLines(a, s);
  assert.match(p[0], /Lleva 10 días en uso y se han hecho 10 servicios/);
  assert.match(p[1], /se estima que se han usado 2 de 10 potes y quedan unos 8, para unos 40 días/);
  assert.equal(narrate(a, s, []), null);
});

test("entrada en uso sin referencia: pide marcar cuándo se agota", () => {
  const [a] = analyzeSupply(supply(), [lot("a", "2026-10-01", 10)], services(3, "2026-10-01", 1), "2026-10-05");
  assert.equal(a.estimate, null);
  assert.match(progressLines(a, supply())[1], /márcala como agotada/);
});

test("sin esperado, la segunda entrada se compara con el promedio de las otras ya agotadas", () => {
  const lots = [lot("a", "2026-01-01", 10, "2026-01-31"), lot("b", "2026-02-01", 10, "2026-03-03")];
  const u = [...services(80, "2026-01-01", 0), ...services(30, "2026-02-02", 0)].map((x, i) => ({ ...x, clientKey: `k${i}` }));
  const [a, b] = analyzeSupply(supply(), lots, u, "2026-03-10");
  assert.equal(a.servicesPerUnit, 8);
  assert.equal(b.servicesPerUnit, 3);
  assert.equal(b.referenceSource, "historial");
  assert.equal(b.reference, 8);
  assert.equal(b.verdict, "muy_alto"); // 3 / 8 < 0.5
  assert.equal(a.verdict, "bajo");
});

test("resumen del producto: totales, promedios y la entrada en uso", () => {
  const lots = [lot("a", "2026-10-01", 10, "2026-10-21"), lot("b", "2026-10-21", 6)];
  const an = analyzeSupply(supply(), lots, services(10, "2026-10-01"), "2026-10-30");
  const s = summarizeSupply(an);
  assert.equal(s.lots, 2);
  assert.equal(s.depleted, 1);
  assert.equal(s.units, 10);
  assert.equal(s.services, 10);
  assert.equal(s.servicesPerUnit, 1);
  assert.equal(s.daysPerUnit, 2);
  assert.equal(s.lastVerdict, "alto");
  assert.equal(s.inUse?.window.lot.id, "b");
});

test("agotada el mismo día que llegó: cuenta como 1 día (sin dividir entre cero)", () => {
  const [a] = analyzeSupply(supply(), [lot("a", "2026-10-01", 2, "2026-10-01")], [{ date: "2026-10-01", clientKey: "x", qty: 1 }], "2026-10-05");
  assert.equal(a.days, 1);
  assert.equal(a.daysPerUnit, 0.5);
  assert.match(narrate(a, supply(), ["Manicure"])!.points[1], /2 potes por día/);
});

test("una sola unidad usa el singular", () => {
  const [a] = analyzeSupply(supply(), [lot("a", "2026-10-01", 1, "2026-10-04")], [{ date: "2026-10-02", clientKey: "x", qty: 1 }], "2026-10-05");
  const n = narrate(a, supply(), ["Manicure"])!;
  assert.match(n.intro, /^Si 1 cliente utilizó Manicure y se agotó 1 pote de Pintura de gel en 3 días/);
});
