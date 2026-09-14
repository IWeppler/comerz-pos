"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/config/supabase/server";
import { PERMISOS, tienePermiso } from "@/shared/lib/permisos";
import { emiteComprobanteFiscal, parsePuntoVenta } from "@/shared/lib/facturacion";
import { determinarComprobante } from "@/shared/lib/determinar-comprobante";
import type { ComprobanteFiscalTicket } from "@/shared/lib/comprobante-fiscal-ticket";
import {
  negocioActualId,
  tieneCredencialesListas,
} from "@/features/arca/lib/credenciales";
import {
  normalizarAmbiente,
  PORCENTAJE_ALICUOTA,
} from "@/features/arca/lib/codigos-arca";
import { emitirFacturaArca } from "@/features/arca/lib/emitir-factura";
import type { TipoFiscal } from "@/features/arca/lib/armar-factura";

/**
 * Factura una venta que ya está registrada y salió con ticket interno.
 *
 * Es el "decido después" del mostrador: la clienta vuelve y pide factura, o
 * la vendedora eligió ticket y la dueña quiere facturarla. Mismo camino que
 * la venta (determinar letra → CAE → registrar), con dos diferencias:
 *
 *  - La FECHA del comprobante es HOY, no la de la venta. ARCA exige que
 *    CbteFch no sea anterior a la del último comprobante autorizado, así que
 *    fechar para atrás rebota en cuanto haya una factura posterior. Se
 *    factura hoy una venta de ayer, que es lo que hace cualquier comercio.
 *  - Los importes salen de la venta CONGELADA (`ventas_items.precio_final`,
 *    recargos guardados, `ventas.total`), no del catálogo de hoy: la factura
 *    tiene que decir lo que se cobró.
 *
 * El permiso es `ventas.elegir_comprobante`: es la misma decisión que el
 * switch del POS, tomada más tarde.
 */
export async function facturarVentaAction(ventaId: string): Promise<
  | { success: true; fiscal: ComprobanteFiscalTicket; error: null }
  | { success: false; error: string }
> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "No autorizado." };

  if (!(await tienePermiso(supabase, PERMISOS.VENTAS_ELEGIR_COMPROBANTE))) {
    return { success: false, error: "No tenés permiso para facturar ventas." };
  }

  const [{ data: venta, error: errorVenta }, { data: config }] =
    await Promise.all([
      supabase
        .from("ventas")
        .select(
          `id, estado_operacion, total, recargo_cc_monto, cliente_id,
           ventas_items ( cantidad, precio_final, producto:productos(tratamiento_iva) ),
           venta_pagos ( recargo_monto, estado_pago_operacion ),
           comprobantes ( tipo, cae )`,
        )
        .eq("id", ventaId)
        .single(),
      supabase
        .from("configuracion_pos")
        .select(
          "modo_facturacion, comprobante_defecto, condicion_iva, punto_venta, arca_ambiente, cuit",
        )
        .single(),
    ]);

  if (errorVenta || !venta) {
    return { success: false, error: "No se encontró la venta." };
  }
  if (venta.estado_operacion !== "CONFIRMADA") {
    return { success: false, error: "Solo se factura una venta confirmada." };
  }
  const comprobantes = (venta.comprobantes ?? []) as { tipo: string; cae: string | null }[];
  if (comprobantes.some((c) => c.tipo.startsWith("FACTURA") && c.cae)) {
    return { success: false, error: "Esta venta ya tiene factura." };
  }

  if (!emiteComprobanteFiscal(config?.modo_facturacion)) {
    return {
      success: false,
      error: "El comercio no está en modo ARCA (Configuración → Facturación).",
    };
  }
  const ambiente = normalizarAmbiente(config?.arca_ambiente);
  const negocioId = await negocioActualId(supabase);
  const arcaConectado = negocioId
    ? await tieneCredencialesListas(negocioId, ambiente)
    : false;
  if (!arcaConectado) {
    return {
      success: false,
      error: "ARCA no está conectado: falta el certificado o venció.",
    };
  }
  const puntoVenta = parsePuntoVenta(config?.punto_venta);
  if (!puntoVenta || !config?.cuit || !config.condicion_iva) {
    return {
      success: false,
      error:
        "Faltan el punto de venta, el CUIT o la condición de IVA del comercio.",
    };
  }

  // Receptor, congelado en la fila igual que en la venta.
  let receptor: {
    cliente_id: string;
    receptor_razon_social: string | null;
    receptor_cuit: string | null;
    receptor_dni: string | null;
    receptor_condicion_iva: string | null;
  } | null = null;
  if (venta.cliente_id) {
    const { data: c } = await supabase
      .from("clientes")
      .select("nombre, razon_social, cuit, dni, condicion_iva")
      .eq("id", venta.cliente_id)
      .maybeSingle();
    receptor = {
      cliente_id: venta.cliente_id,
      receptor_razon_social: c?.razon_social || c?.nombre || null,
      receptor_cuit: c?.cuit ?? null,
      receptor_dni: c?.dni ?? null,
      receptor_condicion_iva: c?.condicion_iva ?? null,
    };
  }

  const decision = determinarComprobante({
    modoFacturacion: config.modo_facturacion,
    condicionIvaEmisor: config.condicion_iva,
    condicionIvaReceptor: receptor?.receptor_condicion_iva,
    comprobanteDefecto: config.comprobante_defecto,
    arcaConectado,
  });
  if (decision.tipo === "TICKET") {
    return { success: false, error: `No se puede facturar: ${decision.motivo}` };
  }

  // Recargo por método: solo los cobros vivos. El de cuenta corriente está
  // en la cabecera.
  const recargoMetodo = ((venta.venta_pagos ?? []) as { recargo_monto: number | null; estado_pago_operacion: string | null }[])
    .filter((p) => p.estado_pago_operacion !== "ANULADO")
    .reduce((acc, p) => acc + Number(p.recargo_monto ?? 0), 0);
  const recargos = recargoMetodo + Number(venta.recargo_cc_monto ?? 0);

  const renglones = ((venta.ventas_items ?? []) as {
    cantidad: number;
    precio_final: number;
    producto: { tratamiento_iva: string | null } | { tratamiento_iva: string | null }[] | null;
  }[]).map((i) => ({
    precioFinal: Number(i.precio_final),
    cantidad: Number(i.cantidad),
    tratamientoIva: Array.isArray(i.producto)
      ? i.producto[0]?.tratamiento_iva
      : i.producto?.tratamiento_iva,
  }));

  let factura;
  try {
    factura = await emitirFacturaArca({
      negocioId: negocioId!,
      ambiente,
      cuitEmisor: config.cuit,
      condicionIvaEmisor: config.condicion_iva,
      tipo: decision.tipo as TipoFiscal,
      puntoVenta,
      renglones,
      recargos,
      total: Number(venta.total),
      receptor: receptor
        ? {
            cuit: receptor.receptor_cuit,
            dni: receptor.receptor_dni,
            condicionIva: receptor.receptor_condicion_iva,
            razonSocial: receptor.receptor_razon_social,
          }
        : null,
      fecha: new Date(),
    });
  } catch (e) {
    console.error("[ARCA] No se pudo facturar la venta desde el historial", {
      ventaId,
      error: e,
    });
    return { success: false, error: `No se pudo facturar: ${(e as Error).message}` };
  }

  const { error: errorRegistro } = await supabase.rpc("registrar_factura_de_venta", {
    p_venta_id: ventaId,
    p_comprobante: {
      tipo: factura.tipo,
      punto_venta: factura.puntoVenta,
      numero: factura.numero,
      cliente_id: receptor?.cliente_id ?? null,
      receptor_razon_social: receptor?.receptor_razon_social ?? null,
      receptor_cuit: receptor?.receptor_cuit ?? null,
      receptor_condicion_iva: receptor?.receptor_condicion_iva ?? null,
      receptor_doc_tipo: factura.desglose.receptorDocTipo,
      receptor_doc_nro: factura.desglose.receptorDocNro,
      neto: factura.desglose.neto,
      iva_monto: factura.desglose.ivaMonto,
      exento: factura.desglose.exento,
      no_gravado: factura.desglose.noGravado,
      total: factura.desglose.total,
      cae: factura.cae,
      cae_vencimiento: factura.caeVencimiento,
      fecha_comprobante: factura.fechaComprobante,
      arca_ambiente: factura.ambiente,
      arca_resultado: "A",
      arca_observaciones:
        factura.observaciones.length > 0 ? factura.observaciones : null,
      iva: factura.iva.map((a) => ({
        id: a.id,
        base_imponible: a.baseImponible,
        importe: a.importe,
      })),
      emitido_por: user.id,
    },
  });

  if (errorRegistro) {
    // EL caso residual: CAE emitido y la fila no entró (doble click que
    // perdió la carrera, o venta anulada en el medio). Queda todo en el log
    // para registrarla o compensarla a mano.
    console.error("[ARCA] CAE EMITIDO SIN REGISTRAR (facturar desde historial)", {
      ventaId,
      tipo: factura.tipo,
      puntoVenta: factura.puntoVenta,
      numero: factura.numero,
      cae: factura.cae,
      caeVencimiento: factura.caeVencimiento,
      total: factura.desglose.total,
      ambiente: factura.ambiente,
      error: errorRegistro,
    });
    const yaFacturada = errorRegistro.message?.includes("VENTA_YA_FACTURADA");
    return {
      success: false,
      error: yaFacturada
        ? "Esta venta ya fue facturada por otra persona. Se emitió un CAE de más: avisá para compensarlo."
        : `Se emitió el CAE ${factura.cae} pero no se pudo registrar: ${errorRegistro.message}`,
    };
  }

  revalidatePath("/ventas");
  revalidatePath("/caja");

  return {
    success: true,
    error: null,
    fiscal: {
      tipo: factura.tipo,
      puntoVenta: factura.puntoVenta,
      numero: factura.numero,
      cae: factura.cae,
      caeVencimiento: factura.caeVencimiento,
      fechaComprobante: factura.fechaComprobante,
      neto: factura.desglose.neto,
      ivaMonto: factura.desglose.ivaMonto,
      exento: factura.desglose.exento,
      noGravado: factura.desglose.noGravado,
      total: factura.desglose.total,
      iva: factura.iva.map((a) => ({
        alicuota: PORCENTAJE_ALICUOTA[a.id] ?? 0,
        baseImponible: a.baseImponible,
        importe: a.importe,
      })),
      receptor: {
        razonSocial: receptor?.receptor_razon_social ?? null,
        docTipo: factura.desglose.receptorDocTipo,
        docNro: factura.desglose.receptorDocNro,
        condicionIva: receptor?.receptor_condicion_iva ?? null,
      },
      ambiente: factura.ambiente,
    },
  };
}
