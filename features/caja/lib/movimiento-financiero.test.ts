import { describe, expect, it } from "vitest";
import { etiquetaMovimiento, mueveElResultado } from "./movimiento-financiero";

describe("etiquetaMovimiento", () => {
  it("un cobro se lee igual venga del REGISTRO o de una corrección", () => {
    // Las 2.018 filas de CORRECCION_* de la migración del 20/9 son cobros que
    // entraron a la cuenta. El evento es el cómo, no el qué.
    expect(etiquetaMovimiento("VENTA_PAGO", "REGISTRO", 5000)).toBe(
      "Cobro de una venta",
    );
    expect(etiquetaMovimiento("VENTA_PAGO", "CORRECCION_APLICADA", 5000)).toBe(
      "Cobro de una venta",
    );
    expect(
      etiquetaMovimiento("VENTA_PAGO", "MIGRACION_ESTADO_INICIAL", 5000),
    ).toBe("Cobro de una venta");
  });

  it("el signo distingue lo que entró de lo que se revirtió", () => {
    expect(etiquetaMovimiento("VENTA_PAGO", "ANULACION", -5000)).toBe(
      "Cobro revertido",
    );
    expect(etiquetaMovimiento("VENTA_PAGO", "CORRECCION_SIN_IMPACTO", 0)).toBe(
      "Cobro sin efecto en la cuenta",
    );
  });

  it("una transferencia se lee desde la cuenta que se está mirando", () => {
    expect(etiquetaMovimiento("TRANSFERENCIA", "REGISTRO", 300000)).toBe(
      "Entró desde otra cuenta",
    );
    expect(etiquetaMovimiento("TRANSFERENCIA", "REGISTRO", -300000)).toBe(
      "Salió hacia otra cuenta",
    );
  });

  it("el turno tiene tres eventos distintos y el arqueo depende del signo", () => {
    expect(etiquetaMovimiento("TURNO_CAJA", "APERTURA_TURNO", 10000)).toBe(
      "Apertura de caja",
    );
    expect(etiquetaMovimiento("TURNO_CAJA", "CIERRE_TURNO", -50000)).toBe(
      "Cierre de caja",
    );
    expect(etiquetaMovimiento("TURNO_CAJA", "AJUSTE_ARQUEO", -200)).toBe(
      "Faltante de arqueo",
    );
    expect(etiquetaMovimiento("TURNO_CAJA", "AJUSTE_ARQUEO", 200)).toBe(
      "Sobrante de arqueo",
    );
  });

  it("un gasto siempre se llama gasto", () => {
    expect(etiquetaMovimiento("EGRESO", "REGISTRO", -150000)).toBe("Gasto");
    expect(etiquetaMovimiento("EGRESO", "MIGRACION_ESTADO_INICIAL", -150000)).toBe(
      "Gasto",
    );
  });

  it("un gasto anulado o corregido lo dice, porque la fila de egresos ya no está", () => {
    expect(etiquetaMovimiento("EGRESO", "ELIMINACION_REVERSA", 150000)).toBe(
      "Gasto anulado",
    );
    expect(etiquetaMovimiento("EGRESO", "CORRECCION_REVERSA", 150000)).toBe(
      "Gasto corregido",
    );
    expect(etiquetaMovimiento("EGRESO", "CORRECCION_APLICADA", -150000)).toBe(
      "Gasto corregido",
    );
  });

  it("la acreditación se lee distinto en el puente y en el destino", () => {
    expect(etiquetaMovimiento("ACREDITACION", "ACREDITACION_ENTRADA", 8000)).toBe(
      "Se acreditó",
    );
    expect(etiquetaMovimiento("ACREDITACION", "ACREDITACION_SALIDA", -8000)).toBe(
      "Pasó a su cuenta",
    );
  });

  it("el saldo inicial tiene su propio nombre", () => {
    expect(etiquetaMovimiento("AJUSTE", "AJUSTE_SALDO_INICIAL", 750000)).toBe(
      "Saldo inicial declarado",
    );
  });

  it("fail-closed: un origen desconocido no se inventa", () => {
    expect(etiquetaMovimiento("LO_QUE_VENGA", "ALGO", 100)).toBe("Movimiento");
  });
});

describe("mueveElResultado", () => {
  it("un gasto sí y una transferencia no: es toda la idea del módulo", () => {
    expect(mueveElResultado("EGRESO", "REGISTRO")).toBe(true);
    expect(mueveElResultado("TRANSFERENCIA", "REGISTRO")).toBe(false);
  });

  it("un cobro no mueve el resultado desde la cuenta: la venta ya lo hizo", () => {
    expect(mueveElResultado("VENTA_PAGO", "REGISTRO")).toBe(false);
  });

  it("del turno, solo la diferencia de arqueo es plata que se perdió", () => {
    expect(mueveElResultado("TURNO_CAJA", "AJUSTE_ARQUEO")).toBe(true);
    expect(mueveElResultado("TURNO_CAJA", "CIERRE_TURNO")).toBe(false);
    expect(mueveElResultado("TURNO_CAJA", "APERTURA_TURNO")).toBe(false);
  });

  it("declarar el saldo inicial no es un ingreso", () => {
    expect(mueveElResultado("AJUSTE", "AJUSTE_SALDO_INICIAL")).toBe(false);
  });
});
