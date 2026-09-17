"use server";

import { createClient } from "@/shared/config/supabase/server";
import { nombreRenglon } from "@/features/sales/lib/nombre-renglon";
import { cookies } from "next/headers";
import { getSupabaseRelation } from "@/entities/ventas/types";
import {
  ReporteVendedoresData,
  VendedorResumen,
  VentaPorDiaVendedor,
  DesgloseMetodoVendedor,
  ProductoTopVendedor,
  VentaAnuladaVendedor,
} from "@/entities/reportes/types";

interface VentaRow {
  id: string;
  vendedor_id: string | null;
  total: number;
  fecha_venta: string;
  metodo_pago: string | null;
  estado_operacion: string | null;
  perfiles: { nombre?: string | null } | { nombre?: string | null }[] | null;
  ventas_items: {
    cantidad: number;
    precio_final: number | null;
    precio_unitario: number;
    producto: { nombre?: string | null } | { nombre?: string | null }[] | null;
    producto_id?: string | null;
    variante?: string | null;
    es_venta_libre?: boolean | null;
  }[];
  venta_pagos: {
    metodo_tipo: string;
    monto_bruto: number;
  }[];
}

export async function getReporteVendedoresAction(
  desde: string,
  hasta: string,
): Promise<{ data: ReporteVendedoresData | null; error: string | null }> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: tienePermiso } = await supabase.rpc("tiene_permiso", {
    clave: "reportes.ver_todos_empleados",
  });
  if (!tienePermiso) {
    return {
      data: null,
      error: "No tenés permisos para ver el reporte de vendedores.",
    };
  }

  const { data: ventas, error } = await supabase
    .from("ventas")
    .select(
      `
      id,
      vendedor_id,
      total,
      fecha_venta,
      metodo_pago,
      estado_operacion,
      perfiles(nombre),
      ventas_items(cantidad, precio_final, precio_unitario, producto_id, variante, es_venta_libre, producto:productos(nombre)),
      venta_pagos(metodo_tipo, monto_bruto)
      `,
    )
    .gte("fecha_venta", `${desde}T00:00:00`)
    .lte("fecha_venta", `${hasta}T23:59:59.999`)
    .order("fecha_venta", { ascending: true });

  if (error || !ventas) {
    console.error("[REPORTE VENDEDORES ERROR]", error);
    return { data: null, error: "No se pudo cargar el reporte de vendedores." };
  }

  const filas = ventas as unknown as VentaRow[];

  const nombresPorVendedor = new Map<string, string>();
  const resumenAcc = new Map<
    string,
    { totalVendido: number; cantidadVentas: number; cantidadAnuladas: number }
  >();
  const porDiaAcc = new Map<string, number>(); // key: `${vendedorId}|${fecha}`
  const metodoAcc = new Map<string, number>(); // key: `${vendedorId}|${metodo}`
  const productosAcc = new Map<
    string,
    Map<string, { nombre: string; cantidad: number; totalFacturado: number }>
  >();
  const anuladasAcc = new Map<string, VentaAnuladaVendedor[]>();

  for (const venta of filas) {
    const vendedorId = venta.vendedor_id;
    if (!vendedorId) continue;

    const perfil = getSupabaseRelation(venta.perfiles);
    nombresPorVendedor.set(vendedorId, perfil?.nombre || "Vendedor");

    const esAnulada = venta.estado_operacion === "ANULADA";
    const total = Number(venta.total) || 0;

    if (!resumenAcc.has(vendedorId)) {
      resumenAcc.set(vendedorId, {
        totalVendido: 0,
        cantidadVentas: 0,
        cantidadAnuladas: 0,
      });
    }
    const resumen = resumenAcc.get(vendedorId)!;

    if (esAnulada) {
      resumen.cantidadAnuladas += 1;

      const primerItem = venta.ventas_items?.[0];
      const productoNombre = nombreRenglon(
        getSupabaseRelation(primerItem?.producto)?.nombre,
        primerItem ?? {},
      );

      if (!anuladasAcc.has(vendedorId)) anuladasAcc.set(vendedorId, []);
      anuladasAcc.get(vendedorId)!.push({
        id: venta.id,
        fecha: venta.fecha_venta,
        producto: productoNombre,
        monto: total,
      });

      continue;
    }

    resumen.totalVendido += total;
    resumen.cantidadVentas += 1;

    const fecha = venta.fecha_venta.slice(0, 10);
    const claveDia = `${vendedorId}|${fecha}`;
    porDiaAcc.set(claveDia, (porDiaAcc.get(claveDia) || 0) + total);

    // Desglose por método de pago: si la venta tiene venta_pagos (pago
    // dividido o con comisión registrada), usamos esos montos reales por
    // método. Si no tiene ninguno, cae al metodo_pago plano de la venta
    // — mismo criterio que ya usa caja-dashboard.tsx.
    if (venta.venta_pagos && venta.venta_pagos.length > 0) {
      for (const pago of venta.venta_pagos) {
        const claveMetodo = `${vendedorId}|${pago.metodo_tipo}`;
        metodoAcc.set(
          claveMetodo,
          (metodoAcc.get(claveMetodo) || 0) + Number(pago.monto_bruto),
        );
      }
    } else {
      const metodo = venta.metodo_pago || "EFECTIVO";
      const claveMetodo = `${vendedorId}|${metodo}`;
      metodoAcc.set(claveMetodo, (metodoAcc.get(claveMetodo) || 0) + total);
    }

    // Top productos por vendedor
    if (!productosAcc.has(vendedorId)) productosAcc.set(vendedorId, new Map());
    const productosDelVendedor = productosAcc.get(vendedorId)!;

    for (const item of venta.ventas_items || []) {
      // Las ventas libres se agrupan en una sola fila "Venta libre": son
      // cosas distintas cada vez y una fila por descripción sería ruido.
      const productoId = item.producto_id || (item.es_venta_libre ? "venta-libre" : "sin-id");
      const productoNombre = item.es_venta_libre
        ? "Venta libre"
        : nombreRenglon(getSupabaseRelation(item.producto)?.nombre, item);
      const montoItem =
        (item.precio_final ?? item.precio_unitario) * item.cantidad;

      if (!productosDelVendedor.has(productoId)) {
        productosDelVendedor.set(productoId, {
          nombre: productoNombre,
          cantidad: 0,
          totalFacturado: 0,
        });
      }
      const entry = productosDelVendedor.get(productoId)!;
      entry.cantidad += item.cantidad;
      entry.totalFacturado += montoItem;
    }
  }

  const resumen: VendedorResumen[] = Array.from(resumenAcc.entries()).map(
    ([vendedorId, r]) => ({
      vendedorId,
      nombre: nombresPorVendedor.get(vendedorId) || "Vendedor",
      totalVendido: r.totalVendido,
      cantidadVentas: r.cantidadVentas,
      ticketPromedio: r.cantidadVentas > 0 ? r.totalVendido / r.cantidadVentas : 0,
      cantidadAnuladas: r.cantidadAnuladas,
    }),
  );
  resumen.sort((a, b) => b.totalVendido - a.totalVendido);

  const ventasPorDia: VentaPorDiaVendedor[] = Array.from(porDiaAcc.entries()).map(
    ([clave, total]) => {
      const [vendedorId, fecha] = clave.split("|");
      return { vendedorId, fecha, total };
    },
  );

  const desglosePorMetodo: DesgloseMetodoVendedor[] = Array.from(
    metodoAcc.entries(),
  ).map(([clave, monto]) => {
    const [vendedorId, metodo] = clave.split("|");
    return { vendedorId, metodo, monto };
  });

  const porVendedor: ReporteVendedoresData["porVendedor"] = {};
  for (const vendedorId of nombresPorVendedor.keys()) {
    const productos = Array.from(
      productosAcc.get(vendedorId)?.entries() || [],
    ).map(([productoId, p]): ProductoTopVendedor => ({ productoId, ...p }));
    productos.sort((a, b) => b.cantidad - a.cantidad);

    const anuladas = (anuladasAcc.get(vendedorId) || []).sort(
      (a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime(),
    );

    porVendedor[vendedorId] = {
      topProductos: productos.slice(0, 5),
      anuladas,
    };
  }

  return {
    data: { resumen, ventasPorDia, desglosePorMetodo, porVendedor },
    error: null,
  };
}
