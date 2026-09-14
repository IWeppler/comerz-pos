import { describe, expect, it } from "vitest";
import {
  codigoArcaComprobante,
  discriminaIvaEnPapel,
  fechaCorta,
  numeroComprobanteFiscal,
  receptorTexto,
  tituloComprobante,
  urlQrArca,
  type ComprobanteFiscalTicket,
} from "./comprobante-fiscal-ticket";

const base: ComprobanteFiscalTicket = {
  tipo: "FACTURA_C",
  puntoVenta: 1,
  numero: 12,
  cae: "76432189017421",
  caeVencimiento: "2026-09-24",
  fechaComprobante: "2026-09-14",
  neto: 12100,
  ivaMonto: 0,
  exento: 0,
  noGravado: 0,
  total: 12100,
  iva: [],
  receptor: { razonSocial: null, docTipo: 99, docNro: "0", condicionIva: null },
  ambiente: "HOMOLOGACION",
};

describe("comprobante fiscal en el ticket", () => {
  it("título, código y número como los imprime cualquier factura", () => {
    expect(tituloComprobante("FACTURA_C")).toBe("FACTURA C");
    expect(tituloComprobante("NOTA_CREDITO_B")).toBe("NOTA DE CRÉDITO B");
    expect(codigoArcaComprobante("FACTURA_B")).toBe("006");
    expect(codigoArcaComprobante("FACTURA_A")).toBe("001");
    expect(numeroComprobanteFiscal(base)).toBe("0001-00000012");
  });

  it("solo la A discrimina IVA en el papel", () => {
    expect(discriminaIvaEnPapel("FACTURA_A")).toBe(true);
    expect(discriminaIvaEnPapel("FACTURA_B")).toBe(false);
    expect(discriminaIvaEnPapel("FACTURA_C")).toBe(false);
  });

  it("la fecha no pasa por Date: no puede correrse un día por zona horaria", () => {
    expect(fechaCorta("2026-09-14")).toBe("14/09/2026");
  });

  it("receptor: consumidor final sin documento, o nombre + documento", () => {
    expect(receptorTexto(base)).toBe("Consumidor Final");
    expect(
      receptorTexto({
        ...base,
        receptor: { razonSocial: "Ana", docTipo: 96, docNro: "35123456", condicionIva: null },
      }),
    ).toBe("Ana — DNI 35123456");
  });

  it("QR RG 4892: JSON en base64 con los campos del anexo", () => {
    const url = urlQrArca(base, "20-42200159-0");
    expect(url.startsWith("https://www.afip.gob.ar/fe/qr/?p=")).toBe(true);
    const json = JSON.parse(atob(url.split("?p=")[1]));
    expect(json).toEqual({
      ver: 1,
      fecha: "2026-09-14",
      cuit: 20422001590,
      ptoVta: 1,
      tipoCmp: 11,
      nroCmp: 12,
      importe: 12100,
      moneda: "PES",
      ctz: 1,
      tipoCodAut: "E",
      codAut: 76432189017421,
    });
  });

  it("QR con receptor identificado lleva tipo y número de documento", () => {
    const url = urlQrArca(
      {
        ...base,
        tipo: "FACTURA_A",
        receptor: { razonSocial: "X SA", docTipo: 80, docNro: "30712345678", condicionIva: "RI" },
      },
      "20422001590",
    );
    const json = JSON.parse(atob(url.split("?p=")[1]));
    expect(json.tipoCmp).toBe(1);
    expect(json.tipoDocRec).toBe(80);
    expect(json.nroDocRec).toBe(30712345678);
  });
});
