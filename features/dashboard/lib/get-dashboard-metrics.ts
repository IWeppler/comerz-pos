import { ProductoPanel } from "@/entities/productos/types";
import {
  acumularUnidad,
  listarFraccionado,
  nuevoAcumuladorUnidades,
} from "./unidades-vendidas";
import { formatearCantidad } from "@/shared/lib/unidad-venta";
import { EgresoCaja } from "@/entities/caja/types";
import {
  Venta,
  VentaItem,
  VentaPago,
  VentaProducto,
  getSupabaseRelation,
} from "@/entities/ventas/types";
import {
  detectarStockCriticoRotacion,
  VENTANA_ROTACION_DIAS,
} from "./detectar-quiebres";
import {
  normalizarTipoEgreso,
  sumarGastosOperativos,
  sumarSalidasDeCaja,
} from "@/features/caja/lib/tipo-egreso";

export type PeriodoDashboard =
  | "hoy"
  | "7dias"
  | "30dias"
  | "mes"
  | "mes_anterior"
  | "anio"
  | "personalizado"
  | "historico";

type VentaItemExtended = VentaItem & {
  precio_costo?: number | string;
  producto_id?: string | null;
};

type VentaProductoExtended = VentaProducto & {
  tipo?: string;
  categoria?: { nombre?: string | null } | null;
};

type MovimientoBaja = {
  producto_id?: string | null;
  cantidad?: number | string | null;
  motivo?: string | null;
  creado_en: string;
};

type StockCriticoItem = {
  nombre: string;
  variante: string;
  cantidad: number;
};

type ProductoSinMovimiento = ProductoPanel & {
  diasSinVender: number;
};

export function getDashboardMetrics(
  ventas: Venta[],
  productos: ProductoPanel[],
  egresos: EgresoCaja[] = [],
  bajas: MovimientoBaja[] = [],
  periodo: PeriodoDashboard = "mes",
  desde?: string,
  hasta?: string,
  /**
   * Cobros de cuenta corriente (venta_pagos sin venta_id). Van aparte porque
   * NO son ingresos nuevos — el ticket fiado ya computó su total el día de la
   * venta, y volver a sumar el capital cobrado lo contaría dos veces. Lo que
   * sí traen es plata real que hasta ahora nadie estaba mirando en Reportes:
   * la comisión que retiene el procesador y el recargo por método. Sin esto,
   * cobrar una deuda con tarjeta descontaba comisión en el arqueo de Caja
   * pero no en el dashboard, y la ganancia neta quedaba sobreestimada.
   */
  pagosCuentaCorriente: VentaPago[] = [],
) {
  const now = new Date();
  let startDate = new Date(0);
  let endDate = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    23,
    59,
    59,
    999,
  );

  if (periodo === "hoy") {
    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  } else if (periodo === "7dias") {
    startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    startDate.setHours(0, 0, 0, 0);
  } else if (periodo === "30dias") {
    startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    startDate.setHours(0, 0, 0, 0);
  } else if (periodo === "mes") {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (periodo === "mes_anterior") {
    startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
  } else if (periodo === "anio") {
    startDate = new Date(now.getFullYear(), 0, 1);
  } else if (periodo === "personalizado" && desde) {
    startDate = new Date(desde + "T00:00:00");
    if (hasta) {
      endDate = new Date(hasta + "T23:59:59");
    }
  }

  const ventasOperativas = ventas.filter(
    (v) => v.estado_operacion !== "ANULADA" && v.estado_pago !== "ANULADA",
  );

  const ventasFiltradas =
    periodo === "historico"
      ? ventasOperativas
      : ventasOperativas.filter((v) => {
          const f = new Date(v.fecha_venta);
          return f >= startDate && f <= endDate;
        });

  const egresosFiltrados =
    periodo === "historico"
      ? egresos
      : egresos.filter((e) => {
          const f = new Date(e.fecha);
          return f >= startDate && f <= endDate;
        });

  const bajasFiltradas =
    periodo === "historico"
      ? bajas
      : bajas.filter((m) => {
          const f = new Date(m.creado_en);
          return f >= startDate && f <= endDate;
        });

  // Los cobros anulados no se descuentan de la caja, así que tampoco pueden
  // descontar comisión acá — mismo criterio que ventasOperativas.
  const pagosCCOperativos = pagosCuentaCorriente.filter(
    (p) => p.estado_pago_operacion !== "ANULADO",
  );

  const pagosCCFiltrados =
    periodo === "historico"
      ? pagosCCOperativos
      : pagosCCOperativos.filter((p) => {
          if (!p.creado_en) return false;
          const f = new Date(p.creado_en);
          return f >= startDate && f <= endDate;
        });

  // --- CORE KPIs FINANCIEROS ---
  let ingresosBrutos = 0;
  let sumaCuadradosTicket = 0;
  let ticketsDeUnaUnidad = 0;
  let costoMercaderiaVendida = 0;
  let gananciaBrutaVentas = 0;
  // Piezas y fraccionado (kg, g, m…) por separado: ver unidades-vendidas.ts.
  const unidades = nuevoAcumuladorUnidades();
  let totalComisiones = 0; // NUEVO: Fuga de capital por comisiones
  // Recargo por método cobrado al cliente. NO es venta de mercadería: es
  // recupero financiero, y existe justamente para compensar `totalComisiones`.
  // Por eso viaja separado en vez de sumar a ingresos/ganancia bruta, donde
  // inflaba el margen de producto (un ticket con 15% de recargo aparentaba
  // vender más caro de lo que en realidad se vendió).
  let recargosCobrados = 0;

  const catMap = new Map<
    string,
    { ingresos: number; unidades: number; tickets: Set<string> }
  >();
  const rentabilidadCatMap = new Map<string, number>();

  const metodoPagoMap = new Map<
    string,
    { bruto: number; comision: number; neto: number }
  >();

  const diasSemana = [
    "Domingo",
    "Lunes",
    "Martes",
    "Miércoles",
    "Jueves",
    "Viernes",
    "Sábado",
  ];
  const diaMap = new Map<string, number>();
  diasSemana.forEach((d) => diaMap.set(d, 0));

  const heatmapMap = new Map<
    string,
    { ingresos: number; ventas: number; unidades: number }
  >();
  const franjasInicio = [8, 10, 12, 14, 16, 18, 20];
  diasSemana.forEach((dia) => {
    franjasInicio.forEach((franja) => {
      heatmapMap.set(`${dia}-${franja}`, {
        ingresos: 0,
        ventas: 0,
        unidades: 0,
      });
    });
  });

  const getFranja2Horas = (hora: number) => {
    if (hora >= 8 && hora < 10) return 8;
    if (hora >= 10 && hora < 12) return 10;
    if (hora >= 12 && hora < 14) return 12;
    if (hora >= 14 && hora < 16) return 14;
    if (hora >= 16 && hora < 18) return 16;
    if (hora >= 18 && hora < 20) return 18;
    if (hora >= 20 && hora < 22) return 20;
    return null;
  };

  const productosConVentas = new Set<string>();
  const ventasPorProducto: Record<
    string,
    {
      nombre: string;
      ingresos: number;
      unidades: number;
      ganancia: number;
      unidadMedida: string | null;
    }
  > = {};

  const clientesMap = new Map<
    string,
    { nombre: string; totalComprado: number; tickets: number }
  >();

  ventasFiltradas.forEach((v) => {
    // `ventas.total` incluye el recargo por método; acá se lo saca para que
    // "Ingresos" y "Ganancia bruta" hablen solo de mercadería. La resta que
    // hace reportes/page.tsx (ingresos - gananciaBruta = costo de mercadería)
    // sigue cerrando porque ambos quedan sobre la misma base.
    // Lo DEVUELTO se resta acá y no se filtra la venta entera: una venta con
    // devolución parcial sigue siendo una venta, con su ticket y su fecha, y
    // sacarla del conjunto se llevaría también lo que sí se vendió. Ver
    // 20260903160000: la venta queda CONFIRMADA a propósito.
    //
    // TODO lo devuelto baja de INGRESOS, y el recargo por método no se toca.
    // No es una simplificación: `monto_devuelto` es base más recargo de cuenta
    // corriente perdonado (20260903200000), y los dos están adentro de
    // `ventas.total` y afuera de `recargo_metodo_total` — o sea que los dos
    // eran ingreso de mercadería para esta cuenta.
    //
    // El recargo por MÉTODO nunca se devuelve —se lo quedó el banco, ver
    // 20260903190000— así que `recargosCobrados` no se toca. Restárselo sería
    // descontar de la ganancia una plata que el comercio efectivamente perdió
    // pero que el cliente igual pagó.
    const recargoTicket = Number(v.recargo_metodo_total || 0);
    const devuelto = Number(v.monto_devuelto || 0);
    const totalTicket = Number(v.total || 0) - recargoTicket - devuelto;

    // El COSTO de lo devuelto también sale, o la ganancia bruta quedaría con
    // los ingresos bajados y el costo entero — un margen peor que el real
    // justo en las ventas que tuvieron devolución. Sale de los renglones y no
    // de una columna nueva porque `ventas.precio_costo` es Σ(precio_costo ×
    // cantidad) de los renglones (verificado 12 de 12 en el histórico), así
    // que restar Σ(precio_costo × cantidad_devuelta) es la misma cuenta al
    // revés y sobre la misma fuente.
    const costoDevuelto = (v.ventas_items ?? []).reduce(
      (acc, item) =>
        acc +
        Number(item.precio_costo || 0) * Number(item.cantidad_devuelta || 0),
      0,
    );
    const costoTicket = Number(v.precio_costo || 0) - costoDevuelto;

    recargosCobrados += recargoTicket;
    ingresosBrutos += totalTicket;
    // Tickets de UNA sola unidad. `ventas.cantidad` son unidades (no
    // renglones), así que esto es exactamente "se llevó una cosa sola" — la
    // población sobre la que se puede hacer algo en el mostrador.
    if (Number(v.cantidad || 0) === 1) ticketsDeUnaUnidad += 1;
    // Para el desvío del ticket promedio, en la misma pasada. Ver
    // `ticketDesvio` en el return: sin él no se puede saber si una caída del
    // ticket es un cambio o es un ticket grande de menos.
    sumaCuadradosTicket += totalTicket * totalTicket;
    costoMercaderiaVendida += costoTicket;
    gananciaBrutaVentas += totalTicket - costoTicket;

    // Procesamiento de CRM (Mejores Clientes)
    if (v.cliente_id && v.clientes) {
      const cId = v.cliente_id;
      const cliente = getSupabaseRelation(v.clientes);
      const nombreCliente = cliente?.nombre || "Cliente sin nombre";
      const currentCliente = clientesMap.get(cId) || {
        nombre: nombreCliente,
        totalComprado: 0,
        tickets: 0,
      };
      clientesMap.set(cId, {
        nombre: nombreCliente,
        totalComprado: currentCliente.totalComprado + totalTicket,
        tickets: currentCliente.tickets + 1,
      });
    }

    // --- Procesamiento de Pagos Mixtos y Comisiones ---
    if (v.venta_pagos && v.venta_pagos.length > 0) {
      v.venta_pagos.forEach((pago) => {
        const metodo = pago.metodo_nombre;
        const bruto = Number(pago.monto_bruto || 0);
        const comision = Number(pago.comision_monto || 0);
        const neto = Number(pago.monto_neto || 0);

        const current = metodoPagoMap.get(metodo) || {
          bruto: 0,
          comision: 0,
          neto: 0,
        };
        metodoPagoMap.set(metodo, {
          bruto: current.bruto + bruto,
          comision: current.comision + comision,
          neto: current.neto + neto,
        });

        totalComisiones += comision;
      });
    } else {
      // Fallback retrocompatibilidad para tickets antiguos
      const metodo = v.metodo_pago || "EFECTIVO";
      const current = metodoPagoMap.get(metodo) || {
        bruto: 0,
        comision: 0,
        neto: 0,
      };
      metodoPagoMap.set(metodo, {
        bruto: current.bruto + totalTicket,
        comision: current.comision + 0,
        neto: current.neto + totalTicket,
      });
    }

    const date = new Date(v.fecha_venta);
    const diaName = diasSemana[date.getDay()];
    diaMap.set(diaName, (diaMap.get(diaName) || 0) + totalTicket);

    const hora = date.getHours();
    const franja = getFranja2Horas(hora);

    if (franja !== null) {
      const heatKey = `${diaName}-${franja}`;
      const current = heatmapMap.get(heatKey) || {
        ingresos: 0,
        ventas: 0,
        unidades: 0,
      };
      const cantidadTicket = (
        (v.ventas_items || []) as VentaItemExtended[]
      ).reduce(
        (acc: number, item: VentaItemExtended) =>
          acc + Number(item.cantidad || 0),
        0,
      );

      heatmapMap.set(heatKey, {
        ingresos: current.ingresos + totalTicket,
        ventas: current.ventas + 1,
        unidades: current.unidades + cantidadTicket,
      });
    }

    const items = (v.ventas_items || []) as VentaItemExtended[];

    items.forEach((item) => {
      const cantidadItem = Number(item.cantidad || 0);
      const precioUnitario = Number(item.precio_unitario || 0);

      const prodDataGuardado = getSupabaseRelation(
        item.producto,
      ) as VentaProductoExtended | null;
      const prodCat = productos.find(
        (p) =>
          (item.producto_id && p.id === item.producto_id) ||
          (prodDataGuardado?.nombre && p.nombre === prodDataGuardado.nombre),
      );

      const costoUnitario = Number(
        item.precio_costo ?? prodCat?.precio_costo ?? 0,
      );
      const itemIngreso = precioUnitario * cantidadItem;
      const itemGanancia = (precioUnitario - costoUnitario) * cantidadItem;

      const unidadMedidaItem =
        prodDataGuardado?.unidad_medida ?? prodCat?.unidad_medida ?? null;
      acumularUnidad(unidades, cantidadItem, unidadMedidaItem);

      const cat =
        prodCat?.categoria?.nombre ||
        prodDataGuardado?.categoria?.nombre ||
        prodCat?.tipo ||
        prodDataGuardado?.tipo ||
        "Sin categoría";

      if (!catMap.has(cat)) {
        catMap.set(cat, { ingresos: 0, unidades: 0, tickets: new Set() });
      }

      const catData = catMap.get(cat)!;
      catData.ingresos += itemIngreso;
      catData.unidades += cantidadItem;
      catData.tickets.add(v.id);

      rentabilidadCatMap.set(
        cat,
        (rentabilidadCatMap.get(cat) || 0) + itemGanancia,
      );

      const pId = item.producto_id || prodCat?.id || "eliminado";
      if (pId !== "eliminado") productosConVentas.add(pId);

      if (!ventasPorProducto[pId]) {
        const nombreReal =
          prodCat?.nombre || prodDataGuardado?.nombre || "Producto Eliminado";
        ventasPorProducto[pId] = {
          nombre: nombreReal,
          ingresos: 0,
          unidades: 0,
          ganancia: 0,
          unidadMedida: unidadMedidaItem,
        };
      }
      ventasPorProducto[pId].ingresos += itemIngreso;
      ventasPorProducto[pId].unidades += cantidadItem;
      ventasPorProducto[pId].ganancia += itemGanancia;
    });
  });

  // --- COBROS DE CUENTA CORRIENTE ---
  // Solo su costo/recupero financiero: el capital cobrado NO suma a ingresos
  // (ya se contó cuando se hizo la venta fiada), pero la comisión es plata
  // que se va igual y el recargo es plata que entra y nunca estuvo en ningún
  // `ventas.total`. Sí entran al desglose por método, que es "cobros por
  // método" — así el Bruto de esa tabla cierra contra lo que muestra Caja.
  let cobrosCuentaCorriente = 0;
  pagosCCFiltrados.forEach((pago) => {
    const metodo = pago.metodo_nombre;
    const bruto = Number(pago.monto_bruto || 0);
    const comision = Number(pago.comision_monto || 0);
    const neto = Number(pago.monto_neto || 0);

    const current = metodoPagoMap.get(metodo) || {
      bruto: 0,
      comision: 0,
      neto: 0,
    };
    metodoPagoMap.set(metodo, {
      bruto: current.bruto + bruto,
      comision: current.comision + comision,
      neto: current.neto + neto,
    });

    totalComisiones += comision;
    recargosCobrados += Number(pago.recargo_monto || 0);
    cobrosCuentaCorriente += bruto;
  });

  const ordenes = ventasFiltradas.length;
  const ticketPromedio = ordenes > 0 ? ingresosBrutos / ordenes : 0;
  // Desvío muestral de los tickets del período. El ticket promedio es una
  // MEDIA, y una media sobre pocos tickets se mueve sola: medido en Evens
  // sobre 408 tickets de 30 días, el desvío es más grande que la media
  // (CV 1,07). Sin este número no hay forma de que la UI distinga "el ticket
  // bajó" de "la semana pasada hubo un ticket de $204.700 entre seis".
  // Var muestral = (Σx² − n·media²) / (n − 1), en la misma pasada de arriba.
  const varianzaTicket =
    ordenes > 1
      ? Math.max(
          0,
          (sumaCuadradosTicket - ordenes * ticketPromedio * ticketPromedio) /
            (ordenes - 1),
        )
      : 0;
  const ticketDesvio = Math.sqrt(varianzaTicket);

  // --- EGRESOS Y BAJAS ---
  // Solo los OPERATIVOS restan del resultado. Un retiro de la dueña es la
  // ganancia ya hecha, no un gasto, y una compra de mercadería ya está
  // contada en el precio_costo de lo que se vende: restarla acá la contaba
  // dos veces. Los tres siguen saliendo del cajón — eso lo mira el arqueo de
  // caja, no esta cuenta.
  const totalEgresos = sumarGastosOperativos(egresosFiltrados);
  const totalSalidasCaja = sumarSalidasDeCaja(egresosFiltrados);
  const totalRetiros = egresosFiltrados
    .filter((e) => normalizarTipoEgreso(e.tipo) === "RETIRO_SOCIO")
    .reduce((acc, e) => acc + Number(e.monto || 0), 0);
  const totalComprasMercaderia = egresosFiltrados
    .filter((e) => normalizarTipoEgreso(e.tipo) === "COMPRA_MERCADERIA")
    .reduce((acc, e) => acc + Number(e.monto || 0), 0);

  let costoPerdidoBajas = 0;
  let unidadesBajas = 0;
  const bajasMotivoMap = new Map<string, number>();

  bajasFiltradas.forEach((b) => {
    const productoAfectado = productos.find((p) => p.id === b.producto_id);
    const costo = Number(productoAfectado?.precio_costo ?? 0);
    const cantidad = Number(b.cantidad || 0);
    const costoTotalBaja = cantidad * costo;

    costoPerdidoBajas += costoTotalBaja;
    unidadesBajas += cantidad;

    const motivo = b.motivo || "No especificado";
    bajasMotivoMap.set(
      motivo,
      (bajasMotivoMap.get(motivo) || 0) + costoTotalBaja,
    );
  });

  // Ganancia Neta Real. El recargo entra acá, del mismo lado que la comisión
  // que compensa: si se lo dejara dentro de la ganancia bruta, el margen de
  // producto mentiría; si se lo omitiera del todo, el negocio aparecería
  // perdiendo plata por cobrar con tarjeta, que es exactamente lo que el
  // recargo evita.
  const resultadoOperativo =
    gananciaBrutaVentas + recargosCobrados - totalEgresos - totalComisiones;
  const margenPorcentaje =
    ingresosBrutos > 0 ? (resultadoOperativo / ingresosBrutos) * 100 : 0;

  // --- OPERATIVO Y STOCK ---
  let stockTotalUnidades = 0;
  let stockValorizadoCosto = 0;
  let stockValorizadoPotencial = 0;
  const productosSinMovimiento: ProductoSinMovimiento[] = [];

  const ultimaVentaMap = new Map<string, Date>();
  ventas.forEach((v) => {
    const f = new Date(v.fecha_venta);
    const items = (v.ventas_items || []) as VentaItemExtended[];
    items.forEach((item) => {
      const prodDataGuardado = getSupabaseRelation(
        item.producto,
      ) as VentaProductoExtended | null;
      const prodCat = productos.find(
        (p) =>
          (item.producto_id && p.id === item.producto_id) ||
          (prodDataGuardado?.nombre && p.nombre === prodDataGuardado.nombre),
      );
      if (prodCat) {
        const actual = ultimaVentaMap.get(prodCat.id);
        if (!actual || f > actual) {
          ultimaVentaMap.set(prodCat.id, f);
        }
      }
    });
  });

  productos.forEach((pro) => {
    const costo = Number(pro.precio_costo ?? 0);
    const precio = Number(pro.precio ?? 0);
    let stockTotalProducto = 0;

    pro.stock?.forEach((s) => {
      const cantidadStock = Number(s.cantidad);
      stockTotalUnidades += cantidadStock;
      stockValorizadoCosto += cantidadStock * costo;
      stockValorizadoPotencial += cantidadStock * precio;
      stockTotalProducto += cantidadStock;
    });

    if (stockTotalProducto > 0) {
      const ultimaVenta = ultimaVentaMap.get(pro.id);
      const diasSinVender = ultimaVenta
        ? Math.floor(
            (now.getTime() - ultimaVenta.getTime()) / (1000 * 3600 * 24),
          )
        : 9999;
      productosSinMovimiento.push({ ...pro, diasSinVender });
    }
  });

  // Stock crítico "de verdad": solo variantes con stock bajo de productos
  // que ADEMÁS tuvieron ventas en la ventana de rotación reciente — ver
  // detectar-quiebres.ts para el porqué (la regla vieja de "stock ≤3 en
  // todo el catálogo" disparaba con ~90% de los productos en indumentaria).
  const stockCriticoRotacion = detectarStockCriticoRotacion(
    ventasOperativas,
    productos,
    VENTANA_ROTACION_DIAS,
    now,
  );
  const productosCriticos = stockCriticoRotacion.length;
  const stockCriticoDetallado: StockCriticoItem[] = stockCriticoRotacion.map(
    (c) => ({ nombre: c.nombre, variante: c.variante, cantidad: c.cantidad }),
  );

  const stockGananciaPotencial =
    stockValorizadoPotencial - stockValorizadoCosto;

  const topProductos = Object.values(ventasPorProducto)
    .sort((a, b) => b.unidades - a.unidades)
    .map((p) => ({
      ...p,
      cantidadEtiqueta: formatearCantidad(p.unidades, p.unidadMedida),
    }))
    .slice(0, 10);

  const topProductosRentables = Object.values(ventasPorProducto)
    .sort((a, b) => b.ganancia - a.ganancia)
    .slice(0, 10);

  const peoresProductosRentables = Object.values(ventasPorProducto)
    .filter((p) => p.ganancia > 0)
    .sort((a, b) => a.ganancia - b.ganancia)
    .slice(0, 5);

  //  COMPOSICIÓN FINANCIERA
  const donutData = [
    {
      label: "Costo Mercadería",
      value: costoMercaderiaVendida,
      color: "#f59e0b",
    }, // Ambar
    { label: "Gastos Operativos", value: totalEgresos, color: "#f43f5e" }, // Rose
    { label: "Comisiones Dig.", value: totalComisiones, color: "#8b5cf6" }, // Violeta
    {
      label: "Result. Operativo",
      value: resultadoOperativo > 0 ? resultadoOperativo : 0,
      color: "#10b981",
    }, // Esmeralda
  ];

  const ventasPorCategoria = Array.from(catMap.entries())
    .map(([label, data]) => ({
      label,
      ingresos: data.ingresos,
      unidades: data.unidades,
      tickets: data.tickets.size,
    }))
    .sort((a, b) => b.ingresos - a.ingresos);

  const rentabilidadPorCategoria = Array.from(rentabilidadCatMap.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  // Top 5 de Mejores Clientes
  const topClientesVolumen = Array.from(clientesMap.values())
    .sort((a, b) => b.totalComprado - a.totalComprado)
    .slice(0, 5);

  const ventasPorDia = Array.from(diaMap.entries())
    .map(([label, value]) => ({ label, value }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value);

  //  MAPEAMOS EL NUEVO OBJETO MULTIDIMENSIONAL DE PAGOS
  const ventasPorMetodo = Array.from(metodoPagoMap.entries())
    .map(([label, data]) => ({
      label,
      bruto: data.bruto,
      comision: data.comision,
      neto: data.neto,
    }))
    .sort((a, b) => b.bruto - a.bruto);

  const bajasPorMotivo = Array.from(bajasMotivoMap.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  const ventasHeatmap = Array.from(heatmapMap.entries()).map(([key, stats]) => {
    const [dia, franja] = key.split("-");
    const horaInicio = parseInt(franja);
    const horaFin = horaInicio + 2;
    const ticketPromedio = stats.ventas > 0 ? stats.ingresos / stats.ventas : 0;

    return {
      dia,
      horaInicio,
      horaFin,
      horaTexto: `${horaInicio.toString().padStart(2, "0")}:00 - ${horaFin.toString().padStart(2, "0")}:00`,
      ...stats,
      ticketPromedio,
    };
  });

  const topFranjas = [...ventasHeatmap]
    .sort((a, b) => b.ingresos - a.ingresos)
    .filter((f) => f.ingresos > 0)
    .slice(0, 3);

  const fraccionadoVendido = listarFraccionado(unidades);

  return {
    ingresos: ingresosBrutos,
    ordenes,
    /** Solo PIEZAS. Lo vendido por peso/volumen/largo va aparte. */
    unidadesVendidas: unidades.piezas,
    /** Lo fraccionable, por unidad: "0,206 kg", "3 m". Vacío si no hubo. */
    fraccionadoVendido,
    ticketPromedio,
    /** Desvío muestral del ticket, para poder decir si una variación del
     * ticket promedio se distingue del ruido. Ver `crecimientoDeMedia`. */
    ticketDesvio,
    /** Tickets de una sola unidad. Ver la regla de venta cruzada del Advisor. */
    ticketsDeUnaUnidad,
    gananciaBrutaVentas,
    gananciaNeta: resultadoOperativo,
    /** Solo gastos operativos: es lo que resta de la ganancia. */
    totalEgresos,
    /** Todo lo que salió del cajón (gastos + retiros + compras). Es lo que
     * tiene que cuadrar con el arqueo, NO con el resultado. */
    totalSalidasCaja,
    totalRetiros,
    totalComprasMercaderia,
    totalComisiones,
    recargosCobrados,
    /** Bruto cobrado de deudas en el período. No suma a `ingresos`. */
    cobrosCuentaCorriente,
    costoPerdidoBajas,
    unidadesBajas,
    margenPorcentaje,
    stockTotalUnidades,
    stockValorizadoCosto,
    stockValorizadoPotencial,
    stockGananciaPotencial,
    productosCriticos,
    stockCriticoDetallado,
    productosSinMovimiento,
    topProductos,
    topProductosRentables,
    peoresProductosRentables,
    donutData,
    ventasPorCategoria,
    rentabilidadPorCategoria,
    ventasPorDia,
    ventasPorMetodo,
    bajasPorMotivo,
    ventasHeatmap,
    topFranjas,
    topClientesVolumen,
  };
}
