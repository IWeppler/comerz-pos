import { describe, expect, it } from "vitest";
import { inferirMarca } from "./inferir-marca";

describe("inferirMarca", () => {
  it("saca la marca del principio del nombre (planilla de ClickTostado)", () => {
    expect(inferirMarca("SAMSUNG A17")).toBe("Samsung");
    expect(inferirMarca("REDMI NOTE 14 PRO+")).toBe("Redmi");
    expect(inferirMarca("Motorola g56")).toBe("Motorola");
    expect(inferirMarca("ZTE A56 PRO")).toBe("ZTE");
  });

  it("reconoce los nombres de producto que son de una marca", () => {
    expect(inferirMarca("Moto g15")).toBe("Motorola");
    expect(inferirMarca("iPhone 15 Pro")).toBe("Apple");
    expect(inferirMarca("Galaxy A06")).toBe("Samsung");
  });

  it("respeta cómo la escribe el comercio", () => {
    expect(inferirMarca("Samsung A26", ["SAMSUNG", "REDMI"])).toBe("SAMSUNG");
    expect(inferirMarca("redmi 15 c", ["SAMSUNG", "REDMI"])).toBe("REDMI");
  });

  it("no adivina fuera del diccionario", () => {
    expect(inferirMarca("VENTILADOR CHEPITA")).toBeNull();
    expect(inferirMarca("Remera estampada")).toBeNull();
    expect(inferirMarca("Motosierra 45cc")).toBeNull();
    expect(inferirMarca("")).toBeNull();
  });
});
