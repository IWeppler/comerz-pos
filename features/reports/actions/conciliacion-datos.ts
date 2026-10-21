import type { createClient } from "@/shared/config/supabase/server";
import { traerTodo } from "@/shared/lib/traer-todo";
import type { DatosConciliacion } from "../lib/conciliacion";

/**
 * Lee lo que hace falta para la conciliación del período. No es una action:
 * la llaman la pantalla y la exportación, que ya tienen el cliente de Supabase
 * y el permiso comprobado.
 *
 * Todas las lecturas van paginadas (`traerTodo`): PostgREST corta en 1.000
 * filas y una conciliación truncada cierra mal sin avisar.
 */

type Supabase = ReturnType<typeof createClient>;

/** Ids por bloques: un `in` con miles de ids no entra en la URL. */
const TAMANO_BLOQUE = 200;

function porBloques(ids: string[], tamano: number): string[][] {
  const bloques: string[][] = [];
  for (let i = 0; i < ids.length; i += tamano) bloques.push(ids.slice(i, i + tamano));
  return bloques;
}

function numero(valor: unknown): number {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export async function leerDatosConciliacion(
  supabase: Supabase,
  desde: string,
  hasta: string,
): Promise<DatosConciliacion> {
  // 1. Ventas del período (sin anuladas).
  const ventas = await traerTodo<{ id: string; total: number | string | null }>(
    "conciliacion ventas",
    (d, h) =>
      supabase
        .from("ventas")
        .select("id, total", { count: "exact" })
        .gte("fecha_venta", desde)
        .lte("fecha_venta", hasta)
        .neq("estado_operacion", "ANULADA")
        .order("id")
        .range(d, h),
  );
  const ids = ventas.data.map((v) => v.id);
  const ventasTotal = ventas.data.reduce((acc, v) => acc + numero(v.total), 0);

  // 2. Por venta: pagos, fiado y movimientos de stock. En bloques de ids.
  let cobradoEnVenta = 0;
  let fiadoDelPeriodo = 0;
  const ventasConStock = new Set<string>();

  for (const bloque of porBloques(ids, TAMANO_BLOQUE)) {
    const pagos = await traerTodo<{ monto_bruto: number | string | null; estado_pago_operacion: string | null }>(
      "conciliacion pagos de venta",
      (d, h) =>
        supabase
          .from("venta_pagos")
          .select("monto_bruto, estado_pago_operacion", { count: "exact" })
          .in("venta_id", bloque)
          .order("id")
          .range(d, h),
    );
    for (const p of pagos.data) {
      if (p.estado_pago_operacion === "ANULADO") continue;
      cobradoEnVenta += numero(p.monto_bruto);
    }

    const cc = await traerTodo<{ tipo: string; monto: number | string | null; anulado: boolean | null }>(
      "conciliacion cuenta corriente de ventas",
      (d, h) =>
        supabase
          .from("cuenta_corriente_movimientos")
          .select("tipo, monto, anulado", { count: "exact" })
          .in("venta_id", bloque)
          .order("id")
          .range(d, h),
    );
    for (const m of cc.data) {
      if (m.anulado) continue;
      if (m.tipo === "DEBITO") fiadoDelPeriodo += numero(m.monto);
    }

    const stock = await traerTodo<{ referencia_id: string | null }>(
      "conciliacion movimientos de stock",
      (d, h) =>
        supabase
          .from("movimientos_stock")
          .select("referencia_id", { count: "exact" })
          .eq("origen", "VENTA")
          .in("referencia_id", bloque)
          .order("id")
          .range(d, h),
    );
    for (const s of stock.data) {
      if (s.referencia_id) ventasConStock.add(s.referencia_id);
    }
  }

  // 3. Cuenta corriente del período (por fecha de movimiento).
  const ccPeriodo = await traerTodo<{
    tipo: string;
    monto: number | string | null;
    anulado: boolean | null;
    pago_id: string | null;
    venta_id: string | null;
  }>("conciliacion cuenta corriente del período", (d, h) =>
    supabase
      .from("cuenta_corriente_movimientos")
      .select("tipo, monto, anulado, pago_id, venta_id", { count: "exact" })
      .gte("creado_en", desde)
      .lte("creado_en", hasta)
      .order("id")
      .range(d, h),
  );
  let ccCreditos = 0;
  let ccCreditosVinculadosVenta = 0;
  for (const m of ccPeriodo.data) {
    if (m.anulado || m.tipo !== "CREDITO") continue;
    const monto = numero(m.monto);
    ccCreditos += monto;
    // Crédito ligado a una venta sin pago: anulación o devolución de fiado.
    if (m.venta_id && !m.pago_id) ccCreditosVinculadosVenta += monto;
  }

  // 4. Cobros de deuda registrados como pago en el período.
  const cobrosCc = await traerTodo<{ monto_bruto: number | string | null; estado_pago_operacion: string | null }>(
    "conciliacion cobros de cuenta corriente",
    (d, h) =>
      supabase
        .from("venta_pagos")
        .select("monto_bruto, estado_pago_operacion", { count: "exact" })
        .eq("tipo_movimiento", "PAGO_CUENTA_CORRIENTE")
        .gte("creado_en", desde)
        .lte("creado_en", hasta)
        .order("id")
        .range(d, h),
  );
  let ccCobrosRegistrados = 0;
  for (const p of cobrosCc.data) {
    if (p.estado_pago_operacion === "ANULADO") continue;
    ccCobrosRegistrados += numero(p.monto_bruto);
  }

  return {
    ventasTotal,
    ventasCount: ids.length,
    cobradoEnVenta,
    fiadoDelPeriodo,
    ccCreditos,
    ccCobrosRegistrados,
    ccCreditosVinculadosVenta,
    ventasConMovimientoStock: ventasConStock.size,
  };
}
