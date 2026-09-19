import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CartItemStore } from "@/entities/cart/types";
import type { CreateSalePaymentInput } from "@/entities/ventas/types";
import type { UnidadSeleccionada } from "@/entities/ventas/unidades-serie-types";
import type { ClienteBasico } from "@/shared/components/cart-sidebar/client-selector";

export type PasoVentaEnCola = "CART" | "PAYMENT";

export interface VentaEnCola {
  id: string;
  numero: number;
  creadaEn: string;
  items: CartItemStore[];
  listaPrecioId: string | null;
  pedidoActivo: {
    id: string;
    numero: number;
    vendedor: string | null;
  } | null;
  cliente: ClienteBasico | null;
  pagos: CreateSalePaymentInput[];
  modoMixto: boolean;
  cuentaCorriente: boolean;
  ccSinRecargo: boolean;
  reserva: boolean;
  promocionId: string;
  facturarElegido: boolean | null;
  paso: PasoVentaEnCola;
  unidadesElegidas: UnidadSeleccionada[];
  listaElegidaAMano: boolean;
}

interface SesionVentasEnCola {
  ventaActivaId: string;
  proximoNumero: number;
  ventas: VentaEnCola[];
}

interface VentasEnColaState {
  sesiones: Record<string, SesionVentasEnCola>;
  inicializar: (alcance: string, venta: VentaEnCola) => void;
  guardar: (alcance: string, venta: VentaEnCola) => void;
  agregar: (alcance: string, venta: VentaEnCola) => void;
  activar: (alcance: string, ventaId: string) => void;
  quitar: (
    alcance: string,
    ventaId: string,
    reemplazoSiQuedaVacio: VentaEnCola,
  ) => void;
}

/**
 * Borradores locales, separados por negocio + usuario. No reservan stock ni
 * escriben ventas: son el equivalente persistente de tener varios tickets
 * abiertos sobre el mostrador. El cobro sigue pasando por create-sale y sus
 * validaciones server-side.
 */
export const useVentasEnColaStore = create<VentasEnColaState>()(
  persist(
    (set) => ({
      sesiones: {},

      inicializar: (alcance, venta) =>
        set((state) => {
          if (state.sesiones[alcance]) return state;
          return {
            sesiones: {
              ...state.sesiones,
              [alcance]: {
                ventaActivaId: venta.id,
                proximoNumero: venta.numero + 1,
                ventas: [venta],
              },
            },
          };
        }),

      guardar: (alcance, venta) =>
        set((state) => {
          const sesion = state.sesiones[alcance];
          if (!sesion) return state;
          return {
            sesiones: {
              ...state.sesiones,
              [alcance]: {
                ...sesion,
                ventas: sesion.ventas.map((actual) =>
                  actual.id === venta.id ? venta : actual,
                ),
              },
            },
          };
        }),

      agregar: (alcance, venta) =>
        set((state) => {
          const sesion = state.sesiones[alcance];
          if (!sesion) return state;
          return {
            sesiones: {
              ...state.sesiones,
              [alcance]: {
                ventaActivaId: venta.id,
                proximoNumero: Math.max(sesion.proximoNumero, venta.numero + 1),
                ventas: [...sesion.ventas, venta],
              },
            },
          };
        }),

      activar: (alcance, ventaId) =>
        set((state) => {
          const sesion = state.sesiones[alcance];
          if (!sesion || !sesion.ventas.some((venta) => venta.id === ventaId)) {
            return state;
          }
          return {
            sesiones: {
              ...state.sesiones,
              [alcance]: { ...sesion, ventaActivaId: ventaId },
            },
          };
        }),

      quitar: (alcance, ventaId, reemplazoSiQuedaVacio) =>
        set((state) => {
          const sesion = state.sesiones[alcance];
          if (!sesion) return state;
          const restantes = sesion.ventas.filter(
            (venta) => venta.id !== ventaId,
          );
          const ventas =
            restantes.length > 0 ? restantes : [reemplazoSiQuedaVacio];
          const activaSigue = ventas.some(
            (venta) => venta.id === sesion.ventaActivaId,
          );
          return {
            sesiones: {
              ...state.sesiones,
              [alcance]: {
                ventaActivaId: activaSigue
                  ? sesion.ventaActivaId
                  : ventas[0].id,
                proximoNumero:
                  restantes.length > 0
                    ? sesion.proximoNumero
                    : reemplazoSiQuedaVacio.numero + 1,
                ventas,
              },
            },
          };
        }),
    }),
    {
      name: "comerz-pos-ventas-en-cola-v1",
      partialize: (state) => ({ sesiones: state.sesiones }),
    },
  ),
);

export function crearVentaEnColaVacia(
  numero: number,
  id = crypto.randomUUID(),
): VentaEnCola {
  return {
    id,
    numero,
    creadaEn: new Date().toISOString(),
    items: [],
    listaPrecioId: null,
    pedidoActivo: null,
    cliente: null,
    pagos: [],
    modoMixto: false,
    cuentaCorriente: false,
    ccSinRecargo: false,
    reserva: false,
    promocionId: "ninguna",
    facturarElegido: null,
    paso: "CART",
    unidadesElegidas: [],
    listaElegidaAMano: false,
  };
}
