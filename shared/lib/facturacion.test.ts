import { describe, expect, it } from "vitest";
import {
  comprobanteDefectoEsValido,
  comprobantesPermitidos,
  emiteComprobanteFiscal,
  esComprobanteFiscal,
  formatearNumeroComprobante,
  formatearPuntoVenta,
  requiereNotaCredito,
  normalizarModoFacturacion,
  normalizarTipoComprobante,
  parsePuntoVenta,
} from "./facturacion";

describe("normalizarModoFacturacion", () => {
  it("acepta los tres modos conocidos", () => {
    expect(normalizarModoFacturacion("INTERNO")).toBe("INTERNO");
    expect(normalizarModoFacturacion("MANUAL")).toBe("MANUAL");
    expect(normalizarModoFacturacion("ARCA")).toBe("ARCA");
  });

  it("cae a INTERNO ante cualquier basura (fail-closed)", () => {
    // El caso real: la columna todavía no existía y la fila vuelve sin el
    // campo. Nunca debe interpretarse como 'emite factura'.
    expect(normalizarModoFacturacion(undefined)).toBe("INTERNO");
    expect(normalizarModoFacturacion(null)).toBe("INTERNO");
    expect(normalizarModoFacturacion("arca")).toBe("INTERNO");
    expect(normalizarModoFacturacion(42)).toBe("INTERNO");
  });
});

describe("normalizarTipoComprobante", () => {
  it("cae a TICKET ante lo desconocido", () => {
    expect(normalizarTipoComprobante("FACTURA_A")).toBe("FACTURA_A");
    expect(normalizarTipoComprobante("factura_a")).toBe("TICKET");
    expect(normalizarTipoComprobante(null)).toBe("TICKET");
  });
});

describe("emiteComprobanteFiscal", () => {
  it("solo ARCA emite fiscal; MANUAL no", () => {
    // MANUAL es el que se presta a confusión: el comercio SÍ factura, pero no
    // lo hace Comerz. Para el POS es tan no-fiscal como INTERNO.
    expect(emiteComprobanteFiscal("ARCA")).toBe(true);
    expect(emiteComprobanteFiscal("MANUAL")).toBe(false);
    expect(emiteComprobanteFiscal("INTERNO")).toBe(false);
  });
});

describe("comprobantesPermitidos", () => {
  it("sin ARCA solo hay ticket, sea cual sea la condición de IVA", () => {
    expect(comprobantesPermitidos("INTERNO", "Responsable Inscripto")).toEqual([
      "TICKET",
    ]);
    expect(comprobantesPermitidos("MANUAL", "Monotributo")).toEqual(["TICKET"]);
  });

  it("responsable inscripto emite A y B, nunca C", () => {
    const permitidos = comprobantesPermitidos("ARCA", "Responsable Inscripto");
    expect(permitidos).toContain("FACTURA_A");
    expect(permitidos).toContain("FACTURA_B");
    expect(permitidos).not.toContain("FACTURA_C");
  });

  it("monotributo y exento emiten C, nunca A ni B", () => {
    for (const condicion of ["Monotributo", "Exento"]) {
      const permitidos = comprobantesPermitidos("ARCA", condicion);
      expect(permitidos).toEqual(["TICKET", "FACTURA_C"]);
    }
  });

  it("sin condición de IVA cargada no ofrece ningún comprobante fiscal", () => {
    expect(comprobantesPermitidos("ARCA", null)).toEqual(["TICKET"]);
    expect(comprobantesPermitidos("ARCA", "Consumidor Final")).toEqual([
      "TICKET",
    ]);
  });
});

describe("comprobanteDefectoEsValido", () => {
  it("rechaza una factura cuando el modo no la puede emitir", () => {
    expect(
      comprobanteDefectoEsValido("INTERNO", "FACTURA_B", "Responsable Inscripto"),
    ).toBe(false);
  });

  it("rechaza una factura que no corresponde a la condición de IVA", () => {
    expect(comprobanteDefectoEsValido("ARCA", "FACTURA_A", "Monotributo")).toBe(
      false,
    );
    expect(
      comprobanteDefectoEsValido("ARCA", "FACTURA_C", "Responsable Inscripto"),
    ).toBe(false);
  });

  it("acepta la combinación coherente", () => {
    expect(comprobanteDefectoEsValido("ARCA", "FACTURA_C", "Monotributo")).toBe(
      true,
    );
    expect(comprobanteDefectoEsValido("INTERNO", "TICKET", null)).toBe(true);
  });
});

describe("parsePuntoVenta", () => {
  it("acepta el rango de ARCA", () => {
    expect(parsePuntoVenta("1")).toBe(1);
    expect(parsePuntoVenta("00003")).toBe(3);
    expect(parsePuntoVenta("99999")).toBe(99999);
  });

  it("vacío es 'sin configurar', no un error", () => {
    expect(parsePuntoVenta("")).toBeNull();
    expect(parsePuntoVenta("   ")).toBeNull();
    expect(parsePuntoVenta(null)).toBeNull();
  });

  it("rechaza fuera de rango y no numérico", () => {
    expect(parsePuntoVenta("0")).toBeNull();
    expect(parsePuntoVenta("100000")).toBeNull();
    expect(parsePuntoVenta("-1")).toBeNull();
    expect(parsePuntoVenta("1.5")).toBeNull();
    expect(parsePuntoVenta("PV 1")).toBeNull();
  });
});

describe("formatearNumeroComprobante", () => {
  it("usa el formato que se lee en cualquier factura", () => {
    expect(formatearNumeroComprobante(1, 123)).toBe("00001-00000123");
    expect(formatearNumeroComprobante(4, 1)).toBe("00004-00000001");
  });

  it("no recorta un punto de venta de 5 dígitos", () => {
    expect(formatearNumeroComprobante(99999, 7)).toBe("99999-00000007");
  });

  it("devuelve null si falta cualquiera de los dos", () => {
    // El llamador cae al identificador de la venta: son las ventas viejas,
    // anteriores a que existieran los comprobantes.
    expect(formatearNumeroComprobante(null, 1)).toBeNull();
    expect(formatearNumeroComprobante(1, null)).toBeNull();
    expect(formatearNumeroComprobante(undefined, undefined)).toBeNull();
  });
});

describe("esComprobanteFiscal", () => {
  it("el ticket interno no es fiscal; las facturas sí", () => {
    expect(esComprobanteFiscal("TICKET")).toBe(false);
    expect(esComprobanteFiscal("FACTURA_C")).toBe(true);
    expect(esComprobanteFiscal("NOTA_CREDITO_B")).toBe(true);
  });

  it("un tipo que todavía no existe cuenta como fiscal (fail-closed)", () => {
    // Si ARCA suma un tipo nuevo, tratarlo como fiscal frena de más, no de
    // menos: el error caro es dejar anular una factura sin nota de crédito.
    expect(esComprobanteFiscal("FACTURA_M")).toBe(true);
  });

  it("nada o vacío no es fiscal", () => {
    expect(esComprobanteFiscal(null)).toBe(false);
    expect(esComprobanteFiscal("")).toBe(false);
    expect(esComprobanteFiscal("  ")).toBe(false);
  });
});

describe("requiereNotaCredito", () => {
  it("con solo tickets internos no hace falta: es el caso de hoy", () => {
    expect(requiereNotaCredito([{ tipo: "TICKET" }])).toBe(false);
  });

  it("sin comprobantes tampoco (ventas anteriores a la tabla)", () => {
    expect(requiereNotaCredito([])).toBe(false);
    expect(requiereNotaCredito(null)).toBe(false);
    expect(requiereNotaCredito(undefined)).toBe(false);
  });

  it("con una factura emitida y sin compensar, sí", () => {
    expect(requiereNotaCredito([{ tipo: "FACTURA_B" }])).toBe(true);
    expect(requiereNotaCredito([{ tipo: "TICKET" }, { tipo: "FACTURA_A" }])).toBe(
      true,
    );
  });

  it("si la nota de crédito ya se emitió, no vuelve a pedirla", () => {
    expect(
      requiereNotaCredito([
        { tipo: "FACTURA_B" },
        { tipo: "NOTA_CREDITO_B" },
      ]),
    ).toBe(false);
  });
});

describe("formatearPuntoVenta", () => {
  it("usa los 5 dígitos con los que ARCA lo imprime", () => {
    expect(formatearPuntoVenta(1)).toBe("00001");
    expect(formatearPuntoVenta(99999)).toBe("99999");
  });

  it("sin punto de venta muestra un guión, no '00000'", () => {
    // '00000' parecería un punto de venta real y no existe.
    expect(formatearPuntoVenta(null)).toBe("—");
    expect(formatearPuntoVenta(undefined)).toBe("—");
  });
});
