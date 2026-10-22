import { describe, it, expect } from "vitest";
import {
  getAdvisorInsights,
  recargoParaEmpatar,
  LIMITE_RECOMENDACIONES,
  type AdvisorMetrics,
} from "./get-advisor-insights";

function baseMetrics(overrides: Partial<AdvisorMetrics> = {}): AdvisorMetrics {
  return {
    ingresos: 100000,
    ordenes: 20,
    unidadesVendidas: 50,
    gananciaBrutaVentas: 40000,
    gananciaNeta: 20000,
    totalEgresos: 1000,
    costoPerdidoBajas: 0,
    unidadesBajas: 0,
    margenPorcentaje: 20,
    ticketPromedio: 5000,
    stockValorizadoCosto: 10000,
    stockTotalUnidades: 100,
    productosCriticos: 0,
    productosSinMovimiento: [],
    topProductos: [],
    topProductosRentables: [],
    ventasPorDia: [],
    ventasPorCategoria: [],
    ...overrides,
  };
}

describe("getAdvisorInsights — guardia de confianza", () => {
  it("con menos de 3 órdenes, solo devuelve el insight de onboarding", () => {
    const r = getAdvisorInsights(baseMetrics({ ordenes: 2 }));
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe("onboarding");
  });
});

describe("getAdvisorInsights — deuda vencida (nueva regla)", () => {
  it("sin deudaVencida en el input, no agrega ningún insight de deuda", () => {
    const r = getAdvisorInsights(baseMetrics());
    expect(r.some((i) => i.id === "deuda_vencida")).toBe(false);
  });

  it("con deudaVencida.monto en 0, no agrega insight (guard > 0)", () => {
    const r = getAdvisorInsights(
      baseMetrics({ deudaVencida: { monto: 0, clientes: 0 } }),
    );
    expect(r.some((i) => i.id === "deuda_vencida")).toBe(false);
  });

  it("deuda vencida moderada (< 50% ingresos y < $50k) es warning", () => {
    const r = getAdvisorInsights(
      baseMetrics({ deudaVencida: { monto: 10000, clientes: 2 } }),
    );
    const insight = r.find((i) => i.id === "deuda_vencida");
    expect(insight?.type).toBe("warning");
    // La prioridad ya no es un escalón fijo: escala con la plata en juego,
    // arrancando en 72. Ver "prioridad por magnitud" más abajo.
    expect(insight?.priority).toBeGreaterThanOrEqual(72);
    expect(insight?.priority).toBeLessThan(92);
    expect(insight?.href).toBe("/clientes");
  });

  it("deuda vencida > 50% de los ingresos del período es danger", () => {
    const r = getAdvisorInsights(
      baseMetrics({ deudaVencida: { monto: 60000, clientes: 3 } }),
    );
    const insight = r.find((i) => i.id === "deuda_vencida");
    expect(insight?.type).toBe("danger");
    expect(insight?.priority).toBe(92);
  });

  it("deuda vencida > $50k absolutos es danger aunque sea < 50% de ingresos altos", () => {
    const r = getAdvisorInsights(
      baseMetrics({ ingresos: 500000, deudaVencida: { monto: 55000, clientes: 3 } }),
    );
    const insight = r.find((i) => i.id === "deuda_vencida");
    expect(insight?.type).toBe("danger");
  });

  it("con ingresos=0 y deuda>0, se considera 100% proporcional -> danger", () => {
    const r = getAdvisorInsights(
      baseMetrics({ ingresos: 0, deudaVencida: { monto: 1000, clientes: 1 } }),
    );
    const insight = r.find((i) => i.id === "deuda_vencida");
    expect(insight?.type).toBe("danger");
  });

  it("el mensaje pluraliza 'cliente' correctamente", () => {
    const uno = getAdvisorInsights(
      baseMetrics({ deudaVencida: { monto: 5000, clientes: 1 } }),
    ).find((i) => i.id === "deuda_vencida");
    const varios = getAdvisorInsights(
      baseMetrics({ deudaVencida: { monto: 5000, clientes: 3 } }),
    ).find((i) => i.id === "deuda_vencida");
    expect(uno?.message).toContain("1 cliente");
    expect(uno?.message).not.toContain("1 clientes");
    expect(varios?.message).toContain("3 clientes");
  });
});

describe("getAdvisorInsights — remitos pendientes (nueva regla)", () => {
  it("sin remitosPendientes en el input, no agrega insight", () => {
    const r = getAdvisorInsights(baseMetrics());
    expect(r.some((i) => i.id === "remitos_pendientes")).toBe(false);
  });

  it("con cantidad 0, no agrega insight", () => {
    const r = getAdvisorInsights(
      baseMetrics({
        remitosPendientes: { cantidad: 0, diasMasAntiguo: 0, idMasAntiguo: "" },
      }),
    );
    expect(r.some((i) => i.id === "remitos_pendientes")).toBe(false);
  });

  it("con remitos pendientes, agrega warning de prioridad media que lleva a Compras", () => {
    const r = getAdvisorInsights(
      baseMetrics({
        remitosPendientes: { cantidad: 2, diasMasAntiguo: 5, idMasAntiguo: "orden-123" },
      }),
    );
    const insight = r.find((i) => i.id === "remitos_pendientes");
    expect(insight?.type).toBe("warning");
    expect(insight?.priority).toBe(58);
    expect(insight?.href).toBe("/compras/merge/orden-123");
    expect(insight?.message).toContain("2 remitos");
    expect(insight?.message).toContain("5 días");
  });

  it("singular correcto con 1 remito y 1 día", () => {
    const insight = getAdvisorInsights(
      baseMetrics({
        remitosPendientes: { cantidad: 1, diasMasAntiguo: 1, idMasAntiguo: "o1" },
      }),
    ).find((i) => i.id === "remitos_pendientes");
    expect(insight?.message).toContain("1 remito ");
    expect(insight?.message).toContain("1 día.");
  });
});

describe("getAdvisorInsights — remitos a pagar", () => {
  it("sin deuda con proveedores, no agrega insight", () => {
    const r = getAdvisorInsights(
      baseMetrics({ remitosAPagar: { cantidad: 0, total: 0 } }),
    );
    expect(r.some((i) => i.id === "remitos_a_pagar")).toBe(false);
  });

  it("con deuda, dice cuánto y por cuántos remitos, y lleva a Compras", () => {
    const insight = getAdvisorInsights(
      baseMetrics({ remitosAPagar: { cantidad: 3, total: 450000 } }),
    ).find((i) => i.id === "remitos_a_pagar");
    expect(insight?.href).toBe("/caja");
    expect(insight?.impacto).toBe(450000);
    expect(insight?.message).toContain("3 remitos");
    expect(insight?.message).toMatch(/450\.000/);
  });
});

describe("getAdvisorInsights — integración con el corte a top-3 existente", () => {
  it("las reglas nuevas compiten por prioridad junto a las originales, top-3 final", () => {
    const r = getAdvisorInsights(
      baseMetrics({
        margenPorcentaje: -5, // priority 100
        productosCriticos: 2, // priority 85
        deudaVencida: { monto: 60000, clientes: 2 }, // priority 92 (danger, >50k)
        remitosPendientes: { cantidad: 1, diasMasAntiguo: 10, idMasAntiguo: "o1" }, // priority 58
      }),
      3,
    );
    expect(r).toHaveLength(3);
    expect(r.map((i) => i.id)).toEqual([
      "margin_negative",
      "deuda_vencida",
      "stock_critical",
    ]);
  });

  it("no rompe la regla de felicitaciones: deuda vencida cuenta como warning/danger y tapa el confeti", () => {
    const r = getAdvisorInsights(
      baseMetrics({
        margenPorcentaje: 40, // dispararía good_margin si no hubiera warnings
        deudaVencida: { monto: 10000, clientes: 1 }, // warning
      }),
    );
    expect(r.some((i) => i.id === "good_margin")).toBe(false);
  });
});

describe("getAdvisorInsights — inventario estancado (conteo corregido)", () => {
  // `productosSinMovimiento` trae TODOS los productos con stock; el filtro por
  // días es de quien consume. La regla leía `.length` sin filtrar.
  const catalogo = [
    ...Array.from({ length: 279 }, () => ({ diasSinVender: 2 })),
    ...Array.from({ length: 764 }, () => ({ diasSinVender: 45 })),
  ];

  it("cuenta solo los que no venden hace 30 días o más", () => {
    const r = getAdvisorInsights(
      baseMetrics({ productosSinMovimiento: catalogo }),
    );
    const insight = r.find((i) => i.id === "no_movement");
    // Los números reales de Evens: 1.043 con stock, 764 estancados.
    expect(catalogo).toHaveLength(1043);
    expect(insight?.message).toContain("764");
    expect(insight?.message).not.toContain("1043");
  });

  it("no dispara si hay stock pero todo vendió hace poco", () => {
    const r = getAdvisorInsights(
      baseMetrics({
        productosSinMovimiento: Array.from({ length: 500 }, () => ({
          diasSinVender: 3,
        })),
      }),
    );
    expect(r.some((i) => i.id === "no_movement")).toBe(false);
  });
});

describe("getAdvisorInsights — dependencia de catálogo (regla retirada)", () => {
  it("un producto con 90% de las unidades ya no genera recomendación", () => {
    const r = getAdvisorInsights(
      baseMetrics({
        unidadesVendidas: 100,
        topProductos: [{ nombre: "Campera Puffer", unidades: 90, ganancia: 0 }],
      }),
    );
    expect(r.find((i) => i.id === "high_dependency")).toBeUndefined();
  });
});

describe("getAdvisorInsights — capital inmovilizado (días de cobertura)", () => {
  // costoVendido = ingresos - gananciaBruta = 60.000; con 20 días son
  // 3.000/día, así que la cobertura es stockValorizadoCosto / 3.000.
  const conRitmo = { diasDelPeriodo: 20, stockValorizadoCosto: 600000 };

  it("dispara con más de 180 días de cobertura y dice cuántos son", () => {
    const r = getAdvisorInsights(baseMetrics(conRitmo));
    const insight = r.find((i) => i.id === "capital_stuck");
    expect(insight).toBeDefined();
    expect(insight?.message).toContain("200 días");
  });

  it("no dispara con cobertura normal (el caso Evens: ~104 días)", () => {
    const r = getAdvisorInsights(
      baseMetrics({ diasDelPeriodo: 20, stockValorizadoCosto: 312000 }),
    );
    expect(r.some((i) => i.id === "capital_stuck")).toBe(false);
  });

  it("sin diasDelPeriodo no dispara: no se puede estimar un ritmo", () => {
    const r = getAdvisorInsights(baseMetrics({ stockValorizadoCosto: 600000 }));
    expect(r.some((i) => i.id === "capital_stuck")).toBe(false);
  });

  it("con menos de 14 días de muestra tampoco: el ritmo sería ruido", () => {
    // Es el caso que rompía la regla vieja: 2 días de ventas contra el stock
    // entero disparaba siempre, con el selector en Semana.
    const r = getAdvisorInsights(
      baseMetrics({ diasDelPeriodo: 2, stockValorizadoCosto: 600000 }),
    );
    expect(r.some((i) => i.id === "capital_stuck")).toBe(false);
  });
});

describe("getAdvisorInsights — día pico", () => {
  const ventasPorDia = [
    { label: "Sábado", value: 40000 },
    { label: "Lunes", value: 5000 },
  ];

  it("no afirma un patrón semanal con un día de datos", () => {
    const r = getAdvisorInsights(
      baseMetrics({ diasDelPeriodo: 1, ventasPorDia }),
    );
    expect(r.some((i) => i.id === "best_day")).toBe(false);
  });

  it("con dos semanas dispara y no dice 'Históricamente'", () => {
    const r = getAdvisorInsights(
      baseMetrics({ diasDelPeriodo: 14, ventasPorDia }),
    );
    const insight = r.find((i) => i.id === "best_day");
    expect(insight?.title).toBe("Día Pico: Sábado");
    expect(insight?.message).not.toContain("Históricamente");
  });
});

describe("getAdvisorInsights — límite por superficie", () => {
  const muchasAlertas = baseMetrics({
    margenPorcentaje: -5,
    productosCriticos: 4,
    deudaVencida: { monto: 80000, clientes: 3 },
    remitosPendientes: { cantidad: 2, diasMasAntiguo: 5, idMasAntiguo: "x" },
    productosSinMovimiento: Array.from({ length: 20 }, () => ({
      diasSinVender: 60,
    })),
    categoriaEnRiesgo: {
      categoria: "Jeans",
      unidadesVendidas: 30,
      diasCobertura: 4,
    },
  });

  it("por defecto corta en 5, igual que el panel y /reportes", () => {
    expect(LIMITE_RECOMENDACIONES).toBe(5);
    expect(getAdvisorInsights(muchasAlertas)).toHaveLength(LIMITE_RECOMENDACIONES);
  });

  it("nunca devuelve dos recomendaciones de la misma familia", () => {
    // stock_critical y categoria_riesgo_stock son ambas "quiebre"
    const r = getAdvisorInsights(
      baseMetrics({
        ordenes: 50,
        productosCriticos: 2,
        categoriaEnRiesgo: { categoria: "Remeras", unidadesVendidas: 30, diasCobertura: 4 },
      }),
    );
    const quiebres = r.filter((i) => i.id === "stock_critical" || i.id === "categoria_riesgo_stock");
    expect(quiebres).toHaveLength(1);
  });

  it("el orden por prioridad se respeta al subir el límite", () => {
    const r = getAdvisorInsights(muchasAlertas, 5);
    const prioridades = r.map((i) => i.priority);
    expect([...prioridades].sort((a, b) => b - a)).toEqual(prioridades);
  });
});

describe("getAdvisorInsights — venta cruzada (reemplaza el upselling en pesos)", () => {
  it("dispara con mayoría clara de tickets de una unidad y muestra el % real", () => {
    // Evens a 30 días: 408 tickets, 55,6% de una sola unidad.
    const r = getAdvisorInsights(
      baseMetrics({ ordenes: 408, ticketsDeUnaUnidad: 227 }),
    );
    const insight = r.find((i) => i.id === "upselling");
    expect(insight).toBeDefined();
    expect(insight?.message).toContain("56%");
    // No promete plata: ese número no sale de esta señal.
    expect(insight?.message).not.toMatch(/\$/);
  });

  it("no dispara sin muestra, aunque la proporción observada sea alta", () => {
    // Los mismos ~55% pero sobre los 23 tickets de dos días: no se sostiene.
    const r = getAdvisorInsights(
      baseMetrics({ ordenes: 23, ticketsDeUnaUnidad: 13 }),
    );
    expect(r.some((i) => i.id === "upselling")).toBe(false);
  });

  it("no dispara si no son mayoría (el caso Estilo Bonito, 41,9%)", () => {
    const r = getAdvisorInsights(
      baseMetrics({ ordenes: 124, ticketsDeUnaUnidad: 52 }),
    );
    expect(r.some((i) => i.id === "upselling")).toBe(false);
  });

  it("sin el dato no dispara (fail-closed)", () => {
    const r = getAdvisorInsights(baseMetrics({ ordenes: 408 }));
    expect(r.some((i) => i.id === "upselling")).toBe(false);
  });

  it("ya no existe la regla vieja del ticket en pesos", () => {
    // Ticket bajísimo en pesos y muchas órdenes: la regla vieja disparaba acá.
    const r = getAdvisorInsights(
      baseMetrics({ ticketPromedio: 3000, ordenes: 50 }),
    );
    expect(r.some((i) => i.id === "upselling")).toBe(false);
  });
});

describe("getAdvisorInsights — sin felicitación falsa por bajas", () => {
  it("no felicita por 'inventario perfecto' aunque no haya bajas", () => {
    // Sin bajas y sin ninguna alerta: antes salía "Inventario Perfecto", que
    // era siempre verdadero porque la tabla `bajas` nunca se escribe.
    const r = getAdvisorInsights(
      baseMetrics({ costoPerdidoBajas: 0, unidadesBajas: 0 }),
    );
    expect(r.some((i) => i.id === "no_shrinkage")).toBe(false);
  });

  it("la felicitación por buen margen sigue viva", () => {
    const r = getAdvisorInsights(baseMetrics({ margenPorcentaje: 45 }));
    expect(r.some((i) => i.id === "good_margin")).toBe(true);
  });
});

describe("recargoParaEmpatar", () => {
  it("15% de comisión necesita 17,65% de recargo, no 15%", () => {
    // La comisión se cobra sobre el BRUTO y el recargo sobre la BASE: 15 y 15
    // sobre 100 dan bruto 115, comisión 17,25 y neto 97,75 (−2,25%).
    expect(recargoParaEmpatar(0.15) * 100).toBeCloseTo(17.65, 2);
  });

  it("verifica el empate por aritmética, no por la fórmula", () => {
    const base = 100;
    const r = recargoParaEmpatar(0.15);
    const bruto = base * (1 + r);
    const comision = bruto * 0.15;
    expect(r * base).toBeCloseTo(comision, 6);
  });

  it("fail-closed con valores imposibles", () => {
    expect(recargoParaEmpatar(0)).toBe(0);
    expect(recargoParaEmpatar(-0.1)).toBe(0);
    expect(recargoParaEmpatar(1)).toBe(0);
  });
});

describe("getAdvisorInsights — método de pago que pierde plata", () => {
  // Tarjeta Banco Nación de Evens: recargo 15% sobre una base de 100.000,
  // comisión 15% sobre el bruto de 115.000 → −2.250.
  const metodoQuePierde = {
    medio: "Tarjeta Banco Nación",
    neto: -2250,
    base: 100000,
    recargo: 15000,
    comision: 17250,
    operaciones: 12,
  };

  it("sin la señal no agrega ningún insight", () => {
    expect(
      getAdvisorInsights(baseMetrics()).some((i) => i.id === "metodo_pierde"),
    ).toBe(false);
  });

  it("nombra el medio, la plata perdida y el recargo que hace falta", () => {
    const r = getAdvisorInsights(baseMetrics({ metodoQuePierde }), 10);
    const insight = r.find((i) => i.id === "metodo_pierde");

    expect(insight?.title).toContain("Tarjeta Banco Nación");
    expect(insight?.message).toContain("17,6%"); // el recargo para empatar
    expect(insight?.message).toContain("12 cobros");
    expect(insight?.href).toBe("/configuracion");
  });

  it("compite por prioridad como una advertencia operativa", () => {
    const r = getAdvisorInsights(baseMetrics({ metodoQuePierde }), 10);
    expect(r.find((i) => i.id === "metodo_pierde")?.priority).toBe(78);
  });
});

describe("getAdvisorInsights — descuentos de mostrador", () => {
  // Evens, 30 días: $768.680 resignados, 47,63% de margen contra 50,31% a
  // precio de lista — 2,68 puntos.
  const descuentosResignados = {
    monto: 768680,
    margenPct: 47.63,
    margenPctAPrecioLleno: 50.31,
    unidades: 806,
  };

  it("sin la señal no agrega nada", () => {
    expect(
      getAdvisorInsights(baseMetrics()).some(
        (i) => i.id === "descuentos_mostrador",
      ),
    ).toBe(false);
  });

  it("informa la plata resignada y los PUNTOS de margen que costó", () => {
    const r = getAdvisorInsights(baseMetrics({ descuentosResignados }), 10);
    const insight = r.find((i) => i.id === "descuentos_mostrador");

    expect(insight?.message).toContain("2,7 puntos");
    expect(insight?.impacto).toBe(768680);
  });

  it("no dispara si el descuento no llega a un punto de margen", () => {
    const r = getAdvisorInsights(
      baseMetrics({
        descuentosResignados: {
          ...descuentosResignados,
          margenPctAPrecioLleno: 48.1, // medio punto
        },
      }),
      10,
    );
    expect(r.some((i) => i.id === "descuentos_mostrador")).toBe(false);
  });
});

describe("getAdvisorInsights — prioridad por magnitud", () => {
  it("la deuda vencida escala en vez de saltar de 72 a 92 por un peso", () => {
    const chica = getAdvisorInsights(
      baseMetrics({ deudaVencida: { monto: 12500, clientes: 1 } }),
      10,
    ).find((i) => i.id === "deuda_vencida");
    const grande = getAdvisorInsights(
      baseMetrics({ deudaVencida: { monto: 40000, clientes: 5 } }),
      10,
    ).find((i) => i.id === "deuda_vencida");

    expect(chica!.priority).toBeLessThan(grande!.priority);
    expect(grande!.priority).toBeLessThan(92);
  });

  it("en el umbral de siempre ($50k) llega a 92 y es danger", () => {
    const insight = getAdvisorInsights(
      baseMetrics({ deudaVencida: { monto: 50000, clientes: 5 } }),
      10,
    ).find((i) => i.id === "deuda_vencida");

    expect(insight!.priority).toBe(92);
    expect(insight!.type).toBe("danger");
  });

  it("entre dos insights de la misma urgencia, primero el de más plata", () => {
    const r = getAdvisorInsights(
      baseMetrics({
        // Los dos son priority 78 y 76; el desempate importa dentro de la banda.
        metodoQuePierde: {
          medio: "Tarjeta",
          neto: -2250,
          base: 100000,
          recargo: 15000,
          comision: 17250,
          operaciones: 12,
        },
        descuentosResignados: {
          monto: 768680,
          margenPct: 47.63,
          margenPctAPrecioLleno: 50.31,
          unidades: 806,
        },
      }),
      10,
    );

    const ids = r.map((i) => i.id);
    // La prioridad manda sobre el impacto: son clases distintas de problema.
    expect(ids.indexOf("metodo_pierde")).toBeLessThan(
      ids.indexOf("descuentos_mostrador"),
    );
  });
});

describe("getAdvisorInsights — señales gerenciales nuevas", () => {
  it("cuenta corriente sin cuadrar: los 2 de 156 clientes de Evens", () => {
    const r = getAdvisorInsights(
      baseMetrics({
        cuentaCorrienteDescuadrada: { clientes: 2, clientesConDeuda: 156 },
      }),
      10,
    );
    const insight = r.find((i) => i.id === "cc_descuadrada");
    expect(insight?.message).toContain("2 de 156");
    expect(insight?.priority).toBe(88);
  });

  it("renglones sin costo: avisa que el margen está inflado, no que rindan", () => {
    const r = getAdvisorInsights(
      baseMetrics({ renglonesSinCosto: { renglones: 80, total: 800 } }),
      10,
    );
    const insight = r.find((i) => i.id === "renglones_sin_costo");
    expect(insight?.message).toContain("80 de 800");
    expect(insight?.message).toContain("más alta de lo que es");
  });

  it("renglones sin costo: no dispara por un puñado suelto", () => {
    const r = getAdvisorInsights(
      baseMetrics({ renglonesSinCosto: { renglones: 4, total: 800 } }),
      10,
    );
    expect(r.some((i) => i.id === "renglones_sin_costo")).toBe(false);
  });

  it("venta cruzada: con composicion_ticket promete el margen del renglón que se suma", () => {
    const r = getAdvisorInsights(
      baseMetrics({
        // Evens: 55,6% de tickets de un renglón, $6.823 de margen el adicional.
        renglonAdicional: {
          margenPromedio: 6823,
          ticketsDeUnRenglon: 228,
          pctDeUnRenglon: 55.6,
        },
        ticketsDeUnaUnidad: 227,
        ordenes: 408,
      }),
      10,
    );

    const upselling = r.filter((i) => i.id === "upselling");
    // UNA sola tarjeta: la señal buena reemplaza a la de unidades, no se suma.
    expect(upselling).toHaveLength(1);
    expect(upselling[0].message).toContain("6.823");
    expect(upselling[0].title).toContain("un solo renglón");
  });

  it("venta cruzada: sin la señal cae a la versión por unidades", () => {
    const r = getAdvisorInsights(
      baseMetrics({ ticketsDeUnaUnidad: 227, ordenes: 408 }),
      10,
    );
    const insight = r.find((i) => i.id === "upselling");
    expect(insight?.title).toBe("Ventas de una sola unidad");
  });

  it("día fuerte: usa las ventas POR DÍA normalizadas y dice las dos puntas", () => {
    const r = getAdvisorInsights(
      baseMetrics({
        momentoDelDia: {
          diaFuerte: "Sábado",
          ventasPorDiaFuerte: 17.67,
          diaFlojo: "Lunes",
          ventasPorDiaFlojo: 3.75,
        },
      }),
      10,
    );
    const insight = r.find((i) => i.id === "best_day");
    expect(insight?.message).toContain("17,7");
    expect(insight?.message).toContain("3,8");
    expect(insight?.message).toContain("4,7 veces");
  });

  it("día fuerte: no dispara si los días se parecen", () => {
    const r = getAdvisorInsights(
      baseMetrics({
        momentoDelDia: {
          diaFuerte: "Sábado",
          ventasPorDiaFuerte: 5,
          diaFlojo: "Lunes",
          ventasPorDiaFlojo: 4.5,
        },
      }),
      10,
    );
    expect(r.some((i) => i.id === "best_day")).toBe(false);
  });
});

describe("getAdvisorInsights — asociación sugerida en Requiere tu atención", () => {
  const asociacion = { producto_a: "Remera Lisa", producto_b: "Jean Recto", producto_a_id: "pa", producto_b_id: "pb", ventas_juntas: 5 };

  it("sin la señal no agrega fila", () => {
    expect(getAdvisorInsights(baseMetrics()).some((i) => i.id === "asociacion_sugerida")).toBe(false);
  });

  it("con la señal agrega una fila info con botón que activa el par (sin link)", () => {
    const r = getAdvisorInsights(baseMetrics({ asociacionSugerida: asociacion }), 10);
    const fila = r.find((i) => i.id === "asociacion_sugerida");
    expect(fila?.type).toBe("info");
    expect(fila?.message).toContain("Remera Lisa y Jean Recto");
    expect(fila?.message).toContain("5 ventas");
    expect(fila?.accionAsociacion).toEqual({ producto_a_id: "pa", producto_b_id: "pb" });
    expect(fila?.href).toBeUndefined();
  });

  it("no compite con otra oportunidad de la misma familia", () => {
    const r = getAdvisorInsights(
      baseMetrics({ asociacionSugerida: asociacion, renglonAdicional: { margenPromedio: 1000, ticketsDeUnRenglon: 50, pctDeUnRenglon: 60 } }),
      10,
    );
    expect(r.some((i) => i.id === "asociacion_sugerida")).toBe(true);
    expect(r.some((i) => i.id === "upselling")).toBe(true);
  });
});
