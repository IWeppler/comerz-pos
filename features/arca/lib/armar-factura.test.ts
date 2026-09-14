import { describe, expect, it } from "vitest";
import { armarFactura, ErrorFactura, type EntradaFactura } from "./armar-factura";

const base: EntradaFactura = {
  tipo: "FACTURA_B",
  puntoVenta: 3,
  numero: 17,
  emisorCondicionIva: "Responsable Inscripto",
  emisorCuit: "30712345678",
  renglones: [{ precioFinal: 12100, cantidad: 1, tratamientoIva: "GRAVADO_21" }],
  recargos: 0,
  total: 12100,
  receptor: null,
  fecha: new Date("2026-09-14T15:00:00-03:00"),
};

describe("armarFactura — responsable inscripto (A/B)", () => {
  it("discrimina el IVA de un precio con IVA incluido dividiendo, no restando", () => {
    const { solicitud, desglose } = armarFactura(base);
    // 12.100 / 1,21 = 10.000. Restar el 21% daría 9.559.
    expect(solicitud.impNeto).toBe(10000);
    expect(solicitud.impIva).toBe(2100);
    expect(solicitud.impTotal).toBe(12100);
    expect(solicitud.iva).toEqual([{ id: 5, baseImponible: 10000, importe: 2100 }]);
    expect(desglose.neto).toBe(10000);
    expect(desglose.ivaMonto).toBe(2100);
  });

  it("agrupa por alícuota y manda exento y no gravado en sus campos, no en el array", () => {
    const { solicitud } = armarFactura({
      ...base,
      renglones: [
        { precioFinal: 1210, cantidad: 2, tratamientoIva: "GRAVADO_21" },
        { precioFinal: 1105, cantidad: 1, tratamientoIva: "GRAVADO_105" },
        { precioFinal: 500, cantidad: 1, tratamientoIva: "EXENTO" },
        { precioFinal: 300, cantidad: 1, tratamientoIva: "NO_GRAVADO" },
      ],
      total: 2420 + 1105 + 500 + 300,
    });
    expect(solicitud.iva).toEqual([
      { id: 4, baseImponible: 1000, importe: 105 },
      { id: 5, baseImponible: 2000, importe: 420 },
    ]);
    expect(solicitud.impOpEx).toBe(500);
    expect(solicitud.impTotConc).toBe(300);
    expect(solicitud.impNeto).toBe(3000);
    expect(solicitud.impIva).toBe(525);
    expect(solicitud.impTotal).toBe(4325);
  });

  it("los recargos van gravados al 21%", () => {
    const { solicitud } = armarFactura({
      ...base,
      renglones: [{ precioFinal: 1000, cantidad: 1, tratamientoIva: "EXENTO" }],
      recargos: 121,
      total: 1121,
    });
    expect(solicitud.impOpEx).toBe(1000);
    expect(solicitud.iva).toEqual([{ id: 5, baseImponible: 100, importe: 21 }]);
    expect(solicitud.impTotal).toBe(1121);
  });

  it("la suma fiscal cierra al centavo contra el total cobrado", () => {
    // Precios que no dividen exacto por 1,21: el redondeo de cada alícuota
    // podría dejar la suma a un centavo del total.
    const renglones = [
      { precioFinal: 3333, cantidad: 3, tratamientoIva: "GRAVADO_21" },
      { precioFinal: 777.77, cantidad: 1, tratamientoIva: "GRAVADO_105" },
      { precioFinal: 99.99, cantidad: 7, tratamientoIva: "GRAVADO_27" },
    ];
    const total = Math.round((9999 + 777.77 + 699.93) * 100) / 100;
    const { solicitud } = armarFactura({ ...base, renglones, total });
    const suma =
      solicitud.impTotConc +
      solicitud.impNeto +
      solicitud.impOpEx +
      solicitud.impIva;
    expect(Math.round(suma * 100) / 100).toBe(total);
    expect(solicitud.impTotal).toBe(total);
    // Y el IVA total es la suma del array.
    expect(
      Math.round(solicitud.iva.reduce((a, b) => a + b.importe, 0) * 100) / 100,
    ).toBe(solicitud.impIva);
  });

  it("falla si el total no es lo que suman los renglones (no inventa un número)", () => {
    expect(() => armarFactura({ ...base, total: 12000 })).toThrowError(
      ErrorFactura,
    );
    try {
      armarFactura({ ...base, total: 12000 });
    } catch (e) {
      expect((e as ErrorFactura).codigo).toBe("TOTAL_NO_CIERRA");
    }
  });
});

describe("armarFactura — monotributo (C)", () => {
  it("no discrimina: todo neto, IVA cero, sin array", () => {
    const { solicitud, desglose } = armarFactura({
      ...base,
      tipo: "FACTURA_C",
      emisorCondicionIva: "Monotributo",
      renglones: [
        { precioFinal: 1210, cantidad: 2, tratamientoIva: "GRAVADO_21" },
        { precioFinal: 500, cantidad: 1, tratamientoIva: "EXENTO" },
      ],
      total: 2920,
    });
    expect(solicitud.cbteTipo).toBe(11);
    expect(solicitud.impNeto).toBe(2920);
    expect(solicitud.impIva).toBe(0);
    expect(solicitud.impOpEx).toBe(0);
    expect(solicitud.iva).toEqual([]);
    expect(desglose.neto).toBe(2920);
  });
});

describe("armarFactura — receptor", () => {
  it("consumidor final sin datos: DocTipo 99, DocNro 0, condición 5", () => {
    const { solicitud } = armarFactura(base);
    expect(solicitud.docTipo).toBe(99);
    expect(solicitud.docNro).toBe("0");
    expect(solicitud.condicionIvaReceptorId).toBe(5);
  });

  it("con CUIT manda 80 y normaliza los guiones", () => {
    const { solicitud } = armarFactura({
      ...base,
      tipo: "FACTURA_A",
      receptor: {
        cuit: "30-71234567-8",
        dni: null,
        condicionIva: "Responsable Inscripto",
        razonSocial: "Cliente SA",
      },
    });
    expect(solicitud.cbteTipo).toBe(1);
    expect(solicitud.docTipo).toBe(80);
    expect(solicitud.docNro).toBe("30712345678");
    expect(solicitud.condicionIvaReceptorId).toBe(1);
  });

  it("con DNI y sin CUIT manda 96", () => {
    const { solicitud } = armarFactura({
      ...base,
      receptor: { cuit: null, dni: "35.123.456", condicionIva: null, razonSocial: "Ana" },
    });
    expect(solicitud.docTipo).toBe(96);
    expect(solicitud.docNro).toBe("35123456");
  });

  it("Factura A sin CUIT del receptor se rechaza antes de ir a ARCA", () => {
    expect(() =>
      armarFactura({
        ...base,
        tipo: "FACTURA_A",
        receptor: { cuit: null, dni: "35123456", condicionIva: "Responsable Inscripto", razonSocial: null },
      }),
    ).toThrowError(/CUIT/);
  });

  it("consumidor final sin identificar por encima del tope se rechaza", () => {
    expect(() =>
      armarFactura({
        ...base,
        renglones: [{ precioFinal: 12_000_000, cantidad: 1, tratamientoIva: "GRAVADO_21" }],
        total: 12_000_000,
      }),
    ).toThrowError(/identificar/);
  });
});

describe("armarFactura — nota de crédito", () => {
  it("lleva el comprobante asociado con la fecha sin guiones", () => {
    const { solicitud } = armarFactura({
      ...base,
      tipo: "NOTA_CREDITO_B",
      comprobantesAsociados: [
        { tipo: "FACTURA_B", puntoVenta: 3, numero: 12, fecha: "2026-09-01" },
      ],
    });
    expect(solicitud.cbteTipo).toBe(8);
    expect(solicitud.comprobantesAsociados).toEqual([
      { tipo: 6, puntoVenta: 3, numero: 12, fecha: "20260901" },
    ]);
  });
});

describe("armarFactura — fecha", () => {
  it("CbteFch va en yyyymmdd hora Argentina", () => {
    // 23:30 del 14/9 en UTC es 20:30 del 14/9 en Buenos Aires.
    const { solicitud } = armarFactura({
      ...base,
      fecha: new Date("2026-09-14T23:30:00Z"),
    });
    expect(solicitud.fecha).toBe("20260914");
    // 01:30 UTC del 15/9 sigue siendo 14/9 en Buenos Aires.
    expect(
      armarFactura({ ...base, fecha: new Date("2026-09-15T01:30:00Z") }).solicitud
        .fecha,
    ).toBe("20260914");
  });
});

describe("armarFactura — desglose fijo (nota de crédito)", () => {
  it("copia los importes de la factura original sin recalcular", () => {
    const { solicitud } = armarFactura({
      ...base,
      tipo: "NOTA_CREDITO_B",
      renglones: [],
      total: 4325,
      comprobantesAsociados: [
        { tipo: "FACTURA_B", puntoVenta: 3, numero: 12, fecha: "2026-09-01" },
      ],
      desgloseFijo: {
        neto: 3000,
        ivaMonto: 525,
        exento: 500,
        noGravado: 300,
        total: 4325,
        iva: [
          { id: 4, baseImponible: 1000, importe: 105 },
          { id: 5, baseImponible: 2000, importe: 420 },
        ],
      },
    });
    expect(solicitud.impNeto).toBe(3000);
    expect(solicitud.impIva).toBe(525);
    expect(solicitud.impOpEx).toBe(500);
    expect(solicitud.impTotConc).toBe(300);
    expect(solicitud.iva).toHaveLength(2);
    expect(solicitud.comprobantesAsociados[0].tipo).toBe(6);
  });

  it("un desglose que no suma el total se rechaza", () => {
    expect(() =>
      armarFactura({
        ...base,
        tipo: "NOTA_CREDITO_C",
        renglones: [],
        total: 100,
        desgloseFijo: { neto: 90, ivaMonto: 0, exento: 0, noGravado: 0, total: 100, iva: [] },
      }),
    ).toThrowError(/no coincide/);
  });
});
