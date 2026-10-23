import { describe, expect, it } from "vitest";
import {
  agruparFeatures,
  derivarEstadoSuscripcion,
  diasHastaVencimiento,
  featuresExtra,
  nivelDeUso,
  porcentajeDeUso,
  relacionConPlanActual,
} from "./suscripcion";

const AHORA = new Date(2026, 7, 7, 20, 0, 0); // 7/8/2026 20:00 local

describe("diasHastaVencimiento", () => {
  it("cuenta por día calendario y no por diferencia de horas", () => {
    // Vence mañana a las 9. Por milisegundos daría 0 días (faltan 13h); lo que
    // corresponde mostrar es 1.
    expect(diasHastaVencimiento(new Date(2026, 7, 8, 9, 0, 0), AHORA)).toBe(1);
  });

  it("devuelve 0 el mismo día del vencimiento", () => {
    expect(diasHastaVencimiento(new Date(2026, 7, 7, 1, 0, 0), AHORA)).toBe(0);
  });

  it("devuelve negativo si ya venció", () => {
    expect(diasHastaVencimiento(new Date(2026, 7, 4), AHORA)).toBe(-3);
  });

  it("tolera null y fechas inválidas sin romper", () => {
    expect(diasHastaVencimiento(null, AHORA)).toBeNull();
    expect(diasHastaVencimiento("no-es-fecha", AHORA)).toBeNull();
  });
});

describe("derivarEstadoSuscripcion", () => {
  const base = { plan: "Gestión", vencimiento: null as string | null };

  it("suspendido y cancelado ganan sobre la fecha", () => {
    expect(
      derivarEstadoSuscripcion({
        ...base,
        estado: "suspendido",
        vencimiento: new Date(2027, 0, 1).toISOString(),
        ahora: AHORA,
      }),
    ).toBe("SUSPENDIDA");

    expect(
      derivarEstadoSuscripcion({
        ...base,
        estado: "cancelado",
        vencimiento: new Date(2027, 0, 1).toISOString(),
        ahora: AHORA,
      }),
    ).toBe("CANCELADA");
  });

  it("sin plan asignado no se bloquea nada", () => {
    expect(
      derivarEstadoSuscripcion({
        estado: "activo",
        plan: null,
        vencimiento: null,
        ahora: AHORA,
      }),
    ).toBe("SIN_PLAN");
  });

  it("activa cuando falta más de una semana", () => {
    expect(
      derivarEstadoSuscripcion({
        ...base,
        estado: "activo",
        vencimiento: new Date(2026, 8, 2).toISOString(),
        ahora: AHORA,
      }),
    ).toBe("ACTIVA");
  });

  it("por vencer dentro de la ventana de aviso", () => {
    expect(
      derivarEstadoSuscripcion({
        ...base,
        estado: "activo",
        vencimiento: new Date(2026, 7, 12).toISOString(),
        ahora: AHORA,
      }),
    ).toBe("POR_VENCER");
  });

  it("vencida cuando la fecha ya pasó", () => {
    expect(
      derivarEstadoSuscripcion({
        ...base,
        estado: "activo",
        vencimiento: new Date(2026, 7, 1).toISOString(),
        ahora: AHORA,
      }),
    ).toBe("VENCIDA");
  });

  it("activa si tiene plan pero no hay fecha cargada", () => {
    expect(
      derivarEstadoSuscripcion({
        ...base,
        estado: "activo",
        vencimiento: null,
        ahora: AHORA,
      }),
    ).toBe("ACTIVA");
  });
});

describe("nivelDeUso / porcentajeDeUso", () => {
  const uso = (usado: number | null, limite: number | null) => ({
    clave: "x",
    nombre: "X",
    usado,
    limite,
  });

  it("sin límite no dibuja barra", () => {
    expect(nivelDeUso(uso(120, null))).toBe("sin-limite");
    expect(porcentajeDeUso(uso(120, null))).toBeNull();
  });

  it("no inventa nada cuando no se puede contar", () => {
    expect(nivelDeUso(uso(null, 10))).toBe("desconocido");
    expect(porcentajeDeUso(uso(null, 10))).toBeNull();
  });

  it("un tope blando avisa recién al llegar, sin 'cerca' a las 80%", () => {
    const blando = (usado: number) => ({ ...uso(usado, 5000), blando: true });
    expect(nivelDeUso(blando(4500))).toBe("ok");
    expect(nivelDeUso(blando(5000))).toBe("lleno");
    expect(nivelDeUso(blando(5200))).toBe("lleno");
  });

  it("marca lleno al alcanzar el límite", () => {
    expect(nivelDeUso(uso(5, 5))).toBe("lleno");
    expect(porcentajeDeUso(uso(5, 5))).toBe(100);
  });

  it("marca cerca a partir del 80%", () => {
    expect(nivelDeUso(uso(4, 5))).toBe("cerca");
    expect(nivelDeUso(uso(3, 5))).toBe("ok");
  });

  it("recorta a 100 si el uso superó el límite", () => {
    expect(porcentajeDeUso(uso(9, 5))).toBe(100);
    expect(nivelDeUso(uso(9, 5))).toBe("lleno");
  });
});

describe("agruparFeatures", () => {
  it("agrupa y descarta los grupos vacíos", () => {
    const grupos = agruparFeatures(["pos", "caja", "reportes"]);
    expect(grupos.map((g) => g.titulo)).toEqual(["Ventas", "Análisis"]);
    expect(grupos[0].claves).toEqual(["pos", "caja"]);
  });

  it("no pierde una clave desconocida", () => {
    const grupos = agruparFeatures(["pos", "feature_nueva"]);
    const otras = grupos.find((g) => g.titulo === "Otras funcionalidades");
    expect(otras?.claves).toEqual(["feature_nueva"]);
  });

  it("devuelve vacío sin features", () => {
    expect(agruparFeatures([])).toEqual([]);
    expect(agruparFeatures(null)).toEqual([]);
  });
});

describe("relacionConPlanActual / featuresExtra", () => {
  it("compara por orden", () => {
    expect(relacionConPlanActual(20, 20)).toBe("actual");
    expect(relacionConPlanActual(20, 30)).toBe("superior");
    expect(relacionConPlanActual(20, 10)).toBe("inferior");
  });

  it("sin plan actual, todo es superior", () => {
    expect(relacionConPlanActual(null, 10)).toBe("superior");
  });

  it("lista sólo lo que suma el otro plan", () => {
    expect(
      featuresExtra({ features: ["pos", "caja"] }, { features: ["pos", "roles"] }),
    ).toEqual(["roles"]);
  });
});
