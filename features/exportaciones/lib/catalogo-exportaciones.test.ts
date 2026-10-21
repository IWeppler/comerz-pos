import { describe, expect, it } from "vitest";
import {
  definicionDe,
  esExportable,
  EXPORTACIONES,
  exportacionesPorGrupo,
  GRUPOS_EXPORTACION,
} from "./catalogo-exportaciones";
import {
  normalizarPeriodoExportacion,
  opcionesPeriodoExportacion,
  rangoDeExportacion,
  rangoLegible,
} from "./periodo-exportacion";

describe("catálogo", () => {
  it("toda exportación no disponible explica POR QUÉ", () => {
    // Es la regla que sostiene la honestidad del módulo: sin motivo, el
    // comerciante ve un botón apagado y no sabe qué le falta.
    for (const e of EXPORTACIONES) {
      if (!e.disponible) {
        expect(e.motivoNoDisponible, `falta motivo en ${e.clave}`).toBeTruthy();
      }
    }
  });

  it("el libro de IVA ventas está disponible; compras y resumen no", () => {
    // Ventas sale de `comprobantes` con CAE de producción, que existe desde
    // la conexión con ARCA. Compras no se destraba con ARCA: los remitos no
    // guardan CUIT ni IVA. Y el resumen necesita los dos.
    expect(esExportable("libro_iva_ventas")).toBe(true);
    expect(esExportable("notas_credito")).toBe(true);
    expect(esExportable("libro_iva_compras")).toBe(false);
    expect(esExportable("resumen_iva")).toBe(false);
  });

  it("lo que sí tiene datos reales está disponible", () => {
    for (const clave of [
      "ventas",
      "comprobantes",
      "compras",
      "movimientos_caja",
      "movimientos_generales",
    ]) {
      expect(esExportable(clave), clave).toBe(true);
    }
  });

  it("una clave inventada no es exportable (fail-closed)", () => {
    // La clave llega desde el cliente: el botón deshabilitado no es control.
    expect(esExportable("todo_lo_que_haya")).toBe(false);
    expect(esExportable(null)).toBe(false);
    expect(definicionDe("no_existe")).toBeUndefined();
  });

  it("cada exportación cae en un grupo conocido", () => {
    const enGrupos = GRUPOS_EXPORTACION.flatMap((g) => exportacionesPorGrupo(g));
    expect(enGrupos).toHaveLength(EXPORTACIONES.length);
  });

  it("no hay claves repetidas", () => {
    const claves = EXPORTACIONES.map((e) => e.clave);
    expect(new Set(claves).size).toBe(claves.length);
  });
});

describe("período de exportación", () => {
  it("cae al mes anterior ante lo desconocido", () => {
    // Es el período CERRADO: el único que no se sigue moviendo mientras el
    // contador trabaja sobre él.
    expect(normalizarPeriodoExportacion("historico")).toBe("mes_anterior");
    expect(normalizarPeriodoExportacion(null)).toBe("mes_anterior");
    expect(normalizarPeriodoExportacion("mes")).toBe("mes");
  });

  it("mes anterior devuelve el mes COMPLETO, no hasta el día de hoy", () => {
    // El bug que esto atrapa: reusar resolverRangoAnterior("mes") de shared,
    // que recorta al mismo día del mes para poder comparar. Un contador que
    // pide julio un 8 de agosto se llevaría del 1 al 8 y presentaría un mes
    // incompleto sin enterarse.
    const ahora = new Date(2026, 7, 8); // 8 de agosto de 2026
    const { inicio, fin } = rangoDeExportacion("mes_anterior", ahora);

    expect(inicio.getMonth()).toBe(6); // julio
    expect(inicio.getDate()).toBe(1);
    expect(fin.getMonth()).toBe(6);
    expect(fin.getDate()).toBe(31);
  });

  it("cierra bien los meses cortos y febrero bisiesto", () => {
    // Marzo pide febrero: 28 o 29 según el año, sin tabla de meses.
    expect(rangoDeExportacion("mes_anterior", new Date(2026, 2, 5)).fin.getDate()).toBe(28);
    expect(rangoDeExportacion("mes_anterior", new Date(2028, 2, 5)).fin.getDate()).toBe(29);
    // Mayo pide abril, que tiene 30.
    expect(rangoDeExportacion("mes_anterior", new Date(2026, 4, 20)).fin.getDate()).toBe(30);
  });

  it("en enero pide diciembre del año anterior", () => {
    const { inicio, fin } = rangoDeExportacion("mes_anterior", new Date(2026, 0, 10));
    expect(inicio.getFullYear()).toBe(2025);
    expect(inicio.getMonth()).toBe(11);
    expect(fin.getFullYear()).toBe(2025);
    expect(fin.getDate()).toBe(31);
  });

  it("mes actual arranca el día 1", () => {
    const ahora = new Date(2026, 7, 8);
    const { inicio } = rangoDeExportacion("mes", ahora);
    expect(inicio.getMonth()).toBe(7);
    expect(inicio.getDate()).toBe(1);
  });

  it("año en curso arranca el 1 de enero", () => {
    const ahora = new Date(2026, 7, 8);
    const { inicio } = rangoDeExportacion("anio", ahora);
    expect(inicio.getMonth()).toBe(0);
    expect(inicio.getDate()).toBe(1);
    expect(inicio.getFullYear()).toBe(2026);
  });
});

describe("meses cerrados y año anterior", () => {
  const ahora = new Date(2026, 7, 21); // 21 de agosto de 2026

  it("ofrece los 12 meses anteriores al actual, y el año anterior", () => {
    const valores = opcionesPeriodoExportacion(ahora).map((o) => o.valor);
    expect(valores).toContain("mes:2026-03");
    expect(valores).toContain("mes:2025-08");
    expect(valores).toContain("anio_anterior");
    expect(valores).not.toContain("mes:2026-08"); // ese es "mes", no un cierre
  });

  it("un mes cerrado va del 1 al último día, aunque hoy esté en otro mes", () => {
    const { inicio, fin } = rangoDeExportacion("mes:2026-03", ahora);
    expect(inicio.getMonth()).toBe(2);
    expect(inicio.getDate()).toBe(1);
    expect(fin.getMonth()).toBe(2);
    expect(fin.getDate()).toBe(31);
  });

  it("febrero bisiesto se cierra en 29", () => {
    expect(rangoDeExportacion("mes:2028-02", new Date(2028, 3, 10)).fin.getDate()).toBe(29);
  });

  it("una clave de mes inventada o fuera de rango cae al mes anterior", () => {
    expect(normalizarPeriodoExportacion("mes:2026-13", ahora)).toBe("mes_anterior");
    expect(normalizarPeriodoExportacion("mes:2026-08-01", ahora)).toBe("mes_anterior");
    expect(normalizarPeriodoExportacion("mes:2010-01", ahora)).toBe("mes_anterior");
    expect(normalizarPeriodoExportacion("mes:2027-01", ahora)).toBe("mes_anterior");
  });

  it("el año anterior va del 1 de enero al 31 de diciembre", () => {
    const { inicio, fin } = rangoDeExportacion("anio_anterior", ahora);
    expect(inicio.getFullYear()).toBe(2025);
    expect(inicio.getMonth()).toBe(0);
    expect(fin.getMonth()).toBe(11);
    expect(fin.getDate()).toBe(31);
  });

  it("el texto de período muestra las fechas exactas", () => {
    const texto = rangoLegible("mes:2026-03", ahora);
    expect(texto).toContain("1 de marzo de 2026");
    expect(texto).toContain("31 de marzo de 2026");
  });
});
