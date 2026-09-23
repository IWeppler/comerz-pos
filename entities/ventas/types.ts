import type { ComprobanteFiscalTicket } from "@/shared/lib/comprobante-fiscal-ticket";

export type SupabaseRelation<T> = T | T[] | null;

export const getSupabaseRelation = <T>(
  relation: SupabaseRelation<T> | undefined,
): T | null => {
  if (!relation) return null;
  return Array.isArray(relation) ? (relation[0] ?? null) : relation;
};

export interface VentaItem {
  id: string;
  venta_id: string;
  producto_id?: string | null;
  variante: string;
  cantidad: number;
  /** Unidades ya devueltas de este renglón. Ver 20260903160000. */
  cantidad_devuelta?: number;
  precio_unitario: number;
  precio_costo?: number;
  descuento_monto?: number;
  precio_final?: number;
  promocion_nombre?: string | null;
  /** Presentación congelada al vender. `cantidad` y precios históricos siguen
   * en unidad base; estos campos permiten reconstruir "1 Balde a $45.000". */
  presentacion_id?: string | null;
  presentacion_nombre?: string | null;
  factor?: number;
  cantidad_presentacion?: number | null;
  precio_presentacion?: number | null;
  /** Renglón cobrado sin producto (venta libre): `variante` es la
   * descripción tipeada. Ver `features/sales/lib/nombre-renglon.ts`. */
  es_venta_libre?: boolean | null;
  producto?: VentaProducto | null;
  /** Unidad física vendida en esta línea (IMEI / número de serie). Ausente
   * o null en todo lo que no es serializado, que es el caso normal. */
  unidad_serie?: {
    id: string;
    imei: string;
    fecha_venta?: string | null;
  } | null;
}

export interface VentaProducto {
  nombre?: string;
  tipo?: string;
  precio_costo?: number;
  /** Para reimprimir el ticket con la unidad correcta. Se lee del producto y
   * no de una columna congelada en el renglón: cambiar la unidad de venta de
   * un producto es tan raro, y tan claramente un error de carga cuando pasa,
   * que no justifica una columna más en `ventas_items`. */
  unidad_medida?: string | null;
}

export interface VentaDescuento {
  monto_descontado: number;
  promocion_nombre: string;
}

export interface VentaPago {
  id?: string;
  venta_id?: string;
  /** Turno de caja en el que entró el cobro. */
  turno_caja_id?: string | null;
  cliente_id?: string | null;
  metodo_pago_id?: string | null;
  metodo_nombre: string;
  metodo_tipo: string;
  /** Lo que el cobro imputa al ticket o a la deuda. */
  monto_base?: number;
  /** % de recargo por método, congelado al momento del cobro. */
  recargo_porcentaje?: number;
  recargo_monto?: number;
  /** Lo que efectivamente entró: monto_base + recargo_monto. */
  monto_bruto: number;
  comision_porcentaje?: number;
  comision_monto: number;
  monto_neto: number;
  acreditacion_dias: number;
  tipo_movimiento?: string; // 'PAGO_VENTA' | 'PAGO_CUENTA_CORRIENTE'
  estado_pago_operacion?: string;
  creado_en?: string;
  clientes?: SupabaseRelation<{ nombre: string }>;
}

export interface CreateSalePaymentInput {
  metodoPagoId: string;
  montoAsignado: number;
}

export type EstadoPagoVenta = "PAGADA" | "PARCIAL" | "PENDIENTE" | "ANULADA";
export type EstadoOperacionVenta = "CONFIRMADA" | "ANULADA";

/** Comprobante emitido por una venta. Es un array porque una venta puede
 * tener más de uno: la factura y, si se anula, su nota de crédito. */
export interface VentaComprobante {
  id?: string;
  tipo: string;
  punto_venta: number;
  numero: number;
  cae?: string | null;
  cae_vencimiento?: string | null;
  fecha_comprobante?: string | null;
  neto?: number | null;
  iva_monto?: number | null;
  exento?: number | null;
  no_gravado?: number | null;
  total?: number | null;
  receptor_razon_social?: string | null;
  receptor_doc_tipo?: number | null;
  receptor_doc_nro?: string | null;
  receptor_condicion_iva?: string | null;
  arca_ambiente?: string | null;
  comprobantes_iva?: {
    alicuota_id: number;
    base_imponible: number;
    importe: number;
  }[];
}

export interface Venta {
  id: string;
  cliente_id?: string | null;
  total: number;
  precio_costo: number;
  cantidad: number;
  fecha_venta: string;
  metodo_pago?: string | null;
  estado_operacion?: EstadoOperacionVenta | null;

  clientes?: SupabaseRelation<{ nombre?: string | null }>;
  monto_cobrado?: number | null;
  monto_pendiente?: number | null;
  estado_pago?: EstadoPagoVenta | null;

  perfiles?: {
    nombre: string;
  } | null;
  ventas_items?: VentaItem[];
  ventas_descuentos?: VentaDescuento[];
  venta_pagos?: VentaPago[];
  comprobantes?: VentaComprobante[];

  total_bruto?: number;
  comision_total?: number;
  total_neto?: number;
  /** Recargo por método ya incluido en `total`. Los reportes lo restan para
   * no contarlo como venta de mercadería. */
  recargo_metodo_total?: number;
  es_pago_mixto?: boolean;
  /** Lo devuelto de esta venta, con el recargo prorrateado. La venta sigue
   * CONFIRMADA: el ingreso neto es `total - monto_devuelto`. Ver
   * 20260903160000. */
  monto_devuelto?: number;
  /** De `monto_devuelto`, cuánto es mercadería. Lo que sobra es el recargo
   * prorrateado. Los reportes restan cada parte de donde la habían sumado. */
  base_devuelta?: number;
  /**
   * Con qué lista de precios se cobró. `null` = precio base, o venta
   * anterior a que existieran las listas — son dos cosas distintas y la
   * base no puede distinguirlas hacia atrás, así que no se inventa.
   *
   * El NOMBRE va congelado en la venta y no por join: la lista se puede
   * renombrar o borrar, y el historial tiene que seguir diciendo lo que
   * decía. Mismo criterio que los datos del receptor en `comprobantes`.
   */
  lista_precio_id?: string | null;
  lista_precio_nombre?: string | null;
}

export interface TicketItemData {
  nombre: string;
  variante: string;
  cantidad: number;
  precio?: number;
  precioUnitario?: number;
  /** IMEI / número de serie del aparato vendido. El ticket lo imprime
   * porque es el comprobante que el cliente presenta en una garantía. */
  imei?: string | null;
  /** Unidad en la que se vendió. Sin esto el ticket imprime "0.75x Jamón",
   * que no es una cantidad que alguien pueda controlar contra la balanza. */
  unidadMedida?: string | null;
  /** Si existe, `cantidad` y el precio del ticket están en esta presentación. */
  presentacionNombre?: string | null;
}

export interface TicketData {
  items: TicketItemData[];
  total: number;
  metodoPago: string;
  nroRecibo: string;
  fecha?: string;
  vendedor?: string;
  descuentoMonto?: number;
  promocionNombre?: string;
  /** Recargo por método de pago cobrado en este ticket. Ya está sumado en
   * `total`; se manda aparte para poder mostrarlo como renglón propio. */
  recargoMetodoMonto?: number;
  /** Ej. "Recargo Tarjeta (15%)". */
  recargoMetodoEtiqueta?: string;
  /**
   * Lista de precios con la que se cobró, si no fue el precio base.
   *
   * Ausente en el 100% de los tickets de hoy y en toda venta a precio de
   * siempre: imprimir "Minorista" en 1.072 tickets es ruido, mismo criterio
   * que `sufijoPrecioPorUnidad`, que tampoco escribe "/u." en una remera.
   */
  listaPrecioNombre?: string | null;
  comisionMonto?: number;
  montoNeto?: number;
  acreditacionDias?: number;
  // Desglose para pagos mixtos
  pagosDesglosados?: {
    nombre: string;
    monto: number;
    tipo?: string;
    comisionMonto?: number;
    montoNeto?: number;
    acreditacionDias?: number;
    tipoMovimiento?: string;
  }[];
  // Datos del Cliente (si fió)
  clienteNombre?: string;
  estadoPago?: string;
  montoCobrado?: number;
  montoPendiente?: number;
  esFiadoDirecto?: boolean;
  /** Presente SOLO si la venta salió con factura (CAE). Cambia el papel:
   * letra, número, emisor, receptor, IVA, CAE y QR. Ausente = ticket
   * interno, con su leyenda de "no válido como factura". */
  fiscal?: ComprobanteFiscalTicket | null;
}
