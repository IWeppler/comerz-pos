import { describe, expect, it } from "vitest";
import {
  DEFINICION_TIPO_INGRESO,
  TIPOS_INGRESO,
  esResultadoDelNegocio,
  esTipoIngreso,
  etiquetaTipoIngreso,
  normalizarTipoIngreso,
} from "./tipo-ingreso";

describe("tipo-ingreso", () => {
  it("solo el ingreso extraordinario es ganancia; aporte y préstamo solo mueven plata", () => {
    // Espejo de `ingreso_impacto_resultado` en la base: si esto cambia,
    // cambia la migración.
    expect(esResultadoDelNegocio("INGRESO_EXTRAORDINARIO")).toBe(true);
    expect(esResultadoDelNegocio("APORTE_SOCIO")).toBe(false);
    expect(esResultadoDelNegocio("PRESTAMO")).toBe(false);
  });

  it("un tipo desconocido cae del lado que NO infla la ganancia", () => {
    expect(normalizarTipoIngreso("VENTA")).toBe("APORTE_SOCIO");
    expect(normalizarTipoIngreso(undefined)).toBe("APORTE_SOCIO");
    expect(esResultadoDelNegocio("lo-que-sea")).toBe(false);
  });

  it("todos los tipos tienen definición y etiqueta", () => {
    for (const tipo of TIPOS_INGRESO) {
      expect(esTipoIngreso(tipo)).toBe(true);
      expect(DEFINICION_TIPO_INGRESO[tipo].label).toBeTruthy();
      expect(etiquetaTipoIngreso(tipo)).toBe(DEFINICION_TIPO_INGRESO[tipo].label);
    }
  });
});
