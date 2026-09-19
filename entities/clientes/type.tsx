export type CondicionIVA = 
  | "Consumidor Final"
  | "Responsable Inscripto"
  | "Monotributo"
  | "Exento"
  | "Sujeto No Categorizado";

export interface Cliente {
  id: string;

  // --- DATOS COMERCIALES ---
  nombre: string; // Nombre de Pila
  telefono: string;
  email?: string | null;
  dni?: string | null; // Útil para Facturas B grandes a Consumidor Final
  /** Dirección de contacto/entrega. Existe para cualquier cliente, tenga o no
   * datos fiscales — es distinta del domicilio fiscal (`direccion`). */
  direccion_comercial?: string | null;

  // --- DATOS FISCALES ---
  razon_social?: string | null;
  cuit?: string | null;
  condicion_iva?: CondicionIVA | null;
  /** Domicilio fiscal: el que va impreso en la factura. */
  direccion?: string | null;
  provincia?: string | null;
  localidad?: string | null;
  codigo_postal?: string | null;

// --- DATOS OPERATIVOS ---
  notas?: string | null;
  activo: boolean;
  saldo_pendiente: number;
  reglas_credito: { limite?: number | null; [clave: string]: unknown };
  exceptuado_entrega_minima: boolean;
  fecha_vencimiento_deuda?: string | null;
  /**
   * Lista de precios SUGERIDA para este cliente. `null` = precio base.
   *
   * Es una sugerencia y no una orden, mismo criterio que `comprobante_defecto`:
   * el POS la propone al elegirlo y la vendedora puede cambiarla. Quien manda
   * en lo que se cobró es `ventas.lista_precio_id`, que queda congelado.
   */
  lista_precio_id?: string | null;
  creado_en: string;
}

export type TipoMovimientoCC = "DEBITO" | "CREDITO";

export interface CuentaCorrienteMovimiento {
  id: string;
  cliente_id: string;
  venta_id?: string | null;
  pago_id?: string | null;
  tipo: TipoMovimientoCC;
  monto: number;
  monto_recargo: number;
  descripcion?: string | null;
  creado_por?: string | null;
  creado_en: string;
  fecha_origen?: string | null;
  anulado?: boolean;
  anulado_en?: string | null;
  anulado_por?: string | null;
  /** Cobro de caja que originó el crédito. Solo viene hidratado en el detalle
   * del cliente; los movimientos manuales y las ventas no lo tienen. */
  pago?: CobroCuentaCorriente | CobroCuentaCorriente[] | null;
}

export interface CobroCuentaCorriente {
  id: string;
  metodo_pago_id?: string | null;
  metodo_nombre: string;
  metodo_tipo: string;
  monto_base: number;
  recargo_porcentaje: number;
  recargo_monto: number;
  monto_bruto: number;
  comision_monto: number;
  monto_neto: number;
  estado_pago_operacion: string;
  turno?: { estado: string } | { estado: string }[] | null;
}
