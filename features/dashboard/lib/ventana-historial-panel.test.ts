import { describe, it, expect } from "vitest";
import {
  DIAS_INSIGHTS,
  DIAS_MINIMOS_HISTORIAL_PANEL,
  resolverDesdeHistorialPanel,
} from "./ventana-historial-panel";
import {
  DIAS_CHART,
  resolverRangoAnterior,
  resolverRangoRolling,
} from "@/shared/lib/periodo-ranges";
import { SEMANAS_DIA_TIPICO, compararConDiaTipico } from "./dia-tipico";
import { VENTANA_ROTACION_DIAS } from "./detectar-quiebres";
import { DIAS_SIN_MOVIMIENTO } from "@/features/reports/actions/get-advisor-insights";
import type { Venta } from "@/entities/ventas/types";

const MIERCOLES = new Date(2026, 8, 16, 15, 30, 0); // miércoles 2026-09-16

function venta(fecha: string): Venta {
  return {
    id: crypto.randomUUID(),
    total: 1000,
    precio_costo: 500,
    cantidad: 1,
    fecha_venta: fecha,
  } as Venta;
}

describe("resolverDesdeHistorialPanel", () => {
  it("arranca a las 00:00 local, nunca a mitad de un día", () => {
    for (const periodo of ["hoy", "semana", "mes", "trimestre", "anio"] as const) {
      const desde = resolverDesdeHistorialPanel(periodo, MIERCOLES);
      expect(desde.getHours()).toBe(0);
      expect(desde.getMinutes()).toBe(0);
      expect(desde.getSeconds()).toBe(0);
    }
  });

  it("cubre el período anterior de la comparación, para cada período", () => {
    for (const periodo of ["hoy", "semana", "mes", "trimestre", "anio"] as const) {
      const desde = resolverDesdeHistorialPanel(periodo, MIERCOLES);
      const anterior = resolverRangoAnterior(periodo, MIERCOLES);
      expect(desde.getTime()).toBeLessThanOrEqual(anterior.inicio.getTime());
    }
  });

  it("con 'Año' es el período anterior el que manda: dos años hacia atrás", () => {
    const desde = resolverDesdeHistorialPanel("anio", MIERCOLES);
    const anterior = resolverRangoAnterior("anio", MIERCOLES);
    expect(desde.getTime()).toBe(anterior.inicio.getTime());
    // 364 del actual (hoy − 363) corridos 364 más: hoy − 727, a las 00:00.
    const dias = Math.floor(
      (MIERCOLES.getTime() - desde.getTime()) / 86_400_000,
    );
    expect(dias).toBe(727);
  });

  it("con períodos cortos manda el piso, no la comparación", () => {
    const desde = resolverDesdeHistorialPanel("semana", MIERCOLES);
    const piso = resolverRangoRolling(DIAS_MINIMOS_HISTORIAL_PANEL, MIERCOLES);
    expect(desde.getTime()).toBe(piso.inicio.getTime());
  });
});

describe("DIAS_MINIMOS_HISTORIAL_PANEL cubre a cada consumidor", () => {
  it("es el mayor de todas las ventanas que el panel mira", () => {
    expect(DIAS_MINIMOS_HISTORIAL_PANEL).toBeGreaterThanOrEqual(DIAS_CHART);
    expect(DIAS_MINIMOS_HISTORIAL_PANEL).toBeGreaterThanOrEqual(DIAS_INSIGHTS);
    expect(DIAS_MINIMOS_HISTORIAL_PANEL).toBeGreaterThanOrEqual(
      VENTANA_ROTACION_DIAS,
    );
  });

  it("alcanza al día de referencia más viejo del 'día típico'", () => {
    // El día típico de un miércoles mira los 8 miércoles anteriores; el más
    // viejo es hoy − 56 días, desde su 00:00. Una venta de ese día a primera
    // hora tiene que entrar en la ventana.
    const desde = resolverDesdeHistorialPanel("hoy", MIERCOLES);
    const masViejo = new Date(
      MIERCOLES.getFullYear(),
      MIERCOLES.getMonth(),
      MIERCOLES.getDate() - 7 * SEMANAS_DIA_TIPICO,
      0,
      0,
      1,
    );
    expect(desde.getTime()).toBeLessThanOrEqual(masViejo.getTime());

    // Y `compararConDiaTipico` efectivamente la cuenta: la referencia no es
    // cero.
    const referencia = compararConDiaTipico(
      [venta(masViejo.toISOString()), venta(MIERCOLES.toISOString())],
      MIERCOLES,
    );
    expect(referencia.tipico.ingresos).toBeGreaterThan(0);
  });

  it("'inventario estancado' da lo mismo con la ventana que con el historial entero", () => {
    // La regla cuenta productos cuya última venta tiene ≥ DIAS_SIN_MOVIMIENTO
    // días, y un producto sin ventas cargadas vale 9999. Para que recortar el
    // historial no cambie el conteo, todo lo que quede AFUERA de la ventana
    // tiene que ser ya "estancado" por antigüedad: la ventana tiene que
    // cubrir al menos DIAS_SIN_MOVIMIENTO días completos más el de hoy.
    expect(DIAS_MINIMOS_HISTORIAL_PANEL).toBeGreaterThanOrEqual(
      DIAS_SIN_MOVIMIENTO + 1,
    );
    const desde = resolverDesdeHistorialPanel("semana", MIERCOLES);
    const limite = new Date(
      MIERCOLES.getFullYear(),
      MIERCOLES.getMonth(),
      MIERCOLES.getDate() - DIAS_SIN_MOVIMIENTO,
    );
    // Una venta de hace exactamente DIAS_SIN_MOVIMIENTO días entra en la
    // ventana: con ella cargada da 30 días (estancado) y sin ella daría 9999
    // (estancado). Una de hace 29 también entra, y esa SÍ cambia el
    // resultado si faltara.
    expect(desde.getTime()).toBeLessThanOrEqual(limite.getTime());
  });
});
