/**
 * Qué se puede exportar para el contador, y qué TODAVÍA NO.
 *
 * La distinción es el corazón de este módulo, no un detalle de presentación.
 * Una exportación con nombre correcto y contenido vacío es peor que una que
 * no existe: el contador la abre, la ve vacía o incompleta, y asume que ese
 * es el estado del negocio. Un "Libro IVA Ventas" armado con tickets internos
 * como si fueran facturas es directamente información falsa firmada por el
 * comercio.
 *
 * Por eso cada exportación declara si tiene fuente de datos REAL hoy, y el
 * motivo cuando no la tiene. La UI muestra las dos, pero solo deja bajar las
 * que existen — y el motivo le explica al comerciante qué le falta para
 * habilitarla, que casi siempre es conectar ARCA.
 */

export type ClaveExportacion =
  | "libro_iva_ventas"
  | "libro_iva_compras"
  | "resumen_iva"
  | "ventas"
  | "compras"
  | "comprobantes"
  | "notas_credito"
  | "notas_debito"
  | "movimientos_caja"
  | "movimientos_generales";

export interface DefinicionExportacion {
  clave: ClaveExportacion;
  titulo: string;
  descripcion: string;
  /** Agrupa la lista en la UI. */
  grupo: "Impositivo" | "Operaciones" | "Dinero";
  /** Si hoy existe la fuente de datos para armarla con contenido real. */
  disponible: boolean;
  /** Por qué no, cuando no. Se le muestra al comerciante tal cual. */
  motivoNoDisponible?: string;
}

export const EXPORTACIONES: DefinicionExportacion[] = [
  // ---------------------------------------------------------------- Impositivo
  {
    clave: "libro_iva_ventas",
    titulo: "Libro IVA Ventas",
    descripcion:
      "Facturas y notas de crédito con CAE de producción, con el neto y el IVA abiertos por alícuota. Las notas de crédito van en negativo. Los tickets internos y las pruebas de homologación no entran.",
    grupo: "Impositivo",
    disponible: true,
  },
  {
    clave: "libro_iva_compras",
    titulo: "Libro IVA Compras",
    descripcion: "Facturas de proveedores con su crédito fiscal.",
    grupo: "Impositivo",
    disponible: false,
    // Este NO se destraba con ARCA: falta el dato en el origen.
    motivoNoDisponible:
      "Los remitos de proveedor no guardan CUIT, tipo de comprobante ni IVA: son remitos, no facturas de compra. Falta poder cargar la factura del proveedor.",
  },
  {
    clave: "resumen_iva",
    titulo: "Resumen de IVA",
    descripcion: "Débito fiscal, crédito fiscal y saldo del período.",
    grupo: "Impositivo",
    disponible: false,
    motivoNoDisponible:
      "Se calcula a partir de los dos libros de IVA. Va a estar disponible cuando ellos lo estén.",
  },

  // --------------------------------------------------------------- Operaciones
  {
    clave: "ventas",
    titulo: "Ventas",
    descripcion:
      "Todas las ventas del período con su detalle: importes, costo, medios de pago y vendedor.",
    grupo: "Operaciones",
    disponible: true,
  },
  {
    clave: "comprobantes",
    titulo: "Comprobantes emitidos",
    descripcion:
      "Los comprobantes con su numeración correlativa, receptor e importe.",
    grupo: "Operaciones",
    disponible: true,
  },
  {
    clave: "compras",
    titulo: "Compras (remitos)",
    descripcion:
      "Remitos de proveedor aprobados en el período, con su total. No reemplaza la factura de compra.",
    grupo: "Operaciones",
    disponible: true,
  },
  {
    clave: "notas_credito",
    titulo: "Notas de crédito",
    descripcion:
      "Las notas de crédito emitidas con CAE al anular una venta facturada, con la factura que compensan.",
    grupo: "Operaciones",
    disponible: true,
  },
  {
    clave: "notas_debito",
    titulo: "Notas de débito",
    descripcion: "Comprobantes que aumentan el importe de una factura.",
    grupo: "Operaciones",
    disponible: false,
    // No es solo que no se emitan: no existen como tipo en el sistema.
    motivoNoDisponible:
      "No están modeladas en el sistema todavía. Se suman junto con la facturación electrónica.",
  },

  // -------------------------------------------------------------------- Dinero
  {
    clave: "movimientos_caja",
    titulo: "Movimientos de caja",
    descripcion:
      "Aperturas y cierres de turno, con efectivo esperado, declarado y diferencia.",
    grupo: "Dinero",
    disponible: true,
  },
  {
    clave: "movimientos_generales",
    titulo: "Movimientos generales",
    descripcion:
      "Todo lo que movió plata: cobros por método, egresos y pagos de cuenta corriente.",
    grupo: "Dinero",
    disponible: true,
  },
];

export const GRUPOS_EXPORTACION = [
  "Impositivo",
  "Operaciones",
  "Dinero",
] as const;

export function exportacionesPorGrupo(
  grupo: DefinicionExportacion["grupo"],
): DefinicionExportacion[] {
  return EXPORTACIONES.filter((e) => e.grupo === grupo);
}

/** Fail-closed: una clave que no está en el catálogo NO se exporta. La action
 * la recibe del cliente, así que no puede confiar en ella. */
export function definicionDe(
  clave: unknown,
): DefinicionExportacion | undefined {
  return EXPORTACIONES.find((e) => e.clave === clave);
}

export function esExportable(clave: unknown): boolean {
  return definicionDe(clave)?.disponible === true;
}
