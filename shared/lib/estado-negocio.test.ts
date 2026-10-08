import { describe, expect, it } from "vitest";
import {
  ESTADO_BAJA,
  ESTADOS_HABILITADOS,
  esNegocioDeBaja,
  esNegocioDemo,
  negocioHabilitado,
  sumaAlMrr,
} from "./estado-negocio";

describe("negocioHabilitado", () => {
  it("deja trabajar a activo, prueba y demo", () => {
    // La demo TIENE que funcionar entera: mostrar el producto es usarlo.
    expect(negocioHabilitado("activo")).toBe(true);
    expect(negocioHabilitado("prueba")).toBe(true);
    expect(negocioHabilitado("demo")).toBe(true);
  });

  it("frena al suspendido y al cancelado", () => {
    expect(negocioHabilitado("suspendido")).toBe(false);
    expect(negocioHabilitado("cancelado")).toBe(false);
  });

  it("un estado desconocido no entra", () => {
    // Fail-closed: 'baja' es justamente el string que el código escribía y que
    // la base nunca aceptó.
    expect(negocioHabilitado("baja")).toBe(false);
    expect(negocioHabilitado(null)).toBe(false);
    expect(negocioHabilitado(undefined)).toBe(false);
  });
});

describe("esNegocioDemo", () => {
  it("solo el estado demo", () => {
    expect(esNegocioDemo("demo")).toBe(true);
    expect(esNegocioDemo("prueba")).toBe(false);
    expect(esNegocioDemo(null)).toBe(false);
  });

  it("está habilitado, así que no se cuenta como inactivo", () => {
    // Es el detalle que hace que la demo no aparezca como baja del mes.
    expect(ESTADOS_HABILITADOS).toContain("demo");
  });
});

describe("esNegocioDeBaja", () => {
  it("el estado de baja es 'cancelado', no 'baja'", () => {
    // El bug que arregla: el menú escribía 'baja' —que no está en el CHECK de
    // la base, o sea que el update fallaba siempre— y el churn buscaba ese
    // mismo estado inexistente, así que daba 0 por construcción.
    expect(ESTADO_BAJA).toBe("cancelado");
    expect(esNegocioDeBaja("cancelado")).toBe(true);
    expect(esNegocioDeBaja("baja")).toBe(false);
  });
});

describe("sumaAlMrr", () => {
  it("activo y dentro de la cuenta suma; sin dato, también (default de la columna)", () => {
    expect(sumaAlMrr({ estado: "activo", cuenta_en_mrr: true })).toBe(true);
    expect(sumaAlMrr({ estado: "activo" })).toBe(true);
  });

  it("activo de cortesía no suma", () => {
    expect(sumaAlMrr({ estado: "activo", cuenta_en_mrr: false })).toBe(false);
  });

  it("prueba, demo y suspendido no suman aunque estén en la cuenta", () => {
    for (const estado of ["prueba", "demo", "suspendido", "cancelado"]) {
      expect(sumaAlMrr({ estado, cuenta_en_mrr: true })).toBe(false);
    }
  });
});
