export interface Movimiento {
  id: string;
  tipo: "INGRESO" | "EGRESO";
  descripcion: string;
  concepto: string;
  metodo: string;
  monto: number;
  fecha: string;
  usuario: string;
  creado_en: string;
}

export interface CajaActionState {
  error: string | null;
  success: boolean;
}

export interface TurnoCajaHistorial {
  id: string;
  vendedor_id?: string | null;
  modo?: string | null;
  monto_inicial: number | string;
  monto_final: number | string | null;
  fecha_apertura: string;
  fecha_cierre: string | null;
  efectivo_esperado?: number | string | null;
  /** Recalculado desde los movimientos vigentes. Si difiere del valor de
   * cierre, hubo una corrección posterior y ambos se muestran. */
  efectivo_esperado_actual?: number | string | null;
  estado: string;
  cuenta_financiera_id?: string | null;
  perfiles?: {
    nombre?: string | null;
  } | null;
}

export interface VentaCaja {
  id: string;
  total: number | string;
  metodo_pago?: string | null;
  fecha_venta: string;
  cliente_id?: string | null;
  monto_cobrado?: number | null;
  monto_pendiente?: number | null;
  estado_pago?: string | null;
  /** 'ANULADA' cambia cómo cuenta la venta en caja: su efectivo sigue sumando
   * al arqueo (lo saca el egreso de devolución) pero NO al total facturado.
   * Ver el comentario de `getDetallesTurnoAction`. */
  estado_operacion?: string | null;
  clientes?:
    | {
        nombre?: string | null;
      }
    | {
        nombre?: string | null;
      }[]
    | null;
  perfiles?: {
    nombre?: string | null;
  } | { nombre?: string | null }[] | null;
  ventas_items?: {
    variante?: string | null;
    es_venta_libre?: boolean | null;
    producto?:
      | {
          nombre?: string | null;
        }
      | {
          nombre?: string | null;
        }[]
      | null;
  }[];
  venta_pagos?: {
    id?: string;
    metodo_nombre: string;
    metodo_tipo: string;
    /** Lo que el cobro imputa al ticket/deuda. monto_bruto = base + recargo. */
    monto_base?: number;
    recargo_porcentaje?: number;
    recargo_monto?: number;
    monto_bruto: number;
    comision_monto: number;
    monto_neto: number;
    acreditacion_dias?: number;
    tipo_movimiento?: string;
  }[];
}

/** Un medio de pago del breakdown gerencial. `tipo` NO es una unión cerrada a
 * propósito: la RPC devuelve los buckets canónicos más cualquier tipo que
 * aparezca en datos viejos (ej. BILLETERA_VIRTUAL en Evens), para que no se
 * evapore plata del total. La UI tiene que tener un fallback de label. */
export interface MedioPagoResumen {
  tipo: string;
  monto: number;
  /** Ventas distintas tocadas por este medio. En pago mixto la misma venta
   * cuenta en cada medio que usó, así que la suma de la columna puede superar
   * la cantidad de ventas del día. */
  cantidad_ventas: number;
  /** Porción de `monto` que es cobranza de deuda vieja, no venta de hoy. */
  monto_cobranzas_cc: number;
}

export interface ResumenGerencialCaja {
  fecha: string;
  generado_en: string;
  ventas: {
    /** Cobrado por ventas del día. Excluye cobranzas de cuenta corriente. */
    total_cobrado: number;
    cantidad_ventas: number;
  };
  cuenta_corriente: {
    /** Fiado otorgado hoy: plata que NO entró. */
    fiado_otorgado: number;
    cantidad_ventas_con_fiado: number;
    /** Deuda vieja cobrada hoy: plata que SÍ entró, ya contada dentro de
     * `breakdown_medios`. Sumarla a `ventas.total_cobrado` la duplica. */
    cobranzas_monto: number;
    cobranzas_cantidad: number;
  };
  breakdown_medios: MedioPagoResumen[];
  caja: {
    fondo_inicial: number;
    ingresos_efectivo: number;
    egresos_efectivo: number;
    /** Neto de pases internos que entraron/salieron de la cuenta arqueada. */
    transferencias_netas?: number;
    esperado: number;
    turnos_totales: number;
    turnos_abiertos: number;
    cierre_completo: boolean;
    /** null mientras quede algún turno abierto — ahí la UI muestra estado
     * parcial, nunca una diferencia. */
    real_declarado: number | null;
    diferencia: number | null;
  };
}

/** Una fila del expandible de un medio de pago. Es un COBRO, no una venta: una
 * venta con pago mixto aparece una vez por cada medio que usó. */
export interface DetalleMedioPago {
  pago_id: string;
  venta_id: string | null;
  metodo_tipo: string;
  metodo_nombre: string;
  monto: number;
  /** Cobro de deuda vieja, no venta del día. */
  es_cobranza_cc: boolean;
  fecha: string;
  vendedor: string | null;
  cliente: string | null;
}

export interface EgresoCaja {
  id: string;
  monto: number | string;
  concepto: string;
  fecha: string;
  /** OPERATIVO | RETIRO_SOCIO | COMPRA_MERCADERIA | DEVOLUCION. Opcional en el tipo porque
   * hay consultas viejas que no la seleccionan; ausente se lee como
   * OPERATIVO (ver normalizarTipoEgreso, fail-closed). */
  tipo?: string | null;
  /** Solo en COMPRA_MERCADERIA: el remito que originó el pago. */
  orden_compra_id?: string | null;
  creado_por?: string | null;
  turno_caja_id?: string | null;
  cuenta_origen_id?: string | null;
  perfiles?: {
    nombre?: string | null;
  } | null;
}

export interface TransferenciaCaja {
  movimiento_id: number;
  /** Positivo si entró al cajón, negativo si salió. */
  importe: number | string;
  descripcion: string;
  fecha_movimiento: string;
}

/**
 * Posición de dinero: dónde está la plata AHORA, según lo registrado.
 *
 * Es derivada, no es un saldo bancario: la base no sabe de transferencias
 * salientes, débitos automáticos ni de la plata que ya se sacó de la cuenta.
 * Responde "cuánto entró y dónde debería estar" (ver RPC posicion_dinero).
 */
export interface CajaAbiertaPosicion {
  turno_id: string;
  vendedor: string;
  desde: string;
  inicial: number;
  ingresos: number;
  /** Todos los egresos del turno, del tipo que sean: los tres vacían el cajón. */
  salidas: number;
  transferencias_netas?: number;
  esperado: number;
}

export interface CuentaPosicion {
  metodo_nombre: string;
  metodo_tipo: string;
  cantidad: number;
  bruto: number;
  comision: number;
  neto: number;
  /** Solo en por_acreditar: cuándo cae el primero y el último. */
  proxima?: string;
  ultima?: string;
}

/** Saldo de una cuenta del negocio, derivado del ledger. Es la ÚNICA fuente
 * de saldos de la pestaña Dinero: la lista de cuentas y el total disponible
 * salen de acá, no de `estado_cuentas_financieras`, que no calcula saldo. */
export interface SaldoCuenta {
  cuenta_id: string;
  nombre: string;
  tipo: string;
  es_efectivo: boolean;
  saldo: number;
}

export interface ReintegroPosicion {
  metodo_nombre: string;
  metodo_tipo: string;
  cantidad: number;
  monto: number;
}

export interface PosicionDinero {
  desde: string;
  hasta: string;
  generado_en: string;
  efectivo: {
    total: number;
    turnos_abiertos: number;
    /** Declarado en los turnos cerrados HOY: plata que ya se contó y salió. */
    cerrado_hoy: number;
    cajas: CajaAbiertaPosicion[];
  };
  por_acreditar: CuentaPosicion[];
  acreditado: CuentaPosicion[];
  /** Lo que se le devolvió al cliente por un medio que NO es efectivo, dentro
   * del período. YA está restado de `acreditado`: viaja aparte para poder
   * mostrarlo, porque un total que baja sin decir por qué es un número que
   * nadie puede verificar. En efectivo no hace falta, ahí el egreso ya se ve
   * en el arqueo del turno. */
  reintegros?: ReintegroPosicion[];
  modelo?: "LEDGER";
  cuentas?: SaldoCuenta[];
  por_acreditar_real?: { nombre: string; saldo: number; cantidad_movimientos: number };
  conciliacion?: { por_acreditar_ledger: number; por_acreditar_anterior: number };
}

/** Respuesta de `ventas_facturadas`: qué parte de lo vendido tiene factura. */
export interface VentasFacturadas {
  desde: string;
  hasta: string;
  periodo: string;
  facturado: {
    cantidad: number;
    total: number;
    por_tipo: { tipo: string; cantidad: number; total: number }[];
  };
  sin_facturar: { cantidad: number; total: number };
  /** CAE de homologación: comprobantes de prueba, sin valor fiscal. */
  prueba: { cantidad: number; total: number };
  total: { cantidad: number; total: number };
}
