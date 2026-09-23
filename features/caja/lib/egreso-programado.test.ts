import { describe, expect, it } from "vitest";
import {
  estadoVencimiento,
  etiquetaFrecuencia,
  siguienteFechaProgramada,
  totalProgramado,
} from "./egreso-programado";

describe("siguienteFechaProgramada", () => {
  // Los mismos casos que verifica la migración sobre
  // `public.siguiente_fecha_programada`. Si uno cambia, cambian los dos.
  it("el 31 de enero recorta a fin de febrero y el ancla lo devuelve al 31", () => {
    expect(siguienteFechaProgramada("2026-01-31", "MENSUAL", 31)).toBe(
      "2026-02-28",
    );
    expect(siguienteFechaProgramada("2026-02-28", "MENSUAL", 31)).toBe(
      "2026-03-31",
    );
  });

  it("sin ancla, el vencimiento se queda clavado donde lo dejó febrero", () => {
    // Es la trampa que el ancla existe para evitar, y se deja escrita como
    // test para que se vea la diferencia: sin ancla, el que pagaba el 31
    // pasa a pagar el 28 para siempre.
    expect(siguienteFechaProgramada("2026-01-31", "MENSUAL")).toBe("2026-02-28");
    expect(siguienteFechaProgramada("2026-02-28", "MENSUAL")).toBe("2026-03-28");
  });

  it("conserva el día cuando el mes lo tiene", () => {
    expect(siguienteFechaProgramada("2026-03-05", "MENSUAL")).toBe("2026-04-05");
  });

  it("semanal y quincenal suman días, no meses", () => {
    expect(siguienteFechaProgramada("2026-03-05", "SEMANAL")).toBe("2026-03-12");
    expect(siguienteFechaProgramada("2026-03-05", "QUINCENAL")).toBe(
      "2026-03-19",
    );
  });

  it("cruza el fin de año", () => {
    expect(siguienteFechaProgramada("2026-12-10", "MENSUAL")).toBe("2027-01-10");
    expect(siguienteFechaProgramada("2026-11-30", "TRIMESTRAL", 30)).toBe(
      "2027-02-28",
    );
  });

  it("anual respeta el 29 de febrero de un bisiesto", () => {
    // 2028 sí es bisiesto; 2027 no. Con ancla 29, el año no bisiesto recorta.
    expect(siguienteFechaProgramada("2026-02-28", "ANUAL", 29)).toBe(
      "2027-02-28",
    );
    expect(siguienteFechaProgramada("2027-02-28", "ANUAL", 29)).toBe(
      "2028-02-29",
    );
  });

  it("UNICO no se repite", () => {
    expect(siguienteFechaProgramada("2026-03-05", "UNICO")).toBeNull();
  });

  it("una frecuencia desconocida no se inventa", () => {
    expect(siguienteFechaProgramada("2026-03-05", "CADA_LUNA_LLENA")).toBeNull();
  });
});

describe("estadoVencimiento", () => {
  it("ayer está vencido, hoy vence hoy, mañana es próximo", () => {
    expect(estadoVencimiento("2026-09-22", "2026-09-23")).toBe("VENCIDO");
    expect(estadoVencimiento("2026-09-23", "2026-09-23")).toBe("HOY");
    expect(estadoVencimiento("2026-09-24", "2026-09-23")).toBe("PROXIMO");
  });
});

describe("totalProgramado", () => {
  const hoy = "2026-09-23";

  it("suma lo que vence dentro de la ventana", () => {
    const total = totalProgramado(
      [
        { monto: 1175000, proxima_fecha: "2026-09-25" },
        { monto: 245000, proxima_fecha: "2026-09-30" },
        // Fuera de los 30 días: no entra.
        { monto: 80000, proxima_fecha: "2026-11-15" },
      ],
      hoy,
    );
    expect(total.monto).toBe(1420000);
    expect(total.cantidad).toBe(2);
  });

  it("los VENCIDOS entran en el total y se cuentan aparte", () => {
    // Si quedaran afuera, el número bajaría justo cuando alguien se atrasa —
    // al revés de lo que tiene que pasar.
    const total = totalProgramado(
      [
        { monto: 1175000, proxima_fecha: "2026-09-10" },
        { monto: 245000, proxima_fecha: "2026-09-30" },
      ],
      hoy,
    );
    expect(total.monto).toBe(1420000);
    expect(total.vencidos).toBe(1);
    expect(total.montoVencido).toBe(1175000);
  });

  it("los dados de baja no cuentan", () => {
    // Inactivo es "ya no se paga", no "se pagó".
    const total = totalProgramado(
      [{ monto: 500000, proxima_fecha: "2026-09-25", activo: false }],
      hoy,
    );
    expect(total).toEqual({
      monto: 0,
      cantidad: 0,
      vencidos: 0,
      montoVencido: 0,
    });
  });

  it("el borde de la ventana entra", () => {
    // Exactamente a 30 días: adentro. Un día más: afuera.
    expect(
      totalProgramado([{ monto: 100, proxima_fecha: "2026-10-23" }], hoy)
        .cantidad,
    ).toBe(1);
    expect(
      totalProgramado([{ monto: 100, proxima_fecha: "2026-10-24" }], hoy)
        .cantidad,
    ).toBe(0);
  });

  it("sin nada cargado devuelve ceros, no NaN", () => {
    expect(totalProgramado([], hoy).monto).toBe(0);
  });
});

describe("etiquetaFrecuencia", () => {
  it("traduce las conocidas y deja pasar lo que no conoce", () => {
    expect(etiquetaFrecuencia("MENSUAL")).toBe("Todos los meses");
    expect(etiquetaFrecuencia("LO_QUE_VENGA")).toBe("LO_QUE_VENGA");
  });
});
