"use server";

import { createClient } from "@/shared/config/supabase/server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { resolverTurnoActivo } from "@/entities/caja/lib/resolve-turno-activo";
import { requiereNotaCredito } from "@/shared/lib/facturacion";
import { normalizarMotivoAnulacion } from "@/features/sales/lib/motivo-anulacion";
import { PERMISOS, tienePermiso } from "@/shared/lib/permisos";
import type { VentaComprobante } from "@/entities/ventas/types";
import { negocioActualId } from "@/features/arca/lib/credenciales";
import {
  emitirNotaCreditoArca,
  facturaACompensar,
} from "@/features/arca/lib/emitir-nota-credito";
import type { FacturaEmitida } from "@/features/arca/lib/emitir-factura";
import { formatearNumeroComprobante } from "@/shared/lib/facturacion";

export async function anularVentaAction(
  ventaId: string,
  /** A dónde va la mercadería. Es el DESTINO, no el motivo: son dos preguntas
   * distintas y hasta 20260903140000 compartían una columna. */
  motivoDevolucion: "RESTAURAR_STOCK" | "BAJA",
  /** Por qué se cae la venta. Lista cerrada, ver `motivo-anulacion.ts`. */
  motivoCodigo?: string | null,
  /** Una línea de detalle, sobre todo para OTRO. */
  motivoDetalle?: string | null,
) {
  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return { error: "No autorizado", success: false };

    // 1. Obtener TODOS los detalles de la venta y sus items antes de borrarla
    const { data: venta, error: fetchError } = await supabase
      .from("ventas")
      .select(
        `
        id,
        estado_operacion,
        monto_cobrado,
        monto_pendiente,
        cliente_id,
        ventas_items ( producto_id, variante, variante_id, cantidad ),
        comprobantes (
          id, tipo, punto_venta, numero, cae, cae_vencimiento, fecha_comprobante,
          neto, iva_monto, exento, no_gravado, total,
          receptor_razon_social, receptor_doc_tipo, receptor_doc_nro,
          receptor_condicion_iva, arca_ambiente,
          comprobantes_iva ( alicuota_id, base_imponible, importe )
        )
      `,
      )
      .eq("id", ventaId)
      .single();

    if (fetchError || !venta) {
      return { error: "No se encontró la venta solicitada.", success: false };
    }

    // 2. Anulación lógica: preservamos ticket, items, pagos y relaciones contables.
    if (venta.estado_operacion === "ANULADA") {
      return { error: "La venta ya se encuentra anulada.", success: false };
    }

    // Una FACTURA emitida no se anula marcando la venta: se compensa con una
    // nota de crédito, que es un comprobante propio con su CAE. Acá solo se
    // decide SI hace falta; se emite más abajo, después de los chequeos que
    // pueden frenar la anulación (caja, permiso), para no pedirle a ARCA una
    // NC que después no se registra. Con TICKET interno esto es null y anular
    // sigue funcionando igual que siempre.
    const comprobantes = (venta.comprobantes ?? []) as VentaComprobante[];
    const facturaOriginal = requiereNotaCredito(comprobantes)
      ? facturaACompensar(comprobantes)
      : null;
    if (requiereNotaCredito(comprobantes) && !facturaOriginal) {
      // Hay factura pero no se puede reconstruir (fila vieja sin datos): no
      // se inventa una NC.
      console.error("[ANULACION] Factura sin datos para la nota de crédito", {
        ventaId,
        comprobantes,
      });
      return {
        error:
          "Esta venta tiene una factura emitida y no se puede armar la nota de crédito automáticamente. Hacela en ARCA y avisá para anular a mano.",
        success: false,
      };
    }

    // La devolución en efectivo sale de la caja abierta AHORA (no de la
    // caja original de la venta, que puede estar cerrada hace rato).
    // Se resuelve antes de mutar nada para no dejar la anulación a medias
    // si la caja está cerrada y la política lo exige.
    let turnoDevolucionId: string | null = null;
    if (venta.monto_cobrado > 0) {
      const { turnoId, requiereCajaAbierta } = await resolverTurnoActivo(
        supabase,
        user.id,
      );
      if (requiereCajaAbierta && !turnoId) {
        return {
          error: "Necesitas abrir la caja antes de anular esta venta.",
          success: false,
        };
      }
      turnoDevolucionId = turnoId;
    }

    // 2ter. LA NOTA DE CRÉDITO, ANTES DE ANULAR
    //
    // Mismo orden que la factura en la venta: el CAE se pide primero y la
    // fila entra en la misma transacción que la anulación
    // (`anular_venta_facturada`). Si ARCA rechaza o no responde, la venta NO
    // se anula y el error llega a la pantalla. El permiso de anular se
    // chequea acá, antes de ir a ARCA: la RPC lo volvería a frenar, pero ya
    // con una NC emitida que nadie registró.
    let notaCredito: FacturaEmitida | null = null;
    if (facturaOriginal) {
      if (!(await tienePermiso(supabase, PERMISOS.VENTAS_ANULAR))) {
        return { error: "No tenés permiso para anular ventas.", success: false };
      }

      const [negocioId, { data: config }] = await Promise.all([
        negocioActualId(supabase),
        supabase
          .from("configuracion_pos")
          .select("cuit, condicion_iva, punto_venta")
          .single(),
      ]);
      if (!negocioId || !config?.cuit || !config.condicion_iva || !config.punto_venta) {
        return {
          error:
            "Para emitir la nota de crédito faltan el CUIT, la condición de IVA o el punto de venta del comercio.",
          success: false,
        };
      }

      try {
        notaCredito = await emitirNotaCreditoArca({
          negocioId,
          cuitEmisor: config.cuit,
          condicionIvaEmisor: config.condicion_iva,
          puntoVenta: config.punto_venta,
          factura: facturaOriginal,
        });
      } catch (e) {
        console.error("[ARCA] No se pudo emitir la nota de crédito; la venta no se anula", {
          ventaId,
          factura: facturaOriginal.id,
          error: e,
        });
        return {
          error: `No se pudo emitir la nota de crédito: ${(e as Error).message}`,
          success: false,
        };
      }
    }

    // 2bis. TODO EL MOVIMIENTO DE PLATA, EN UNA TRANSACCIÓN
    //
    // Estado de la venta, marcado de los cobros, egreso de caja y crédito de
    // cuenta corriente van juntos en la RPC. Antes eran cuatro escrituras
    // sueltas con dos errores adentro:
    //
    // - El egreso salía por `monto_cobrado` entero, sin mirar el medio de pago:
    //   una venta cobrada con débito sacaba efectivo de un cajón donde esa
    //   plata nunca estuvo, y el turno cerraba con faltante.
    // - El crédito de cuenta corriente usaba `monto_pendiente`, que quedó
    //   congelado en el momento de la venta. Si el cliente ya había pagado
    //   parte del fiado, se le perdonaba lo pagado.
    //
    // El guard de permiso sigue siendo el mismo y sigue yendo primero: la RPC
    // hace el UPDATE condicional y, si la RLS lo niega o la venta ya estaba
    // anulada, lanza sin haber tocado plata ni stock.
    const argumentosAnulacion = {
      p_venta_id: ventaId,
      p_motivo: motivoDevolucion,
      p_turno_id: turnoDevolucionId,
      // Fail-closed: un código que este código no conoce NO se manda. Que la
      // columna quede en null es la verdad ("no se sabe"); un valor
      // inventado ensucia la única medición que justifica el campo — cuántas
      // anulaciones son en realidad una venta mal cargada.
      p_motivo_codigo: normalizarMotivoAnulacion(motivoCodigo),
      p_motivo_detalle: motivoDetalle?.trim() || null,
    };

    const { data: resultadoAnulacion, error: anulacionError } =
      notaCredito && facturaOriginal
        ? await supabase.rpc("anular_venta_facturada", {
            ...argumentosAnulacion,
            p_comprobante: {
              tipo: notaCredito.tipo,
              punto_venta: notaCredito.puntoVenta,
              numero: notaCredito.numero,
              neto: notaCredito.desglose.neto,
              iva_monto: notaCredito.desglose.ivaMonto,
              exento: notaCredito.desglose.exento,
              no_gravado: notaCredito.desglose.noGravado,
              total: notaCredito.desglose.total,
              cae: notaCredito.cae,
              cae_vencimiento: notaCredito.caeVencimiento,
              fecha_comprobante: notaCredito.fechaComprobante,
              arca_ambiente: notaCredito.ambiente,
              arca_resultado: "A",
              arca_observaciones:
                notaCredito.observaciones.length > 0 ? notaCredito.observaciones : null,
              iva: notaCredito.iva.map((a) => ({
                id: a.id,
                base_imponible: a.baseImponible,
                importe: a.importe,
              })),
              anula_comprobante_id: facturaOriginal.id,
              emitido_por: user.id,
            },
          })
        : await supabase.rpc("anular_venta", argumentosAnulacion);

    if (anulacionError || !resultadoAnulacion) {
      console.error("[ANULACION] Error anulando la venta:", anulacionError);
      if (notaCredito) {
        // EL caso residual: la NC existe en ARCA y la venta sigue viva. Se
        // deja todo lo necesario para registrarla a mano.
        console.error("[ARCA] NOTA DE CREDITO EMITIDA SIN ANULACION", {
          ventaId,
          tipo: notaCredito.tipo,
          puntoVenta: notaCredito.puntoVenta,
          numero: notaCredito.numero,
          cae: notaCredito.cae,
          caeVencimiento: notaCredito.caeVencimiento,
          total: notaCredito.desglose.total,
          ambiente: notaCredito.ambiente,
          anulaComprobanteId: facturaOriginal?.id,
        });
      }
      const noAnulable = anulacionError?.message?.includes("VENTA_NO_ANULABLE");
      return {
        error: noAnulable
          ? "No se pudo anular: o ya estaba anulada, o no tenés permiso."
          : "Error de BD al intentar anular la venta.",
        success: false,
      };
    }

    const anulacion = resultadoAnulacion as {
      efectivo_devuelto: number;
      no_efectivo_a_devolver: number;
      /** Recargo por método que NO se reintegra: se lo quedó el banco. */
      recargo_no_devuelto: number;
      credito_aplicado: number;
      excedente_ya_pagado: number;
    };

    // 5. Manejo del Stock para TODOS los items del carrito de compras
    const items = venta.ventas_items || [];

    /** Renglones cuya mercadería volvió al local pero no se pudo sumar al
     * stock. No frena la anulación (la plata ya se movió), pero tiene que
     * llegar a la pantalla: es inventario que quedó sin contar. */
    const itemsSinRestaurar: string[] = [];

    for (const item of items) {
      if (!item.producto_id) continue;

      if (motivoDevolucion === "RESTAURAR_STOCK") {
        // La variante sale de `ventas_items.variante_id`, congelado en el
        // momento de la venta. Antes se buscaba por `nombre_display`, y eso
        // fallaba en silencio cada vez que el talle se había renombrado
        // después: 117 de los 1.032 renglones vendidos ya no matchean por
        // nombre, o sea que anular cualquiera de esas ventas devolvía el stock
        // a ningún lado. El match por nombre queda solo como respaldo para los
        // renglones viejos que el backfill no pudo resolver.
        let varianteId: string | null = item.variante_id ?? null;

        if (!varianteId) {
          const { data: porNombre } = await supabase
            .from("producto_variantes")
            .select("id")
            .eq("producto_id", item.producto_id)
            .eq("nombre_display", item.variante)
            .maybeSingle();
          varianteId = porNombre?.id ?? null;
        }

        if (varianteId) {
          // Delta atómico por la misma RPC que usa la venta para descontar.
          // Antes era leer el stock y después escribir la suma, que es el
          // patrón que ya costó plata dos veces en este proyecto: entre la
          // lectura y la escritura entra una venta de esa variante y el
          // update la pisa.
          const { error: stockError } = await supabase.rpc(
            "ajustar_stock_variante",
            {
              p_variante_id: varianteId,
              p_delta: item.cantidad,
              p_origen: "ANULACION_VENTA",
              p_referencia_id: ventaId,
            },
          );

          if (stockError) {
            console.error(
              `[ANULACION] No se pudo devolver el stock de "${item.variante}" (venta ${ventaId}):`,
              stockError,
            );
            itemsSinRestaurar.push(item.variante);
          }
        } else {
          // Sin variante no hay a qué devolverle el stock. Antes esto pasaba
          // sin dejar rastro; ahora se avisa, porque es mercadería que volvió
          // al local y no está contada en ningún lado.
          console.error(
            `[ANULACION] Renglón sin variante resoluble, stock NO devuelto: "${item.variante}" (venta ${ventaId})`,
          );
          itemsSinRestaurar.push(item.variante);
        }

        // Espejo legacy, también como delta y con la misma RPC de siempre no
        // disponible acá: se resuelve con un update condicional por la clave
        // única (producto_id, variante), que es atómico a nivel de fila.
        await supabase.rpc("ajustar_stock_legacy", {
          p_producto_id: item.producto_id,
          p_variante: item.variante,
          p_delta: item.cantidad,
        });
      } else if (motivoDevolucion === "BAJA") {
        // La planta volvió rota o seca
        await supabase.from("bajas").insert({
          producto_id: item.producto_id,
          variante: item.variante,
          cantidad: item.cantidad,
          motivo: "Devolución de cliente por producto fallado/roto",
          estado: "APROBADA",
          creado_por: user.id,
          origen: "DEVOLUCION_VENTA",
        });
      }
    }

    // 5.b Devolver los aparatos serializados (IMEI/serie) que salieron en
    // esta venta. Sin esto la unidad queda 'vendido' para siempre: el stock
    // de la variante se restaura arriba pero ese IMEI no se puede volver a
    // elegir en el POS, así que el aparato queda contado y no vendible.
    // Sigue el mismo motivo que el stock: RESTAURAR_STOCK lo devuelve a la
    // vitrina, BAJA lo saca de circulación.
    //
    // No corta la anulación si falla: para cuando llega acá la venta ya está
    // ANULADA y la plata ya salió de la caja. Devolver un error dejaría a la
    // vendedora reintentando sobre una venta ya anulada. Se loguea para
    // poder corregir la unidad a mano.
    const { error: unidadesError } = await supabase.rpc(
      "devolver_unidades_venta",
      {
        p_venta_id: ventaId,
        p_a_stock: motivoDevolucion === "RESTAURAR_STOCK",
      },
    );

    if (unidadesError) {
      console.error(
        `No se pudieron devolver las unidades serializadas de la venta ${ventaId}:`,
        unidadesError,
      );
    }

    // 6. Refrescamos todas las vistas
    revalidatePath("/");
    revalidatePath("/reportes");
    revalidatePath("/ventas");
    revalidatePath("/stock");
    revalidatePath("/caja");
    revalidatePath("/clientes");

    // Lo que la anulación NO resuelve sola tiene que llegar al mostrador. Son
    // tres cosas distintas y ninguna es un error: la venta se anuló bien.
    //
    // - `noEfectivo`: se cobró por tarjeta/transferencia, así que se devuelve
    //   por donde entró. La caja no lo toca.
    // - `yaPagado`: lo que el cliente ya había amortizado de ESTE fiado. No se
    //   devuelve solo porque los pagos de cuenta corriente no están imputados a
    //   una venta: la base no sabe cuánto de ese pago era de este ticket ni con
    //   qué medio se cobró. Adivinarlo sería mover plata por una suposición.
    // - `sinStock`: mercadería que volvió y no se pudo sumar al inventario.
    const avisos: string[] = [];

    if (anulacion.no_efectivo_a_devolver > 0) {
      avisos.push(
        `$${Math.round(anulacion.no_efectivo_a_devolver).toLocaleString("es-AR")} se cobraron por tarjeta o transferencia: devolvelos por ese medio, no salen de la caja.`,
      );
    }
    // Desde 20260903210000 la anulación devuelve la BASE de cada cobro, no el
    // bruto. Que la vendedora lo sepa importa: la clienta pagó $115.000 y
    // recibe $100.000, y si no se lo puede explicar, la diferencia la termina
    // poniendo el comercio para no discutir.
    if (anulacion.recargo_no_devuelto > 0) {
      avisos.push(
        `No se devolvieron $${Math.round(anulacion.recargo_no_devuelto).toLocaleString("es-AR")} de recargo por medio de pago: esa comisión se la quedó el banco y no la reintegra.`,
      );
    }
    if (anulacion.excedente_ya_pagado > 0) {
      avisos.push(
        `El cliente ya había pagado $${Math.round(anulacion.excedente_ya_pagado).toLocaleString("es-AR")} de esta cuenta. Eso hay que devolvérselo aparte.`,
      );
    }
    if (itemsSinRestaurar.length > 0) {
      avisos.push(
        `No se pudo devolver al stock: ${itemsSinRestaurar.join(", ")}. Cargalo a mano.`,
      );
    }
    if (notaCredito) {
      avisos.push(
        `Se emitió la nota de crédito ${formatearNumeroComprobante(notaCredito.puntoVenta, notaCredito.numero)} (CAE ${notaCredito.cae}). Entregásela al cliente junto con la devolución.`,
      );
    }

    return {
      error: null,
      success: true,
      efectivoDevuelto: anulacion.efectivo_devuelto,
      avisos,
    };
  } catch (err) {
    console.error("Error in anularVentaAction:", err);
    return {
      error: "Ocurrió un error inesperado al intentar anular.",
      success: false,
    };
  }
}
