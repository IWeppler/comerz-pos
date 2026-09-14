import type { TipoComprobante } from "@/shared/lib/facturacion";
import type { NotaCredito } from "@/shared/lib/determinar-comprobante";
import { normalizarTratamientoIva } from "@/shared/lib/fiscal-producto";
import {
  ALICUOTA_ID,
  CBTE_TIPO,
  CONCEPTO_PRODUCTOS,
  CONDICION_IVA_RECEPTOR_DEFAULT,
  CONDICION_IVA_RECEPTOR_ID,
  DOC_TIPO,
  MONEDA_PESOS,
  PORCENTAJE_ALICUOTA,
  TOPE_CONSUMIDOR_FINAL_SIN_IDENTIFICAR,
  fechaArca,
} from "./codigos-arca";

/**
 * Arma el pedido de CAE (FECAESolicitar) a partir de la venta.
 *
 * Es PURA: recibe renglones, recargos, receptor y fecha ya resueltos y
 * devuelve el request más el desglose que se guarda en `comprobantes` /
 * `comprobantes_iva`. Así la aritmética fiscal —que es la parte que ARCA
 * rechaza sin explicar mucho— se testea entera sin red y sin base.
 *
 * LA CUENTA, que tiene dos trampas:
 *
 * 1. Los precios de Comerz son CON IVA INCLUIDO (es lo que se cobra en el
 *    mostrador). El neto sale de `precio / (1 + alícuota)`, nunca de
 *    `precio - precio * alícuota` — ver `desglosarIva`.
 *
 * 2. ARCA exige que `ImpTotal = ImpTotConc + ImpNeto + ImpOpEx + ImpIVA +
 *    ImpTrib` al centavo, y que cada `Iva[].Importe` sea `BaseImp × alícuota`
 *    redondeado. Redondear cada alícuota por separado y sumar puede dar un
 *    centavo de más o de menos contra `ventas.total`, que es el número que
 *    el ticket ya le mostró a la clienta. La diferencia se absorbe en el
 *    IVA de la alícuota más grande: la factura tiene que decir EXACTAMENTE
 *    lo que se cobró. Si la diferencia pasa de $0,05 no es redondeo, es un
 *    bug, y se falla en vez de inventar un número.
 *
 * Quién discrimina: solo el responsable inscripto (A y B). Monotributo y
 * exento emiten C con `ImpNeto = total` e `ImpIVA = 0`, sin array de IVA —
 * es lo que ARCA espera para la C y lo que dice el papel.
 *
 * LOS RECARGOS (por método de pago y por cuenta corriente) van GRAVADOS AL
 * 21% en las facturas A y B. Es la lectura estándar para un recargo
 * financiero facturado junto con la venta, pero es una decisión fiscal y hay
 * que confirmarla con el contador antes de facturar en PRODUCCION. Está
 * aislada en `TRATAMIENTO_IVA_RECARGOS` para que cambiarla sea una línea.
 */

export const TRATAMIENTO_IVA_RECARGOS = "GRAVADO_21" as const;

/** Diferencia de redondeo tolerada entre la suma fiscal y `ventas.total`. */
export const TOLERANCIA_REDONDEO = 0.05;

export type TipoFiscal = Exclude<TipoComprobante, "TICKET"> | NotaCredito;

export interface RenglonFiscal {
  /** Precio UNITARIO ya con descuento del renglón, IVA incluido
   * (`ventas_items.precio_final`). */
  precioFinal: number;
  cantidad: number;
  /** `productos.tratamiento_iva`. Desconocido cae a GRAVADO_21. */
  tratamientoIva: unknown;
}

export interface ReceptorFiscal {
  cuit: string | null;
  dni: string | null;
  condicionIva: string | null;
  razonSocial: string | null;
}

export interface ComprobanteAsociado {
  tipo: TipoFiscal;
  puntoVenta: number;
  numero: number;
  /** yyyy-mm-dd */
  fecha: string;
}

export interface EntradaFactura {
  tipo: TipoFiscal;
  puntoVenta: number;
  numero: number;
  /** `configuracion_pos.condicion_iva` del comercio. */
  emisorCondicionIva: string;
  emisorCuit: string;
  renglones: RenglonFiscal[];
  /** Recargo por método + recargo de cuenta corriente, IVA incluido. */
  recargos: number;
  /** `ventas.total`: lo que se cobró. La factura tiene que cerrar contra esto. */
  total: number;
  receptor: ReceptorFiscal | null;
  fecha: Date;
  /** Solo notas de crédito: la factura que compensan. */
  comprobantesAsociados?: ComprobanteAsociado[];
  /**
   * Desglose YA CALCULADO, para una nota de crédito que anula una factura
   * entera: se copian los importes congelados de la factura original en vez
   * de recalcularlos desde los renglones. Recalcular podría dar un centavo
   * distinto por redondeo, y ARCA exige que la NC compense exactamente lo
   * facturado. Con esto puesto, `renglones` y `recargos` se ignoran.
   */
  desgloseFijo?: Omit<DesgloseFiscal, "receptorDocTipo" | "receptorDocNro">;
}

export interface AlicuotaIva {
  id: number;
  baseImponible: number;
  importe: number;
}

/** Lo que va en el XML de FECAESolicitar (FECAEDetRequest). */
export interface SolicitudCae {
  cbteTipo: number;
  puntoVenta: number;
  concepto: number;
  docTipo: number;
  docNro: string;
  numero: number;
  fecha: string;
  impTotal: number;
  impTotConc: number;
  impNeto: number;
  impOpEx: number;
  impIva: number;
  impTrib: number;
  moneda: string;
  cotizacion: number;
  condicionIvaReceptorId: number;
  iva: AlicuotaIva[];
  comprobantesAsociados: Array<{
    tipo: number;
    puntoVenta: number;
    numero: number;
    fecha: string;
  }>;
}

/** Lo que se guarda en `comprobantes` (importes) y `comprobantes_iva`. */
export interface DesgloseFiscal {
  neto: number;
  ivaMonto: number;
  exento: number;
  noGravado: number;
  total: number;
  iva: AlicuotaIva[];
  receptorDocTipo: number;
  receptorDocNro: string;
}

export class ErrorFactura extends Error {
  constructor(
    public readonly codigo:
      | "TIPO_NO_FISCAL"
      | "RECEPTOR_SIN_CUIT"
      | "RECEPTOR_NO_IDENTIFICADO"
      | "TOTAL_NO_CIERRA"
      | "SIN_RENGLONES",
    mensaje: string,
  ) {
    super(mensaje);
    this.name = "ErrorFactura";
  }
}

const redondear = (n: number) => Math.round(n * 100) / 100;

function discriminaIva(emisorCondicionIva: string): boolean {
  return emisorCondicionIva === "Responsable Inscripto";
}

function esLetraA(tipo: TipoFiscal): boolean {
  return tipo === "FACTURA_A" || tipo === "NOTA_CREDITO_A";
}

function soloDigitos(valor: string | null): string {
  return (valor ?? "").replaceAll(/\D/g, "");
}

function resolverReceptor(
  tipo: TipoFiscal,
  receptor: ReceptorFiscal | null,
  total: number,
): { docTipo: number; docNro: string; condicionIvaReceptorId: number } {
  const cuit = soloDigitos(receptor?.cuit ?? null);
  const dni = soloDigitos(receptor?.dni ?? null);

  // La A discrimina IVA para que el receptor lo compute: sin CUIT no hay a
  // quién. `determinarComprobante` ya elige A solo para RI, pero un RI cargado
  // sin CUIT existe, y ARCA lo rechaza con menos claridad que esto.
  if (esLetraA(tipo) && cuit.length !== 11) {
    throw new ErrorFactura(
      "RECEPTOR_SIN_CUIT",
      "Para emitir Factura A el cliente tiene que tener CUIT cargado.",
    );
  }

  let docTipo: number = DOC_TIPO.CONSUMIDOR_FINAL;
  let docNro = "0";
  if (cuit.length === 11) {
    docTipo = DOC_TIPO.CUIT;
    docNro = cuit;
  } else if (dni.length >= 7 && dni.length <= 8) {
    docTipo = DOC_TIPO.DNI;
    docNro = dni;
  }

  if (
    docTipo === DOC_TIPO.CONSUMIDOR_FINAL &&
    total > TOPE_CONSUMIDOR_FINAL_SIN_IDENTIFICAR
  ) {
    throw new ErrorFactura(
      "RECEPTOR_NO_IDENTIFICADO",
      `Una venta de más de $${TOPE_CONSUMIDOR_FINAL_SIN_IDENTIFICAR.toLocaleString("es-AR")} necesita identificar al cliente con DNI o CUIT.`,
    );
  }

  const condicionIvaReceptorId =
    (receptor?.condicionIva
      ? CONDICION_IVA_RECEPTOR_ID[receptor.condicionIva]
      : undefined) ?? CONDICION_IVA_RECEPTOR_DEFAULT;

  return { docTipo, docNro, condicionIvaReceptorId };
}

export function armarFactura(entrada: EntradaFactura): {
  solicitud: SolicitudCae;
  desglose: DesgloseFiscal;
} {
  const cbteTipo = CBTE_TIPO[entrada.tipo];
  if (cbteTipo == null) {
    throw new ErrorFactura(
      "TIPO_NO_FISCAL",
      `${entrada.tipo} no es un comprobante fiscal.`,
    );
  }
  if (entrada.renglones.length === 0 && !entrada.desgloseFijo) {
    throw new ErrorFactura("SIN_RENGLONES", "La factura no tiene renglones.");
  }

  const total = redondear(entrada.total);
  const receptor = resolverReceptor(entrada.tipo, entrada.receptor, total);

  let impTotConc = 0;
  let impOpEx = 0;
  let impNeto = 0;
  let impIva = 0;
  let iva: AlicuotaIva[] = [];

  if (entrada.desgloseFijo) {
    const d = entrada.desgloseFijo;
    impNeto = redondear(d.neto);
    impIva = redondear(d.ivaMonto);
    impOpEx = redondear(d.exento);
    impTotConc = redondear(d.noGravado);
    iva = d.iva.map((a) => ({
      id: a.id,
      baseImponible: redondear(a.baseImponible),
      importe: redondear(a.importe),
    }));
    const suma = redondear(impTotConc + impNeto + impOpEx + impIva);
    if (Math.abs(redondear(total - suma)) > TOLERANCIA_REDONDEO) {
      throw new ErrorFactura(
        "TOTAL_NO_CIERRA",
        `El desglose (${suma}) no coincide con el total (${total}).`,
      );
    }
  } else if (discriminaIva(entrada.emisorCondicionIva)) {
    // Bruto por tratamiento, ANTES de redondear: sumar primero y partir
    // después evita acumular un centavo por renglón.
    const brutoPorAlicuota = new Map<number, number>();
    const sumar = (tratamiento: unknown, importe: number) => {
      const t = normalizarTratamientoIva(tratamiento);
      if (t === "EXENTO") {
        impOpEx += importe;
        return;
      }
      if (t === "NO_GRAVADO") {
        impTotConc += importe;
        return;
      }
      const id = ALICUOTA_ID[t];
      brutoPorAlicuota.set(id, (brutoPorAlicuota.get(id) ?? 0) + importe);
    };

    for (const r of entrada.renglones) {
      sumar(r.tratamientoIva, r.precioFinal * r.cantidad);
    }
    if (entrada.recargos > 0) {
      sumar(TRATAMIENTO_IVA_RECARGOS, entrada.recargos);
    }

    impOpEx = redondear(impOpEx);
    impTotConc = redondear(impTotConc);

    iva = [...brutoPorAlicuota.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([id, bruto]) => {
        const alicuota = PORCENTAJE_ALICUOTA[id];
        const baseImponible = redondear(bruto / (1 + alicuota / 100));
        // El importe sale del bruto y no de `base × alícuota` para que el
        // total cierre; ARCA tolera la diferencia de centavo entre uno y otro.
        const importe = redondear(bruto - baseImponible);
        return { id, baseImponible, importe };
      });

    impNeto = redondear(iva.reduce((acc, a) => acc + a.baseImponible, 0));
    impIva = redondear(iva.reduce((acc, a) => acc + a.importe, 0));

    // Cerrar contra lo cobrado. Ver el comentario de arriba.
    const suma = redondear(impTotConc + impNeto + impOpEx + impIva);
    const diferencia = redondear(total - suma);
    if (Math.abs(diferencia) > TOLERANCIA_REDONDEO) {
      throw new ErrorFactura(
        "TOTAL_NO_CIERRA",
        `La suma fiscal ($${suma}) no coincide con el total cobrado ($${total}).`,
      );
    }
    if (diferencia !== 0) {
      if (iva.length > 0) {
        const mayor = iva.reduce((a, b) =>
          b.baseImponible > a.baseImponible ? b : a,
        );
        mayor.importe = redondear(mayor.importe + diferencia);
        impIva = redondear(impIva + diferencia);
      } else if (impOpEx > 0) {
        impOpEx = redondear(impOpEx + diferencia);
      } else {
        impTotConc = redondear(impTotConc + diferencia);
      }
    }
  } else {
    // Factura C: no discrimina. Todo es neto, sin IVA.
    impNeto = total;
  }

  const solicitud: SolicitudCae = {
    cbteTipo,
    puntoVenta: entrada.puntoVenta,
    concepto: CONCEPTO_PRODUCTOS,
    docTipo: receptor.docTipo,
    docNro: receptor.docNro,
    numero: entrada.numero,
    fecha: fechaArca(entrada.fecha),
    impTotal: total,
    impTotConc,
    impNeto,
    impOpEx,
    impIva,
    impTrib: 0,
    moneda: MONEDA_PESOS,
    cotizacion: 1,
    condicionIvaReceptorId: receptor.condicionIvaReceptorId,
    iva,
    comprobantesAsociados: (entrada.comprobantesAsociados ?? []).map((c) => ({
      tipo: CBTE_TIPO[c.tipo] as number,
      puntoVenta: c.puntoVenta,
      numero: c.numero,
      fecha: c.fecha.replaceAll("-", ""),
    })),
  };

  return {
    solicitud,
    desglose: {
      neto: impNeto,
      ivaMonto: impIva,
      exento: impOpEx,
      noGravado: impTotConc,
      total,
      iva,
      receptorDocTipo: receptor.docTipo,
      receptorDocNro: receptor.docNro,
    },
  };
}
