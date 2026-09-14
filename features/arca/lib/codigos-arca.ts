import type { TipoComprobante } from "@/shared/lib/facturacion";
import type { NotaCredito } from "@/shared/lib/determinar-comprobante";
import type { TratamientoIva } from "@/shared/lib/fiscal-producto";

/**
 * Tablas de códigos de ARCA para WSFEv1. Son las de la documentación oficial
 * (FEParamGetTiposCbte, FEParamGetTiposIva, FEParamGetTiposDoc,
 * FEParamGetCondicionIvaReceptor) y NO cambian por comercio, así que van como
 * constantes y no en la base.
 *
 * El vocabulario de Comerz (FACTURA_B, GRAVADO_21, "Monotributo") se traduce
 * acá y en ningún otro lado. Si ARCA agrega un código, se agrega acá.
 */

export type AmbienteArca = "HOMOLOGACION" | "PRODUCCION";

export const AMBIENTES_ARCA: readonly AmbienteArca[] = [
  "HOMOLOGACION",
  "PRODUCCION",
] as const;

export function normalizarAmbiente(valor: unknown): AmbienteArca {
  // Fail-closed hacia HOMOLOGACION: un valor desconocido nunca puede terminar
  // pidiendo un CAE real.
  return valor === "PRODUCCION" ? "PRODUCCION" : "HOMOLOGACION";
}

export const URLS_ARCA: Record<
  AmbienteArca,
  { wsaa: string; wsfe: string }
> = {
  HOMOLOGACION: {
    wsaa: "https://wsaahomo.afip.gov.ar/ws/services/LoginCms",
    wsfe: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx",
  },
  PRODUCCION: {
    wsaa: "https://wsaa.afip.gov.ar/ws/services/LoginCms",
    wsfe: "https://servicios1.afip.gov.ar/wsfev1/service.asmx",
  },
};

/** Servicio que se pide en el TRA del WSAA. */
export const SERVICIO_WSFE = "wsfe";

/** Tipo de comprobante de ARCA (CbteTipo). */
export const CBTE_TIPO: Record<TipoComprobante | NotaCredito, number | null> = {
  TICKET: null,
  FACTURA_A: 1,
  FACTURA_B: 6,
  FACTURA_C: 11,
  NOTA_CREDITO_A: 3,
  NOTA_CREDITO_B: 8,
  NOTA_CREDITO_C: 13,
};

/**
 * Alícuotas de IVA (Id de FEParamGetTiposIva). El 0% (id 3) existe pero NO se
 * usa para exento ni no gravado: esos van en ImpOpEx e ImpTotConc
 * respectivamente, no en el array de IVA.
 */
export const ALICUOTA_ID: Record<
  Exclude<TratamientoIva, "EXENTO" | "NO_GRAVADO">,
  number
> = {
  GRAVADO_105: 4,
  GRAVADO_21: 5,
  GRAVADO_27: 6,
};

export const PORCENTAJE_ALICUOTA: Record<number, number> = {
  4: 10.5,
  5: 21,
  6: 27,
};

/** Tipos de documento del receptor (FEParamGetTiposDoc). */
export const DOC_TIPO = {
  CUIT: 80,
  DNI: 96,
  CONSUMIDOR_FINAL: 99,
} as const;

/**
 * Condición frente al IVA del receptor (RG 5616/2024, obligatoria desde 2025).
 * Los ids son los de FEParamGetCondicionIvaReceptor.
 */
export const CONDICION_IVA_RECEPTOR_ID: Record<string, number> = {
  "Responsable Inscripto": 1,
  Exento: 4,
  "Consumidor Final": 5,
  Monotributo: 6,
};

/** Consumidor final cuando el receptor no dice nada. */
export const CONDICION_IVA_RECEPTOR_DEFAULT = 5;

/** Concepto 1 = Productos. Comerz vende mercadería; servicios no entran hoy. */
export const CONCEPTO_PRODUCTOS = 1;

export const MONEDA_PESOS = "PES";

/**
 * Tope para consumidor final sin identificar (RG 5616, art. 2). Por encima
 * hay que identificar al comprador con DNI o CUIT: ARCA rechaza la factura
 * si DocTipo es 99 y el importe lo supera. El número lo actualiza ARCA por
 * resolución; cuando cambie se cambia acá.
 */
export const TOPE_CONSUMIDOR_FINAL_SIN_IDENTIFICAR = 10_000_000;

/** Formato yyyymmdd que pide CbteFch, en hora de Argentina. */
export function fechaArca(fecha: Date): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(fecha);
  return partes.replaceAll("-", "");
}

/** De yyyymmdd a yyyy-mm-dd (lo que devuelve ARCA en CAEFchVto y CbteFch). */
export function fechaArcaAIso(valor: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(valor.trim());
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}
