import type { SupabaseClient } from "@supabase/supabase-js";
import {
  PUNTO_VENTA_INTERNO_DEFAULT,
  parsePuntoVenta,
  type TipoComprobante,
} from "@/shared/lib/facturacion";
import {
  determinarComprobante,
  type NotaCredito,
  type TipoOperacion,
} from "@/shared/lib/determinar-comprobante";

export interface ConfigComprobante {
  modo_facturacion?: unknown;
  comprobante_defecto?: unknown;
  /** Condición de IVA del EMISOR (el comercio). */
  condicion_iva?: string | null;
  punto_venta?: number | null;
}

export interface DatosReceptor {
  cliente_id: string | null;
  receptor_razon_social: string | null;
  receptor_cuit: string | null;
  receptor_condicion_iva: string | null;
}

export interface EmitirComprobanteInput {
  ventaId: string;
  config: ConfigComprobante | null;
  receptor: DatosReceptor | null;
  /** Lo que efectivamente paga el cliente, recargos incluidos. Es el mismo
   * número que `ventas.total`: si difirieran, el comprobante diría una cosa y
   * el ticket otra. */
  total: number;
  emitidoPor: string;
  /** VENTA por defecto. DEVOLUCION emite la nota de crédito de la letra que
   * corresponda (hoy inalcanzable: requiere ARCA). */
  operacion?: TipoOperacion;
}

export interface ResultadoComprobante {
  ok: boolean;
  tipo: TipoComprobante | NotaCredito;
  numero: number | null;
  puntoVenta: number;
  /** Por qué se determinó ese comprobante. Para logs y para poder responder
   * "¿por qué esta venta salió B y no A?" sin reconstruirlo de memoria. */
  motivo: string;
}

/**
 * Registra el comprobante de una venta ya creada.
 *
 * POR QUÉ NO ABORTA LA VENTA SI FALLA
 *
 * Cuando esto corre, la venta ya está grabada, el stock descontado y la plata
 * cobrada. No hay transacción que abarque las dos cosas (create-sale.ts
 * escribe en pasos sueltos), así que un fallo acá deja dos opciones: revertir
 * una venta que ya ocurrió en el mostrador, o dejarla sin comprobante. Con
 * TICKET interno la segunda es claramente menos mala — el número de ticket no
 * cambia lo que pasó, y hacer rebotar una venta cobrada por eso sería el
 * incidente, no la protección.
 *
 * Por eso devuelve un resultado y NUNCA lanza. Falla ruidosamente en los logs
 * (`[COMPROBANTE]` como error) porque una venta sin comprobante es un hueco en
 * la contabilidad y tiene que poder encontrarse después.
 *
 * El día que ARCA emita de verdad, ESTA decisión hay que revisarla: una
 * factura no se puede entregar sin CAE, y ahí el orden correcto es pedir el
 * CAE ANTES de cerrar la venta, no después.
 */
export async function emitirComprobante(
  supabase: SupabaseClient,
  input: EmitirComprobanteInput,
): Promise<ResultadoComprobante> {
  // QUIÉN decide el comprobante: acá, en el server, cruzando emisor + receptor
  // + operación + configuración. El POS manda la venta, no el tipo de
  // comprobante — un comprobante elegido en el navegador es un comprobante que
  // se puede elegir con las DevTools abiertas.
  const { tipo, motivo } = determinarComprobante({
    modoFacturacion: input.config?.modo_facturacion,
    condicionIvaEmisor: input.config?.condicion_iva,
    condicionIvaReceptor: input.receptor?.receptor_condicion_iva,
    comprobanteDefecto: input.config?.comprobante_defecto,
    operacion: input.operacion,
  });

  // El TICKET interno va SIEMPRE en su serie propia, desacoplada del punto de
  // venta de ARCA (18/9/2026). Hasta acá tomaba el configurado, y eso mezclaba
  // dos cosas que tienen que verse distintas: cuando Estilo Bonito dio de alta
  // su punto 5 para facturar, los recibos internos pasaron a numerarse
  // "00005-…" — un papel que dice "punto de venta 5" con un número que en ARCA
  // no existe. El ticket es un recibo de control interno; el punto de venta es
  // de lo fiscal. Además, cada cambio de punto reiniciaba la serie (Estilo
  // Bonito pasó por 1 → 2 → 5 en dos días).
  //
  // El configurado queda para los comprobantes fiscales, que hoy no pasan por
  // acá (van por `registrar_venta_facturada` con el CAE ya pedido) pero
  // podrían el día que se emita algo fiscal sin ARCA en el medio.
  // parsePuntoVenta protege de un valor inválido colado por fuera del panel.
  const puntoVenta =
    tipo === "TICKET"
      ? PUNTO_VENTA_INTERNO_DEFAULT
      : (parsePuntoVenta(input.config?.punto_venta) ??
        PUNTO_VENTA_INTERNO_DEFAULT);

  const fallo = (etapa: string, error: unknown): ResultadoComprobante => {
    console.error("[COMPROBANTE] No se pudo emitir", {
      etapa,
      ventaId: input.ventaId,
      tipo,
      puntoVenta,
      error,
    });
    return { ok: false, tipo, numero: null, puntoVenta, motivo };
  };

  // UN solo viaje: la RPC numera y graba en la misma transacción.
  //
  // Antes eran dos —`siguiente_numero_comprobante` y después el insert— y los
  // paga TODA venta, incluidas las de un renglón: medido sobre una traza real,
  // 96 ms de numeración + 45 ms de insert ≈ 140 ms.
  //
  // El número lo sigue serializando el mismo `insert ... on conflict` con su
  // row lock, nunca un `max(numero) + 1`: dos cajas vendiendo a la vez leerían
  // el mismo. Y al ir todo en una transacción, si la escritura falla el número
  // se revierte con ella — antes quedaba consumido y dejaba un hueco.
  //
  // `neto` e `iva_monto` los fija la RPC en 0: solo la Factura A discrimina
  // IVA. En un ticket interno (y en B y C) el total ya viene con el impuesto
  // adentro, y partirlo acá sería inventar un desglose que el papel no dice.
  const { data: numero, error } = await supabase.rpc(
    "emitir_comprobante_venta",
    {
      p_venta_id: input.ventaId,
      p_tipo: tipo,
      p_punto_venta: puntoVenta,
      p_total: input.total,
      p_emitido_por: input.emitidoPor,
      p_cliente_id: input.receptor?.cliente_id ?? null,
      p_receptor_razon_social: input.receptor?.receptor_razon_social ?? null,
      p_receptor_cuit: input.receptor?.receptor_cuit ?? null,
      p_receptor_condicion_iva:
        input.receptor?.receptor_condicion_iva ?? null,
    },
  );

  if (error || numero == null) {
    return fallo("emision", error);
  }

  return { ok: true, tipo, numero: Number(numero), puntoVenta, motivo };
}
