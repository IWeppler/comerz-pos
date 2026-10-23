import { describe, expect, it } from "vitest";
import {
  ATAJOS_RECARGO_PCT,
  calcularRecargoLibre,
  RECARGO_PCT_MAX,
  esDesvioDelDefault,
  formatearPct,
  normalizarPctRecargo,
  pctRecargoEfectivo,
} from "./recargo-ticket";

describe("normalizarPctRecargo", () => {
  it("acepta números y textos, con coma o con punto", () => {
    expect(normalizarPctRecargo(5)).toBe(5);
    expect(normalizarPctRecargo("5")).toBe(5);
    expect(normalizarPctRecargo("4,8")).toBe(4.8);
    expect(normalizarPctRecargo("4.8")).toBe(4.8);
    expect(normalizarPctRecargo(" 12 ")).toBe(12);
  });

  it("el cero es un valor válido: es 'sin recargo'", () => {
    expect(normalizarPctRecargo(0)).toBe(0);
    expect(normalizarPctRecargo("0")).toBe(0);
  });

  it("el tope es 100", () => {
    expect(normalizarPctRecargo(RECARGO_PCT_MAX)).toBe(100);
    expect(normalizarPctRecargo(100.01)).toBeNull();
    expect(normalizarPctRecargo("1000")).toBeNull();
  });

  it("rechaza negativos, NaN, vacío y lo que no es un número", () => {
    expect(normalizarPctRecargo(-1)).toBeNull();
    expect(normalizarPctRecargo("-5")).toBeNull();
    expect(normalizarPctRecargo(NaN)).toBeNull();
    expect(normalizarPctRecargo(Infinity)).toBeNull();
    expect(normalizarPctRecargo("")).toBeNull();
    expect(normalizarPctRecargo("abc")).toBeNull();
    expect(normalizarPctRecargo("1.2.3")).toBeNull();
    expect(normalizarPctRecargo(null)).toBeNull();
    expect(normalizarPctRecargo(undefined)).toBeNull();
    expect(normalizarPctRecargo({})).toBeNull();
  });

  it("deja dos decimales: es la precisión con que se guarda", () => {
    expect(normalizarPctRecargo("4,8333")).toBe(4.83);
    expect(normalizarPctRecargo(0.1 + 0.2)).toBe(0.3);
  });
});

describe("esDesvioDelDefault", () => {
  it("igual al default no es desvío", () => {
    expect(esDesvioDelDefault(4.8, 4.8)).toBe(false);
    expect(esDesvioDelDefault(4.8, 4.80)).toBe(false);
  });

  it("subir, bajar o anular sí son desvío: todos piden permiso", () => {
    expect(esDesvioDelDefault(0, 4.8)).toBe(true); // anular
    expect(esDesvioDelDefault(5, 4.8)).toBe(true); // subir
    expect(esDesvioDelDefault(3, 4.8)).toBe(true); // bajar
  });

  it("un comercio sin recargo configurado: ponerle uno es desvío", () => {
    expect(esDesvioDelDefault(5, 0)).toBe(true);
    expect(esDesvioDelDefault(0, 0)).toBe(false);
  });

  it("no se confunde por colas de punto flotante", () => {
    expect(esDesvioDelDefault(0.1 + 0.2, 0.3)).toBe(false);
  });
});

describe("pctRecargoEfectivo y atajos", () => {
  it("sin elección rige el default; 0 elegido NO cae al default", () => {
    expect(pctRecargoEfectivo(null, 4.8)).toBe(4.8);
    expect(pctRecargoEfectivo(undefined, 4.8)).toBe(4.8);
    expect(pctRecargoEfectivo(0, 4.8)).toBe(0);
    expect(pctRecargoEfectivo(10, 4.8)).toBe(10);
  });

  it("los atajos son 0, 5, 10 y 15", () => {
    expect([...ATAJOS_RECARGO_PCT]).toEqual([0, 5, 10, 15]);
  });

  it("formatea para mostrar", () => {
    expect(formatearPct(4.8)).toBe("4,8%");
    expect(formatearPct(5)).toBe("5%");
  });
});

describe("calcularRecargoLibre", () => {
  it("porcentaje sobre la base, al peso", () => {
    expect(calcularRecargoLibre(10000, 10)).toBe(1000);
    expect(calcularRecargoLibre(10000, 5)).toBe(500);
    expect(calcularRecargoLibre(9990, 15)).toBe(1499); // 1498,5 → 1499
    expect(calcularRecargoLibre(1234, 7.5)).toBe(93); // 92,55 → 93
  });

  it("sin base o sin porcentaje no hay recargo", () => {
    expect(calcularRecargoLibre(0, 10)).toBe(0);
    expect(calcularRecargoLibre(10000, 0)).toBe(0);
    expect(calcularRecargoLibre(-500, 10)).toBe(0);
    expect(calcularRecargoLibre(10000, -5)).toBe(0);
    expect(calcularRecargoLibre(NaN, 10)).toBe(0);
    expect(calcularRecargoLibre(10000, NaN)).toBe(0);
  });

  it("el ticket cierra: mercadería menos descuento más recargo es el total", () => {
    const subtotal = 25000;
    const descuento = 2500;
    const base = subtotal - descuento; // el recargo va sobre lo que queda
    const recargo = calcularRecargoLibre(base, 10);
    expect(recargo).toBe(2250);
    expect(base + recargo).toBe(24750);
  });
});
