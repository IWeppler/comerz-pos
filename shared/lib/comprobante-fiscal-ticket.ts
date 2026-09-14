import { formatearNumeroComprobante } from "./facturacion";

/**
 * Lo que un comprobante FISCAL agrega al papel: letra, número, CAE, QR,
 * receptor identificado y desglose de IVA. Viaja dentro de `TicketData`
 * como `fiscal` y lo consumen los tres formatos (ticket térmico, PDF y
 * texto de WhatsApp) para que digan lo mismo.
 *
 * Es el MISMO dato tanto si sale del POS recién emitido como si se
 * reimprime desde el historial: en los dos casos se arma desde la fila de
 * `comprobantes`, que está congelada. Un comprobante emitido no cambia.
 */

export interface AlicuotaTicket {
  /** Porcentaje: 21, 10.5, 27. */
  alicuota: number;
  baseImponible: number;
  importe: number;
}

export interface ComprobanteFiscalTicket {
  /** FACTURA_A | FACTURA_B | FACTURA_C | NOTA_CREDITO_*. */
  tipo: string;
  puntoVenta: number;
  numero: number;
  cae: string;
  /** yyyy-mm-dd */
  caeVencimiento: string;
  /** yyyy-mm-dd: CbteFch, el día fiscal. */
  fechaComprobante: string;
  neto: number;
  ivaMonto: number;
  exento: number;
  noGravado: number;
  total: number;
  iva: AlicuotaTicket[];
  receptor: {
    razonSocial: string | null;
    /** 80 CUIT, 96 DNI, 99 consumidor final. */
    docTipo: number;
    docNro: string;
    condicionIva: string | null;
  };
  /** HOMOLOGACION = prueba, sin valor fiscal, y el papel lo tiene que decir. */
  ambiente: "HOMOLOGACION" | "PRODUCCION";
}

/** Código numérico de ARCA del tipo, el que se imprime como "COD. 006". */
const CODIGO_ARCA: Record<string, number> = {
  FACTURA_A: 1,
  FACTURA_B: 6,
  FACTURA_C: 11,
  NOTA_CREDITO_A: 3,
  NOTA_CREDITO_B: 8,
  NOTA_CREDITO_C: 13,
};

const LETRA: Record<string, string> = {
  FACTURA_A: "A",
  FACTURA_B: "B",
  FACTURA_C: "C",
  NOTA_CREDITO_A: "A",
  NOTA_CREDITO_B: "B",
  NOTA_CREDITO_C: "C",
};

export function letraComprobante(tipo: string): string {
  return LETRA[tipo] ?? "";
}

export function codigoArcaComprobante(tipo: string): string {
  const codigo = CODIGO_ARCA[tipo];
  return codigo ? String(codigo).padStart(3, "0") : "";
}

/** "FACTURA C", "NOTA DE CRÉDITO B". */
export function tituloComprobante(tipo: string): string {
  if (tipo.startsWith("NOTA_CREDITO")) return `NOTA DE CRÉDITO ${LETRA[tipo]}`;
  if (tipo.startsWith("FACTURA")) return `FACTURA ${LETRA[tipo]}`;
  return "COMPROBANTE";
}

export function numeroComprobanteFiscal(f: ComprobanteFiscalTicket): string {
  return formatearNumeroComprobante(f.puntoVenta, f.numero) ?? "";
}

/** dd/mm/yyyy desde yyyy-mm-dd, sin pasar por Date (no hay zona horaria que
 * corra el día). */
export function fechaCorta(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

export const ETIQUETA_DOC: Record<number, string> = {
  80: "CUIT",
  96: "DNI",
  99: "",
};

export function receptorTexto(f: ComprobanteFiscalTicket): string {
  const nombre = f.receptor.razonSocial?.trim() || "Consumidor Final";
  const etiqueta = ETIQUETA_DOC[f.receptor.docTipo];
  if (!etiqueta || f.receptor.docNro === "0") return nombre;
  return `${nombre} — ${etiqueta} ${f.receptor.docNro}`;
}

/** Solo la A discrimina el IVA en el papel. */
export function discriminaIvaEnPapel(tipo: string): boolean {
  return tipo === "FACTURA_A" || tipo === "NOTA_CREDITO_A";
}

/**
 * URL del QR obligatorio (RG 4892/2020): un JSON en base64 detrás de
 * `https://www.afip.gob.ar/fe/qr/`. Los campos y su orden son los del
 * anexo de la resolución; `tipoCodAut` es "E" porque acá siempre es CAE
 * (no CAEA).
 */
export function urlQrArca(
  f: ComprobanteFiscalTicket,
  cuitEmisor: string,
): string {
  const cuit = Number(cuitEmisor.replaceAll(/\D/g, ""));
  const datos: Record<string, unknown> = {
    ver: 1,
    fecha: f.fechaComprobante,
    cuit,
    ptoVta: f.puntoVenta,
    tipoCmp: CODIGO_ARCA[f.tipo] ?? 0,
    nroCmp: f.numero,
    importe: f.total,
    moneda: "PES",
    ctz: 1,
  };
  // Con receptor sin identificar, ARCA pide omitir los dos campos.
  if (f.receptor.docTipo !== 99) {
    datos.tipoDocRec = f.receptor.docTipo;
    datos.nroDocRec = Number(f.receptor.docNro);
  }
  datos.tipoCodAut = "E";
  datos.codAut = Number(f.cae);

  const json = JSON.stringify(datos);
  const base64 =
    typeof btoa === "function"
      ? btoa(json)
      : Buffer.from(json, "utf8").toString("base64");
  return `https://www.afip.gob.ar/fe/qr/?p=${base64}`;
}
