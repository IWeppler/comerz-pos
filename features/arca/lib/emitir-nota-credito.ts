import type { VentaComprobante } from "@/entities/ventas/types";
import { normalizarAmbiente } from "./codigos-arca";
import { emitirFacturaArca, type FacturaEmitida } from "./emitir-factura";
import type { ReceptorFiscal, TipoFiscal } from "./armar-factura";

/**
 * Nota de crédito que anula UNA factura entera.
 *
 * Todo sale de la fila congelada de `comprobantes` de la factura original:
 * importes, desglose de IVA, receptor. No se recalcula nada desde la venta,
 * porque la NC tiene que compensar EXACTAMENTE lo que la factura dijo, al
 * centavo, y un recálculo puede diferir por redondeo. `CbtesAsoc` apunta a la
 * factura, que es lo que ARCA exige para una NC.
 *
 * Misma letra que la factura (`NOTA_CREDITO_DE`): una A se compensa con NC A.
 */

const NOTA_CREDITO_DE: Record<string, TipoFiscal> = {
  FACTURA_A: "NOTA_CREDITO_A",
  FACTURA_B: "NOTA_CREDITO_B",
  FACTURA_C: "NOTA_CREDITO_C",
};

export function facturaACompensar(
  comprobantes: VentaComprobante[] | null | undefined,
): VentaComprobante | null {
  const lista = comprobantes ?? [];
  const factura = lista.find((c) => c.tipo?.startsWith("FACTURA") && c.cae);
  if (!factura) return null;
  // Ya compensada: hay una NC posterior.
  const yaTieneNc = lista.some((c) => c.tipo?.startsWith("NOTA_CREDITO"));
  return yaTieneNc ? null : factura;
}

export async function emitirNotaCreditoArca(datos: {
  negocioId: string;
  cuitEmisor: string;
  condicionIvaEmisor: string;
  puntoVenta: number;
  factura: VentaComprobante;
}): Promise<FacturaEmitida> {
  const f = datos.factura;
  const tipo = NOTA_CREDITO_DE[f.tipo];
  if (!tipo || !f.fecha_comprobante) {
    throw new Error(`No se puede emitir nota de crédito de ${f.tipo}.`);
  }

  const receptor: ReceptorFiscal = {
    cuit: f.receptor_doc_tipo === 80 ? (f.receptor_doc_nro ?? null) : null,
    dni: f.receptor_doc_tipo === 96 ? (f.receptor_doc_nro ?? null) : null,
    condicionIva: f.receptor_condicion_iva ?? null,
    razonSocial: f.receptor_razon_social ?? null,
  };

  return emitirFacturaArca({
    negocioId: datos.negocioId,
    // La NC va al MISMO ambiente que la factura: una factura de homologación
    // se compensa en homologación aunque el comercio ya esté en producción.
    ambiente: normalizarAmbiente(f.arca_ambiente),
    cuitEmisor: datos.cuitEmisor,
    condicionIvaEmisor: datos.condicionIvaEmisor,
    tipo,
    puntoVenta: datos.puntoVenta,
    renglones: [],
    recargos: 0,
    total: Number(f.total ?? 0),
    receptor,
    fecha: new Date(),
    comprobantesAsociados: [
      {
        tipo: f.tipo as TipoFiscal,
        puntoVenta: f.punto_venta,
        numero: f.numero,
        fecha: f.fecha_comprobante,
      },
    ],
    desgloseFijo: {
      neto: Number(f.neto ?? 0),
      ivaMonto: Number(f.iva_monto ?? 0),
      exento: Number(f.exento ?? 0),
      noGravado: Number(f.no_gravado ?? 0),
      total: Number(f.total ?? 0),
      iva: (f.comprobantes_iva ?? []).map((a) => ({
        id: a.alicuota_id,
        baseImponible: Number(a.base_imponible),
        importe: Number(a.importe),
      })),
    },
  });
}
