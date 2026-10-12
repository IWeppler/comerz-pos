"use client";

import { createContext, useContext, useMemo } from "react";
import type { PromocionDB } from "@/shared/components/cart-sidebar/types";
import {
  opcionesDePagoPublicas,
  type MetodoPublico,
  type OpcionPagoPublica,
} from "@/shared/lib/opciones-pago-publicas";
import {
  mejorDescuentoPorMetodo,
  type DescuentoPorMetodo,
} from "@/shared/lib/totales-pedido-publico";
import type { OpcionesCobroOnline } from "../lib/orden-tienda";

interface DescuentosPago {
  promociones: PromocionDB[];
  opcionesPago: OpcionPagoPublica[];
  /** Medios de pago ONLINE del comercio (`opciones_cobro_online()`). */
  opcionesOnline: OpcionesCobroOnline;
}

const SIN_PAGO_ONLINE: OpcionesCobroOnline = { transferencia: false, mercadopago: false };

const DescuentosPagoContext = createContext<DescuentosPago>({
  promociones: [],
  opcionesPago: [],
  opcionesOnline: SIN_PAGO_ONLINE,
});

/**
 * Las promociones y los métodos de pago del negocio, UNA sola vez para todo el
 * catálogo.
 *
 * POR CONTEXTO Y DESDE EL SERVER, no con un fetch por componente. La grilla
 * dibuja decenas de tarjetas y cada una necesita saber si hay descuento por
 * método: con una consulta por tarjeta serían decenas de round-trips para
 * traer siempre las mismas cinco filas. El layout las pide una vez —ya tiene
 * cliente anónimo y tenant resuelto— y acá abajo se leen sin red.
 *
 * Y ES LA MISMA FUENTE QUE EL CARRITO, que antes se las traía por su cuenta
 * con dos `useEffect`. Dos consultas distintas a las mismas tablas son dos
 * momentos distintos: si una promo se desactiva entre que se pintó la grilla y
 * se abrió el carrito, la ficha prometía un descuento que el desglose ya no
 * daba. Con una sola lectura eso no puede pasar.
 */
export function DescuentosPagoProvider({
  promociones,
  metodos,
  opcionesOnline = SIN_PAGO_ONLINE,
  children,
}: Readonly<{
  promociones: PromocionDB[];
  metodos: MetodoPublico[];
  opcionesOnline?: OpcionesCobroOnline;
  children: React.ReactNode;
}>) {
  const valor = useMemo(
    () => ({ promociones, opcionesPago: opcionesDePagoPublicas(metodos), opcionesOnline }),
    [promociones, metodos, opcionesOnline],
  );

  return (
    <DescuentosPagoContext.Provider value={valor}>
      {children}
    </DescuentosPagoContext.Provider>
  );
}

export function useDescuentosPago(): DescuentosPago {
  return useContext(DescuentosPagoContext);
}

/**
 * El mejor precio pagando de una manera, para UN producto.
 *
 * El cálculo no vive acá: lo hace `mejorDescuentoPorMetodo`, que es la misma
 * función que arma el desglose del carrito. Este hook solo le acerca los datos
 * del negocio.
 */
export function useMejorDescuentoPorMetodo(
  precio: number,
  categoria?: string | null,
): DescuentoPorMetodo | null {
  const { promociones, opcionesPago } = useDescuentosPago();

  return useMemo(
    () =>
      mejorDescuentoPorMetodo({ precio, categoria, promociones, opcionesPago }),
    [precio, categoria, promociones, opcionesPago],
  );
}
