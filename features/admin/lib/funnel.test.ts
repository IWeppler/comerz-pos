import { describe, expect, it } from "vitest";
import {
  analizarFunnel,
  enRiesgo,
  porOrigen,
  resumirFunnel,
  type FilaFunnel,
} from "./funnel";

const AHORA = new Date("2026-08-23T12:00:00Z");

const fila = (p: Partial<FilaFunnel> & { nombre: string }): FilaFunnel => ({
  id: p.nombre,
  estado: "activo",
  alta: "2026-08-01T00:00:00Z",
  primeraVenta: null,
  ultimaVenta: null,
  ventasTotal: 0,
  pagos: 0,
  primerPago: null,
  origen: null,
  referidoPor: null,
  ...p,
});

describe("analizarFunnel", () => {
  it("cuenta los días entre el alta y la primera venta", () => {
    const [c] = analizarFunnel(
      [
        fila({
          nombre: "a",
          alta: "2026-08-01T00:00:00Z",
          primeraVenta: "2026-08-06T00:00:00Z",
        }),
      ],
      AHORA,
    );

    expect(c.activado).toBe(true);
    expect(c.migrado).toBe(false);
    expect(c.diasHastaActivacion).toBe(5);
  });

  it("marca como migrado a quien vendió ANTES de darse de alta", () => {
    // Es el caso de Evens, ClickTostado y Estilo Bonito: venían de otro
    // sistema. Su activación ocurrió antes de existir en Comerz.
    const [c] = analizarFunnel(
      [
        fila({
          nombre: "evens",
          alta: "2026-08-02T00:00:00Z",
          primeraVenta: "2026-07-16T00:00:00Z",
        }),
      ],
      AHORA,
    );

    expect(c.migrado).toBe(true);
    expect(c.activado).toBe(true);
    // Sin esto sería -17 días, un número que no describe nada.
    expect(c.diasHastaActivacion).toBeNull();
  });

  it("quien nunca vendió no está activado y no tiene días sin vender", () => {
    const [c] = analizarFunnel([fila({ nombre: "prueba" })], AHORA);

    expect(c.activado).toBe(false);
    expect(c.diasHastaActivacion).toBeNull();
    expect(c.diasSinVender).toBeNull();
  });

  it("cuenta los días desde la última venta", () => {
    const [c] = analizarFunnel(
      [
        fila({
          nombre: "a",
          primeraVenta: "2026-08-01T00:00:00Z",
          ultimaVenta: "2026-08-09T12:00:00Z",
        }),
      ],
      AHORA,
    );

    expect(c.diasSinVender).toBe(14);
  });
});

describe("resumirFunnel", () => {
  it("la tasa de pago se calcula sobre los ACTIVADOS, no sobre los registrados", () => {
    // 4 registrados, 2 activaron, 1 pagó.
    const comercios = analizarFunnel(
      [
        fila({ nombre: "a", primeraVenta: "2026-08-05T00:00:00Z", pagos: 1 }),
        fila({ nombre: "b", primeraVenta: "2026-08-05T00:00:00Z" }),
        fila({ nombre: "c" }),
        fila({ nombre: "d" }),
      ],
      AHORA,
    );

    const r = resumirFunnel(comercios);

    expect(r.registrados).toBe(4);
    expect(r.activados).toBe(2);
    expect(r.pagaron).toBe(1);
    expect(r.tasaActivacion).toBe(50);
    // 1 de 2 activados, NO 1 de 4 registrados: mezclar a los que nunca lo
    // probaron esconde si el problema es el producto o el precio.
    expect(r.tasaPago).toBe(50);
  });

  it("usa MEDIANA y no promedio para los días de activación", () => {
    // 1, 2, 3 y 40 días. El promedio da 11,5 — un valor que no le pasó a
    // ninguno. La mediana da 2,5.
    const comercios = analizarFunnel(
      [
        fila({ nombre: "a", primeraVenta: "2026-08-02T00:00:00Z" }),
        fila({ nombre: "b", primeraVenta: "2026-08-03T00:00:00Z" }),
        fila({ nombre: "c", primeraVenta: "2026-08-04T00:00:00Z" }),
        fila({ nombre: "d", primeraVenta: "2026-09-10T00:00:00Z" }),
      ],
      AHORA,
    );

    expect(resumirFunnel(comercios).medianaDiasActivacion).toBe(2.5);
  });

  it("los migrados quedan fuera del tiempo de activación pero se informan", () => {
    const comercios = analizarFunnel(
      [
        fila({ nombre: "migrado", primeraVenta: "2026-07-01T00:00:00Z" }),
        fila({ nombre: "nuevo", primeraVenta: "2026-08-05T00:00:00Z" }),
      ],
      AHORA,
    );

    const r = resumirFunnel(comercios);
    expect(r.migrados).toBe(1);
    // Solo el del alta nueva entra en la cuenta.
    expect(r.medianaDiasActivacion).toBe(4);
  });

  it("sin registrados no divide por cero", () => {
    const r = resumirFunnel([]);
    expect(r.tasaActivacion).toBeNull();
    expect(r.tasaPago).toBeNull();
    expect(r.medianaDiasActivacion).toBeNull();
  });
});

describe("enRiesgo", () => {
  it("pone primero al que nunca vendió", () => {
    const comercios = analizarFunnel(
      [
        fila({
          nombre: "dejo-de-vender",
          primeraVenta: "2026-07-01T00:00:00Z",
          ultimaVenta: "2026-08-01T00:00:00Z",
        }),
        fila({ nombre: "nunca-vendio" }),
      ],
      AHORA,
    );

    const riesgo = enRiesgo(comercios);
    expect(riesgo.map((c) => c.nombre)).toEqual([
      "nunca-vendio",
      "dejo-de-vender",
    ]);
  });

  it("no marca al que vendió hace poco", () => {
    const comercios = analizarFunnel(
      [
        fila({
          nombre: "al-dia",
          primeraVenta: "2026-07-01T00:00:00Z",
          ultimaVenta: "2026-08-22T00:00:00Z",
        }),
      ],
      AHORA,
    );

    expect(enRiesgo(comercios)).toHaveLength(0);
  });

  it("un cancelado ya no es riesgo: la baja ya pasó", () => {
    const comercios = analizarFunnel(
      [fila({ nombre: "cancelado", estado: "cancelado" })],
      AHORA,
    );

    expect(enRiesgo(comercios)).toHaveLength(0);
  });
});

describe("porOrigen", () => {
  it("agrupa por referido o campaña, y 'Sin dato' va último", () => {
    const comercios = analizarFunnel(
      [
        fila({ nombre: "viejo1" }),
        fila({ nombre: "viejo2" }),
        fila({ nombre: "viejo3" }),
        fila({
          nombre: "ref1",
          origen: { ref: "evens-indumentaria", utm_source: "tienda" },
          referidoPor: "Evens Indumentaria",
          primeraVenta: "2026-08-02T00:00:00Z",
          pagos: 1,
        }),
        fila({
          nombre: "ref2",
          origen: { ref: "evens-indumentaria" },
          referidoPor: "Evens Indumentaria",
        }),
        fila({ nombre: "ig", origen: { utm_source: "instagram", utm_medium: "bio" } }),
        fila({ nombre: "roto", origen: { ref: "nadie" } }),
      ],
      AHORA,
    );

    expect(porOrigen(comercios)).toEqual([
      { etiqueta: "Referido: Evens Indumentaria", registrados: 2, activados: 1, pagaron: 1 },
      { etiqueta: "instagram / bio", registrados: 1, activados: 0, pagaron: 0 },
      { etiqueta: "Referido: nadie (código sin dueño)", registrados: 1, activados: 0, pagaron: 0 },
      { etiqueta: "Sin dato", registrados: 3, activados: 0, pagaron: 0 },
    ]);
  });
});
