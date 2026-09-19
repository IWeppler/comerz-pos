export type TipoMetodo =
  | "EFECTIVO"
  | "TRANSFERENCIA"
  | "BILLETERA_VIRTUAL"
  | "TARJETA";

export interface MetodoPago {
  id: string;
  nombre: string;
  tipo: TipoMetodo;
  /** Lo que el comercio le PAGA al procesador. Se resta del neto. Interno. */
  comision: number;
  /** Lo que el comercio le COBRA al cliente por usar el método. Se suma al
   * ticket y se le muestra. Ver shared/lib/recargo-metodo.ts. */
  recargo_porcentaje: number;
  acreditacion_dias: number;
  /** Cuenta final configurada; el cobro diferido pasa antes por Por acreditar. */
  cuenta_destino_id?: string | null;
  activo: boolean;
}
