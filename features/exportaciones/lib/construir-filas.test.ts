import { describe, expect, it } from "vitest";
import {
  filasComprobantes,
  filasLibroIvaVentas,
  filasMovimientosCaja,
  filasMovimientosGenerales,
  filasVentas,
  formatearFechaHoraExport,
  num,
} from "./construir-filas";

describe("formatearFechaHoraExport", () => {
  it("usa un formato que Excel no puede interpretar al revés", () => {
    // 03/04 es marzo o abril según la configuración regional de quien abre el
    // archivo. Con ISO no hay ambigüedad posible.
    const r = formatearFechaHoraExport("2026-04-03T15:30:00");
    expect(r).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(r.startsWith("2026-04-03")).toBe(true);
  });

  it("una fecha inválida da vacío, no 'Invalid Date'", () => {
    expect(formatearFechaHoraExport("cualquier cosa")).toBe("");
    expect(formatearFechaHoraExport(null)).toBe("");
    expect(formatearFechaHoraExport(undefined)).toBe("");
  });
});

describe("num", () => {
  it("nunca devuelve NaN: un NaN rompe la suma de la planilla entera", () => {
    expect(num(null)).toBe(0);
    expect(num(undefined)).toBe(0);
    expect(num("")).toBe(0);
    expect(num("no es un número")).toBe(0);
    expect(num("1234.56")).toBe(1234.56);
  });
});

describe("filasVentas", () => {
  const venta = {
    id: "v-1",
    fecha_venta: "2026-08-08T10:00:00",
    estado_operacion: "CONFIRMADA",
    estado_pago: "PAGADA",
    metodo_pago: "TARJETA",
    total: 12100,
    recargo_metodo_total: 2100,
    precio_costo: 5000,
    comision_total: 363,
    total_neto: 11737,
    monto_cobrado: 12100,
    monto_pendiente: 0,
    cantidad: 2,
    clientes: { nombre: "Juan Pérez" },
    perfiles: { nombre: "Mara" },
    comprobantes: [{ tipo: "TICKET", punto_venta: 1, numero: 42 }],
  };

  it("separa la venta de mercadería del recargo por medio de pago", () => {
    // El recargo no es venta: si se sumara como tal, el contador vería
    // facturación de más y un margen inflado.
    const [f] = filasVentas([venta]);
    expect(f["Total cobrado"]).toBe(12100);
    expect(f["Recargo por medio de pago"]).toBe(2100);
    expect(f["Venta de mercadería"]).toBe(10000);
  });

  it("los importes van como número, no como texto con $", () => {
    const [f] = filasVentas([venta]);
    for (const col of [
      "Total cobrado",
      "Venta de mercadería",
      "Costo de la mercadería",
      "Neto acreditado",
    ]) {
      expect(typeof f[col]).toBe("number");
    }
  });

  it("imprime el número de comprobante con su formato", () => {
    const [f] = filasVentas([venta]);
    expect(f.Comprobante).toBe("0001-00000042");
    expect(f["Tipo comprobante"]).toBe("TICKET");
  });

  it("una venta sin comprobante no rompe: deja las columnas vacías", () => {
    // Son las ventas anteriores a que existiera la tabla.
    const [f] = filasVentas([{ ...venta, comprobantes: null }]);
    expect(f.Comprobante).toBe("");
    expect(f["Tipo comprobante"]).toBe("");
  });

  it("sin cliente dice consumidor final, no vacío", () => {
    const [f] = filasVentas([{ ...venta, clientes: null }]);
    expect(f.Cliente).toBe("Consumidor final");
  });

  it("la lista de precios va vacía cuando se vendió al precio base", () => {
    // Y NO "Minorista": no existe ninguna lista con ese nombre. Ponerle
    // nombre a la ausencia haría que las 1.072 ventas anteriores a la
    // feature parecieran clasificadas cuando nadie las clasificó.
    const [f] = filasVentas([venta]);
    expect(f["Lista de precios"]).toBe("");
  });

  it("y con el NOMBRE congelado en la venta cuando se usó una lista", () => {
    const [f] = filasVentas([
      { ...venta, lista_precio_nombre: "Mayorista" },
    ]);
    expect(f["Lista de precios"]).toBe("Mayorista");
  });

  it("una venta ANULADA aparece y se ve que lo está", () => {
    // Sacarla dejaría huecos sin explicación en la numeración.
    const [f] = filasVentas([{ ...venta, estado_operacion: "ANULADA" }]);
    expect(f.Estado).toBe("ANULADA");
  });
});

describe("filasComprobantes", () => {
  it("exporta el CAE vacío cuando no hay: un ticket interno no lo tiene", () => {
    const [f] = filasComprobantes([
      {
        tipo: "TICKET",
        punto_venta: 1,
        numero: 7,
        emitido_en: "2026-08-08T12:00:00",
        total: 5000,
        neto: 0,
        iva_monto: 0,
        cae: null,
        cae_vencimiento: null,
        receptor_razon_social: null,
        receptor_cuit: null,
        receptor_condicion_iva: null,
        venta_id: "v-1",
      },
    ]);

    expect(f.CAE).toBe("");
    expect(f["Vencimiento CAE"]).toBe("");
    expect(f.Número).toBe("0001-00000007");
    expect(f.Receptor).toBe("Consumidor final");
    expect(f.Total).toBe(5000);
  });
});

describe("filasMovimientosCaja", () => {
  it("exporta el arqueo con su diferencia", () => {
    const [f] = filasMovimientosCaja([
      {
        id: "t-1",
        fecha_apertura: "2026-08-08T09:00:00",
        fecha_cierre: "2026-08-08T21:00:00",
        estado: "CERRADO",
        modo: "POR_USUARIO",
        monto_inicial: 10000,
        efectivo_esperado: 55000,
        monto_declarado: 54800,
        diferencia: -200,
        observacion_cierre: "Faltante chico",
        perfiles: { nombre: "Brisa" },
      },
    ]);

    expect(f.Responsable).toBe("Brisa");
    expect(f["Efectivo esperado"]).toBe(55000);
    expect(f.Diferencia).toBe(-200);
  });
});

describe("filasMovimientosGenerales", () => {
  const pago = {
    creado_en: "2026-08-08T11:00:00",
    metodo_nombre: "Efectivo",
    metodo_tipo: "EFECTIVO",
    monto_base: 10000,
    recargo_monto: 0,
    monto_bruto: 10000,
    comision_monto: 0,
    monto_neto: 10000,
    tipo_movimiento: "PAGO_VENTA",
    estado_pago_operacion: "CONFIRMADO",
    venta_id: "v-1",
  };

  const egreso = {
    fecha: "2026-08-08T10:00:00",
    concepto: "Flete",
    monto: 3000,
    tipo: "OPERATIVO",
  };

  it("el egreso va negativo para que la columna sume el neto sola", () => {
    const filas = filasMovimientosGenerales([pago], [egreso]);
    const salida = filas.find((f) => f.Movimiento === "EGRESO");
    expect(salida?.Importe).toBe(-3000);

    const total = filas.reduce((acc, f) => acc + Number(f.Importe ?? 0), 0);
    expect(total).toBe(7000);
  });

  it("un egreso ya negativo no se vuelve positivo", () => {
    const filas = filasMovimientosGenerales([], [{ ...egreso, monto: -3000 }]);
    expect(filas[0].Importe).toBe(-3000);
  });

  it("mezcla ingresos y egresos ordenados por fecha", () => {
    const filas = filasMovimientosGenerales([pago], [egreso]);
    expect(filas.map((f) => f.Movimiento)).toEqual(["EGRESO", "INGRESO"]);
  });

  it("distingue el cobro de cuenta corriente del cobro de venta", () => {
    const filas = filasMovimientosGenerales(
      [{ ...pago, tipo_movimiento: "PAGO_CUENTA_CORRIENTE" }],
      [],
    );
    expect(filas[0].Concepto).toBe("Cobro de cuenta corriente");
  });
});

describe("filasVentas con devolución parcial", () => {
  const ventaDevuelta = {
    id: "v-2",
    fecha_venta: "2026-09-03T10:00:00",
    estado_operacion: "CONFIRMADA",
    estado_pago: "PAGADA",
    metodo_pago: "EFECTIVO",
    total: 10000,
    recargo_metodo_total: 0,
    precio_costo: 5000,
    comision_total: 0,
    total_neto: 10000,
    monto_cobrado: 10000,
    monto_pendiente: 0,
    monto_devuelto: 4000,
    base_devuelta: 4000,
    ventas_items: [
      { precio_costo: 2000, cantidad_devuelta: 1 },
      { precio_costo: 3000, cantidad_devuelta: 0 },
    ],
    cantidad: 2,
    clientes: null,
    perfiles: { nombre: "Mara" },
    comprobantes: [{ tipo: "TICKET", punto_venta: 1, numero: 99 }],
  };

  it("NO netea la columna que el contador concilia contra el papel", () => {
    // El comprobante que la clienta se llevó dice $10.000. Si "Total cobrado"
    // dijera $6.000, la planilla no cierra contra el ticket.
    const [f] = filasVentas([ventaDevuelta]);
    expect(f["Total cobrado"]).toBe(10000);
    expect(f["Venta de mercadería"]).toBe(10000);
  });

  it("agrega lo devuelto y el neto en columnas propias", () => {
    const [f] = filasVentas([ventaDevuelta]);
    expect(f["Devuelto"]).toBe(4000);
    expect(f["Mercadería devuelta"]).toBe(4000);
    expect(f["Venta neta de devoluciones"]).toBe(6000);
  });

  it("netea también el costo, o el margen de la planilla queda mal", () => {
    // Sin esto el contador restaría $5.000 de costo a $6.000 de venta neta.
    const [f] = filasVentas([ventaDevuelta]);
    expect(f["Costo de lo devuelto"]).toBe(2000);
    expect(f["Costo neto de devoluciones"]).toBe(3000);
  });

  it("una venta sin devolución muestra ceros, no vacíos", () => {
    // Celdas vacías rompen las sumas de una columna en Excel.
    const [f] = filasVentas([
      { ...ventaDevuelta, monto_devuelto: null, base_devuelta: null, ventas_items: [] },
    ]);
    expect(f["Devuelto"]).toBe(0);
    expect(f["Costo de lo devuelto"]).toBe(0);
    expect(f["Venta neta de devoluciones"]).toBe(10000);
    expect(f["Costo neto de devoluciones"]).toBe(5000);
  });
});

describe("filasLibroIvaVentas", () => {
  const factura = {
    id: "f1",
    tipo: "FACTURA_A",
    punto_venta: 1,
    numero: 7,
    fecha_comprobante: "2026-09-14",
    total: 4325,
    neto: 3000,
    iva_monto: 525,
    exento: 500,
    no_gravado: 300,
    cae: "123",
    receptor_razon_social: "Cliente SA",
    receptor_doc_tipo: 80,
    receptor_doc_nro: "30712345678",
    receptor_condicion_iva: "Responsable Inscripto",
    arca_ambiente: "PRODUCCION",
    comprobantes_iva: [
      { alicuota_id: 5, base_imponible: 2000, importe: 420 },
      { alicuota_id: 4, base_imponible: 1000, importe: 105 },
    ],
  };

  it("abre el IVA por alícuota y respeta exento / no gravado", () => {
    const [fila] = filasLibroIvaVentas([factura]);
    expect(fila["Neto gravado 21%"]).toBe(2000);
    expect(fila["IVA 21%"]).toBe(420);
    expect(fila["Neto gravado 10,5%"]).toBe(1000);
    expect(fila["IVA 10,5%"]).toBe(105);
    expect(fila["Neto gravado 27%"]).toBe(0);
    expect(fila.Exento).toBe(500);
    expect(fila["No gravado"]).toBe(300);
    expect(fila.Total).toBe(4325);
    expect(fila["Código ARCA"]).toBe("001");
    expect(fila["Tipo doc."]).toBe("CUIT");
    expect(fila.Fecha).toBe("2026-09-14");
  });

  it("las notas de crédito van en negativo", () => {
    const [fila] = filasLibroIvaVentas([
      { ...factura, id: "n1", tipo: "NOTA_CREDITO_A", anula_comprobante_id: "f1" },
    ]);
    expect(fila.Total).toBe(-4325);
    expect(fila["IVA 21%"]).toBe(-420);
    expect(fila["Anula a"]).toBe("f1");
  });

  it("homologación y filas sin CAE quedan afuera del libro", () => {
    expect(
      filasLibroIvaVentas([
        { ...factura, arca_ambiente: "HOMOLOGACION" },
        { ...factura, cae: null },
      ]),
    ).toHaveLength(0);
  });

  it("consumidor final sin documento no inventa un número", () => {
    const [fila] = filasLibroIvaVentas([
      { ...factura, receptor_razon_social: null, receptor_doc_tipo: 99, receptor_doc_nro: "0", receptor_condicion_iva: null },
    ]);
    expect(fila.Receptor).toBe("Consumidor final");
    expect(fila["Nro. doc."]).toBe("");
    expect(fila["Condición IVA"]).toBe("Consumidor Final");
  });
});
