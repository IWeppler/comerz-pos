export interface OrdenCompra {
  id: string;
  proveedor: string;
  fecha_remito: string;
  total_presupuestado: number;
  estado: "PENDIENTE" | "APROBADA";
  creado_en: string;
}

export interface SugerenciaSimilitud {
  raw_nombre: string;
  producto_id: string;
  producto_nombre: string;
  categoria_id: string | null;
  marca: string | null;
  score: number;
}

export interface ItemResuelto {
  id?: string;
  orden_id?: string;
  producto_id: string | null;
  raw_nombre: string;
  raw_variante: string;
  raw_categoria?: string | null;
  raw_categoria_id?: string | null;
  raw_sku?: string | null;
  raw_marca?: string | null;
  raw_genero?: string | null;
  /** Número de serie que vino en el Excel para esta línea (electro). */
  raw_imei?: string | null;
  /** IMEI completados en la conciliación para los aparatos del renglón que
   * vinieron sin número (uno por unidad). Viajan a `aprobar_orden_compra`
   * como `imeis`; `raw_imei` no se toca. Ver `lib/imeis-remito.ts`. */
  imeis_completados?: string[];
  /** Marca deducida del nombre cuando el Excel no trae columna Marca
   * (`lib/inferir-marca.ts`). No pisa `raw_marca`, que es el dato crudo. */
  marca_inferida?: string | null;
  variante_match: string;
  /** Lo que facturó el proveedor. No se toca nunca. */
  cantidad: number;
  /** Lo que de verdad entró: null = lo del remito, 0 = no vino, otro número
   * = corregido en pantalla. Ver `features/purchases/lib/recepcion.ts`. */
  cantidad_recibida?: number | null;
  motivo_ajuste?: string | null;
  precio_costo: number;
  /** Lo que dijo la planilla del proveedor (columna precio_venta). Solo
   * siembra el precio de la conciliación; lo que se escribe es
   * precio_venta_actualizado. */
  precio_venta_sugerido?: number | null;
  precio_venta_actualizado?: number;
  estado_match:
    | "PERFECTO"
    | "MODIFICADO"
    | "DESCONOCIDO"
    | "NUEVO_ALIAS"
    | "RESUELTO";
}
