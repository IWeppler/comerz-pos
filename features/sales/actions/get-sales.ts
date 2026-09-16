"use server";

import { createClient } from "@/shared/config/supabase/server";
import { cookies } from "next/headers";
import { traerTodo } from "@/shared/lib/traer-todo";

/**
 * El historial de ventas.
 *
 * Iba SIN paginar, y eso no era una consulta pesada sino una bomba de tiempo:
 * PostgREST corta en 1.000 filas EN SILENCIO (ver shared/lib/traer-todo.ts).
 * Ordenado por `fecha_venta` desc, al pasar las 1.000 ventas lo que se cae es
 * lo más VIEJO, y esta consulta la consumen el panel y /reportes — o sea que
 * el síntoma no iba a ser "faltan ventas en el historial" sino ingresos,
 * costo y ganancia calculados sobre un subconjunto, sin un error ni un log.
 * Es el mismo bug que ya se comió el catálogo el 12/8/2026, en la tabla que
 * mueve plata. Evens estaba en 629 al 2/9/2026.
 *
 * `desde` / `hasta` acotan por `fecha_venta` (ISO). Van SIN default a
 * propósito: los consumidores de hoy hacen su propio corte por período en
 * memoria y varios necesitan el historial entero (el CRM de /reportes mide
 * recencia y frecuencia; el panel compara contra el período anterior y contra
 * el día típico de la misma semana). Un default acá cambiaría números en
 * pantalla sin que nadie lo pidiera; que lo pase el que sabe qué ventana
 * necesita.
 */
export async function getVentasAction(opts?: {
  soloPropias?: boolean;
  desde?: string;
  hasta?: string;
}) {
  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    // El usuario se resuelve UNA vez, afuera de la fábrica de páginas: adentro
    // sería un viaje a auth por cada página que pida traerTodo.
    let vendedorId: string | null = null;
    if (opts?.soloPropias) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      vendedorId = user?.id ?? null;
    }

    // `filaDesde` / `filaHasta` son el rango de FILAS de la paginación; no
    // confundir con `opts.desde` / `opts.hasta`, que son fechas.
    const { data, error } = await traerTodo(
      "ventas (historial)",
      (filaDesde, filaHasta) => {
        let query = supabase
          .from("ventas")
          .select(
            `
        id,
        total,
        total_bruto,
        comision_total,
        total_neto,
        recargo_metodo_total,
        es_pago_mixto,
        precio_costo,
        cantidad,
        fecha_venta,
        estado_operacion,
        metodo_pago,
        monto_cobrado,
        monto_pendiente,
        monto_devuelto,
        base_devuelta,
        estado_pago,
        lista_precio_id,
        lista_precio_nombre,
        cliente_id,
        clientes(nombre),
        perfiles(nombre),
        ventas_items (
          cantidad,
          cantidad_devuelta,
          precio_unitario,
          precio_costo,
          variante,
          descuento_monto,
          precio_final,
          promocion_nombre,
          producto:productos(nombre, imagen_url, unidad_medida),
          unidad_serie:unidades_serie(id, imei, fecha_venta)
        ),
        ventas_descuentos (
          monto_descontado,
          promocion_nombre
        ),
        comprobantes (
          id,
          tipo,
          punto_venta,
          numero,
          cae,
          cae_vencimiento,
          fecha_comprobante,
          neto,
          iva_monto,
          exento,
          no_gravado,
          total,
          receptor_razon_social,
          receptor_doc_tipo,
          receptor_doc_nro,
          receptor_condicion_iva,
          arca_ambiente,
          comprobantes_iva ( alicuota_id, base_imponible, importe )
        ),
        venta_pagos (
          metodo_pago_id,
          metodo_nombre,
          metodo_tipo,
          monto_base,
          recargo_porcentaje,
          recargo_monto,
          monto_bruto,
          comision_porcentaje,
          comision_monto,
          monto_neto,
          acreditacion_dias,
          tipo_movimiento,
          estado_pago_operacion
        )
      `,
            { count: "exact" },
          )
          .order("fecha_venta", { ascending: false })
          // Desempate obligatorio: `traerTodo` pide las páginas EN PARALELO
          // cuando tiene el count, así que un orden ambiguo no devuelve las
          // filas desordenadas sino que DUPLICA unas y se saltea otras entre
          // páginas. Hoy no hay empates (935 ventas, 935 `fecha_venta`
          // distintas), pero dos cajas cerrando en el mismo microsegundo no
          // pueden decidir si un ticket se cuenta dos veces.
          .order("id", { ascending: false });

        if (vendedorId) query = query.eq("vendedor_id", vendedorId);
        if (opts?.desde) query = query.gte("fecha_venta", opts.desde);
        if (opts?.hasta) query = query.lte("fecha_venta", opts.hasta);

        return query.range(filaDesde, filaHasta);
      },
    );

    if (error) {
      console.error("Error fetching ventas:", error);
      return { data: null, error: "No se pudo cargar el historial de ventas." };
    }

    return { data, error: null };
  } catch (err) {
    console.error("Unexpected error in getVentasAction:", err);
    return {
      data: null,
      error: "Ocurrió un error inesperado al obtener las ventas.",
    };
  }
}

/**
 * Cobros de cuenta corriente: filas de venta_pagos SIN venta_id.
 *
 * Existe aparte de getVentasAction porque estos pagos no cuelgan de ninguna
 * venta y, por lo tanto, nunca llegaban a Reportes: la comisión que retiene
 * el procesador al cobrar una deuda con tarjeta se veía en el arqueo de Caja
 * pero no en el dashboard, sobreestimando la ganancia neta.
 *
 * Devuelve el bruto además de la comisión para que el desglose por método de
 * Reportes cierre contra el de Caja; el capital cobrado NO se suma a ingresos
 * (ver getDashboardMetrics: el ticket fiado ya computó su total).
 *
 * `desde` acota por `creado_en` (ISO), con el mismo criterio que
 * `getVentasAction`: sin default, que lo pase el que sabe qué ventana
 * necesita. El panel lo pasa; /reportes no, porque tiene "histórico".
 */
export async function getPagosCuentaCorrienteAction(opts?: { desde?: string }) {
  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    let query = supabase
      .from("venta_pagos")
      .select(
        "id, metodo_nombre, metodo_tipo, monto_base, recargo_porcentaje, recargo_monto, monto_bruto, comision_porcentaje, comision_monto, monto_neto, tipo_movimiento, estado_pago_operacion, creado_en",
      )
      .is("venta_id", null)
      .order("creado_en", { ascending: false });

    if (opts?.desde) query = query.gte("creado_en", opts.desde);

    const { data, error } = await query;

    if (error) {
      console.error("Error fetching pagos de cuenta corriente:", error);
      return {
        data: null,
        error: "No se pudieron cargar los cobros de deuda.",
      };
    }

    return { data, error: null };
  } catch (err) {
    console.error("Unexpected error in getPagosCuentaCorrienteAction:", err);
    return {
      data: null,
      error: "Ocurrió un error inesperado al obtener los cobros de deuda.",
    };
  }
}
