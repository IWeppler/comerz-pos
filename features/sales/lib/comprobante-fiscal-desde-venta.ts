import type { VentaComprobante } from "@/entities/ventas/types";
import type { ComprobanteFiscalTicket } from "@/shared/lib/comprobante-fiscal-ticket";
import { PORCENTAJE_ALICUOTA } from "@/features/arca/lib/codigos-arca";

/**
 * De la fila de `comprobantes` (como viene embebida en la venta) a lo que el
 * papel necesita. Devuelve null para TICKET o para una fila sin CAE: ahí el
 * ticket se imprime como interno, igual que siempre.
 *
 * Por defecto se toma el comprobante de EMISIÓN (la factura), no una nota de
 * crédito posterior: reimprimir una venta reimprime lo que salió al venderla.
 * Con `clase = "NOTA_CREDITO"` se toma la NC, para imprimirla aparte.
 */
export function fiscalDesdeComprobante(
  comprobantes: VentaComprobante[] | VentaComprobante | null | undefined,
  clase: "FACTURA" | "NOTA_CREDITO" = "FACTURA",
): ComprobanteFiscalTicket | null {
  const lista = Array.isArray(comprobantes)
    ? comprobantes
    : comprobantes
      ? [comprobantes]
      : [];
  const c = lista.find((x) => x.tipo?.startsWith(clase) && x.cae);
  if (!c || !c.cae || !c.cae_vencimiento || !c.fecha_comprobante) return null;

  return {
    tipo: c.tipo,
    puntoVenta: c.punto_venta,
    numero: c.numero,
    cae: c.cae,
    caeVencimiento: c.cae_vencimiento,
    fechaComprobante: c.fecha_comprobante,
    neto: Number(c.neto ?? 0),
    ivaMonto: Number(c.iva_monto ?? 0),
    exento: Number(c.exento ?? 0),
    noGravado: Number(c.no_gravado ?? 0),
    total: Number(c.total ?? 0),
    iva: (c.comprobantes_iva ?? []).map((a) => ({
      alicuota: PORCENTAJE_ALICUOTA[a.alicuota_id] ?? 0,
      baseImponible: Number(a.base_imponible),
      importe: Number(a.importe),
    })),
    receptor: {
      razonSocial: c.receptor_razon_social ?? null,
      docTipo: c.receptor_doc_tipo ?? 99,
      docNro: c.receptor_doc_nro ?? "0",
      condicionIva: c.receptor_condicion_iva ?? null,
    },
    ambiente: c.arca_ambiente === "PRODUCCION" ? "PRODUCCION" : "HOMOLOGACION",
  };
}
