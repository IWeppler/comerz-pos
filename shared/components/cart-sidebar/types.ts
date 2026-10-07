import { MetodoPago } from "@/entities/payments/types";

export interface PromocionDB {
  id: string;
  codigo?: string | null;
  nombre: string;
  tipo_regla: string | null;
  tipo_descuento: string;
  valor_descuento: number;
  monto_minimo: number;
  fecha_inicio?: string | null;
  fecha_fin?: string | null;
  limite_usos?: number | null;
  usos_actuales?: number | null;
  mostrar_en_catalogo?: boolean;
  /** Las consultas del POS y del catálogo ya filtran por `activa`, pero el
   * dato viaja igual (`select *`) y `promocionVigente` lo vuelve a mirar: una
   * promo apagada no descuenta ni aunque la pantalla la tenga cargada de
   * antes. Es el mismo chequeo que hace el server. */
  activa?: boolean | null;
  acumulable?: boolean;
  prioridad?: number;
  promociones_metodos_pago?: { metodo_pago: string }[];
  promociones_categorias?: { categoria_nombre: string }[];
}

export interface DescuentoDetalle {
  monto: number;
  nombre: string;
}

export type MetodoPagoPOS = MetodoPago;

