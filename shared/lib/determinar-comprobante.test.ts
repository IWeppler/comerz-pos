import { describe, expect, it } from "vitest";
import {
  determinarComprobante,
  determinarComprobanteFiscal,
  RI_A_MONOTRIBUTO,
} from "./determinar-comprobante";

/**
 * `determinarComprobante` es la puerta de producción e incluye el corte por
 * conexión con ARCA (`arcaConectado`, que sale de las credenciales del
 * comercio). `determinarComprobanteFiscal` es la matriz sola, y es la que se
 * prueba en detalle.
 */

const RI = "Responsable Inscripto";

const ARCA = { modoFacturacion: "ARCA" as const };

describe("determinarComprobante (puerta de producción)", () => {
  it("sin conexión con ARCA TODO sale TICKET, aunque el modo diga ARCA", () => {
    for (const arcaConectado of [undefined, false]) {
      const r = determinarComprobante({
        ...ARCA,
        condicionIvaEmisor: RI,
        condicionIvaReceptor: RI,
        arcaConectado,
      });
      expect(r.tipo).toBe("TICKET");
      expect(r.motivo).toContain("ARCA");
      expect(r.requiereReceptorIdentificado).toBe(false);
    }
  });

  it("con conexión entra a la matriz", () => {
    const r = determinarComprobante({
      ...ARCA,
      condicionIvaEmisor: RI,
      condicionIvaReceptor: RI,
      arcaConectado: true,
    });
    expect(r.tipo).toBe("FACTURA_A");
  });
});

describe("modo de facturación", () => {
  it("interno y manual no emiten comprobante fiscal", () => {
    for (const modo of ["INTERNO", "MANUAL"]) {
      const r = determinarComprobanteFiscal({
        modoFacturacion: modo,
        condicionIvaEmisor: RI,
        condicionIvaReceptor: RI,
      });
      expect(r.tipo).toBe("TICKET");
    }
  });

  it("distingue el motivo de manual del de interno", () => {
    // El comercio en MANUAL sí factura, pero no lo hace Comerz. Que el motivo
    // lo diga evita el "¿por qué no me emitió la factura?".
    const manual = determinarComprobanteFiscal({
      modoFacturacion: "MANUAL",
      condicionIvaEmisor: RI,
      condicionIvaReceptor: null,
    });
    const interno = determinarComprobanteFiscal({
      modoFacturacion: "INTERNO",
      condicionIvaEmisor: RI,
      condicionIvaReceptor: null,
    });

    expect(manual.motivo).toContain("manual");
    expect(interno.motivo).not.toContain("manual");
  });

  it("un modo desconocido no factura (fail-closed)", () => {
    const r = determinarComprobanteFiscal({
      modoFacturacion: "loquesea",
      condicionIvaEmisor: RI,
      condicionIvaReceptor: RI,
    });
    expect(r.tipo).toBe("TICKET");
  });
});

describe("matriz emisor → receptor", () => {
  const casos: Array<[string, string | null, string]> = [
    [RI, RI, "FACTURA_A"],
    [RI, "Monotributo", RI_A_MONOTRIBUTO],
    [RI, "Exento", "FACTURA_B"],
    [RI, "Consumidor Final", "FACTURA_B"],
    [RI, null, "FACTURA_B"],
    ["Monotributo", RI, "FACTURA_C"],
    ["Monotributo", "Monotributo", "FACTURA_C"],
    ["Monotributo", "Consumidor Final", "FACTURA_C"],
    ["Monotributo", null, "FACTURA_C"],
    ["Exento", RI, "FACTURA_C"],
    ["Exento", "Consumidor Final", "FACTURA_C"],
    ["Exento", null, "FACTURA_C"],
  ];

  it.each(casos)(
    "emisor %s + receptor %s → %s",
    (emisor, receptor, esperado) => {
      const r = determinarComprobanteFiscal({
        ...ARCA,
        condicionIvaEmisor: emisor,
        condicionIvaReceptor: receptor,
      });
      expect(r.tipo).toBe(esperado);
    },
  );

  it("un monotributista NUNCA emite A ni B", () => {
    for (const receptor of [RI, "Monotributo", "Exento", "Consumidor Final", null]) {
      const r = determinarComprobanteFiscal({
        ...ARCA,
        condicionIvaEmisor: "Monotributo",
        condicionIvaReceptor: receptor,
      });
      expect(r.tipo).toBe("FACTURA_C");
    }
  });

  it("solo un receptor responsable inscripto recibe A", () => {
    // Es el sentido de la A: respaldar crédito fiscal, que solo un RI computa.
    for (const receptor of ["Exento", "Consumidor Final", null]) {
      const r = determinarComprobanteFiscal({
        ...ARCA,
        condicionIvaEmisor: RI,
        condicionIvaReceptor: receptor,
      });
      expect(r.tipo).not.toBe("FACTURA_A");
    }
  });

  it("una condición de receptor basura se trata como sin datos, no revienta", () => {
    const r = determinarComprobanteFiscal({
      ...ARCA,
      condicionIvaEmisor: RI,
      condicionIvaReceptor: "Responsable  Inscripto",
    });
    expect(r.tipo).toBe("FACTURA_B");
    expect(r.motivo).toContain("sin datos");
  });
});

describe("emisor sin condición de IVA", () => {
  it("no inventa una letra y el motivo dice dónde cargarla", () => {
    for (const emisor of [null, undefined, "", "Consumidor Final"]) {
      const r = determinarComprobanteFiscal({
        ...ARCA,
        condicionIvaEmisor: emisor,
        condicionIvaReceptor: RI,
      });
      expect(r.tipo).toBe("TICKET");
    }

    const r = determinarComprobanteFiscal({
      ...ARCA,
      condicionIvaEmisor: null,
      condicionIvaReceptor: RI,
    });
    expect(r.motivo).toContain("Configuración");
  });
});

describe("comprobante por defecto", () => {
  it("es una preferencia, no una orden: la matriz manda", () => {
    // Un comercio con "Factura A" por defecto que le vende a consumidor final
    // NO puede emitir A. Si el default ganara, emitiría una A sin receptor
    // identificado y ARCA la rechazaría en el mostrador.
    const r = determinarComprobanteFiscal({
      ...ARCA,
      condicionIvaEmisor: RI,
      condicionIvaReceptor: "Consumidor Final",
      comprobanteDefecto: "FACTURA_A",
    });
    expect(r.tipo).toBe("FACTURA_B");
  });

  it("un default en TICKET no impide facturar cuando corresponde", () => {
    const r = determinarComprobanteFiscal({
      ...ARCA,
      condicionIvaEmisor: RI,
      condicionIvaReceptor: RI,
      comprobanteDefecto: "TICKET",
    });
    expect(r.tipo).toBe("FACTURA_A");
  });
});

describe("requiereReceptorIdentificado", () => {
  it("la A siempre lo exige: sin CUIT no hay crédito fiscal que respaldar", () => {
    const r = determinarComprobanteFiscal({
      ...ARCA,
      condicionIvaEmisor: RI,
      condicionIvaReceptor: RI,
    });
    expect(r.tipo).toBe("FACTURA_A");
    expect(r.requiereReceptorIdentificado).toBe(true);
  });

  it("la B a consumidor final no lo exige por sí sola", () => {
    // El umbral por monto lo fija ARCA y cambia con el tiempo: a propósito no
    // está hardcodeado acá.
    const r = determinarComprobanteFiscal({
      ...ARCA,
      condicionIvaEmisor: RI,
      condicionIvaReceptor: "Consumidor Final",
    });
    expect(r.requiereReceptorIdentificado).toBe(false);
  });
});

describe("devoluciones", () => {
  it("cada factura se compensa con la nota de crédito de SU letra", () => {
    const pares: Array<[string, string | null, string]> = [
      [RI, RI, "NOTA_CREDITO_A"],
      [RI, "Consumidor Final", "NOTA_CREDITO_B"],
      ["Monotributo", null, "NOTA_CREDITO_C"],
    ];

    for (const [emisor, receptor, esperado] of pares) {
      const r = determinarComprobanteFiscal({
        ...ARCA,
        condicionIvaEmisor: emisor,
        condicionIvaReceptor: receptor,
        operacion: "DEVOLUCION",
      });
      expect(r.tipo).toBe(esperado);
    }
  });

  it("la nota de crédito no vuelve a pedir identificar al receptor", () => {
    // Hereda los datos ya congelados del comprobante original.
    const r = determinarComprobanteFiscal({
      ...ARCA,
      condicionIvaEmisor: RI,
      condicionIvaReceptor: RI,
      operacion: "DEVOLUCION",
    });
    expect(r.tipo).toBe("NOTA_CREDITO_A");
    expect(r.requiereReceptorIdentificado).toBe(false);
  });

  it("una devolución sin facturación fiscal sigue siendo ticket", () => {
    const r = determinarComprobanteFiscal({
      modoFacturacion: "INTERNO",
      condicionIvaEmisor: RI,
      condicionIvaReceptor: RI,
      operacion: "DEVOLUCION",
    });
    expect(r.tipo).toBe("TICKET");
  });
});
