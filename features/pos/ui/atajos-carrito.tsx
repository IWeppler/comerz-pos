"use client";

import { useRef } from "react";
import { toast } from "sonner";
import { useAtajosTeclado } from "@/shared/hooks/use-atajos-teclado";

type AtajosCarritoProps = {
  /** En qué paso está el ticket: decide qué hace Ctrl+Enter (llevar al pago
   * o confirmar), qué hace F4 y qué hace Esc. */
  paso: "CART" | "PAYMENT";
  hayItems: boolean;
  /** Con una venta en vuelo no se dispara nada: dos Ctrl+Enter seguidos son
   * dos ventas. */
  ocupado: boolean;
  irAPagar: () => void;
  volverAlCarrito: () => void;
  confirmar: () => void;
  abrirSelectorCliente: () => void;
  vaciarTicket: () => void;
  /** Suma o resta una unidad al ÚLTIMO renglón cargado. `null` cuando no hay
   * ninguno o cuando ese renglón se vende fraccionado (ver abajo). */
  ajustarUltimo: ((delta: number) => void) | null;
  /** Qué tipo de venta es. Son los mismos tres botones del paso de pago:
   * el atajo no decide nada por su cuenta, toca el mismo control. */
  elegirTipoVenta: (tipo: TipoVenta) => void;
  /** Reservar existe solo en los rubros que lo usan (indumentaria). Sin
   * esto, `3` sería una tecla que no hace nada en un kiosco. */
  puedeReservar: boolean;
  /** Abre el renglón de venta libre del ticket (tecla V). */
  abrirVentaLibre: () => void;
};

export type TipoVenta = "COMUN" | "CUENTA_CORRIENTE" | "RESERVA";

/**
 * Los atajos del ticket, en un componente propio y no en un `useAtajosTeclado`
 * dentro de CartPanelAdmin.
 *
 * El motivo es concreto: ese componente tiene un `if (!mounted) return null`
 * ANTES de definir sus handlers, así que un hook que los use no puede vivir
 * arriba de esa línea sin romper el orden de los hooks. Acá se monta después,
 * ya con todo resuelto, y no renderiza nada.
 *
 * Confirmar la venta NO tiene su propia lógica: llama al mismo handler que el
 * botón. Un atajo que arme la venta por su cuenta es un segundo camino a la
 * plata, y a la larga uno de los dos valida algo que el otro no.
 */
export function AtajosCarrito({
  paso,
  hayItems,
  ocupado,
  irAPagar,
  volverAlCarrito,
  confirmar,
  abrirSelectorCliente,
  vaciarTicket,
  ajustarUltimo,
  elegirTipoVenta,
  puedeReservar,
  abrirVentaLibre,
}: Readonly<AtajosCarritoProps>) {
  /** Cuándo fue que Ctrl+Enter llevó al paso de pago. Ver el atajo. */
  const llegadaAPagoPorAtajo = useRef(0);

  useAtajosTeclado([
    {
      teclas: "alt+ArrowUp",
      activo: Boolean(ajustarUltimo) && !ocupado,
      correr: () => ajustarUltimo?.(1),
    },
    {
      teclas: "alt+ArrowDown",
      activo: Boolean(ajustarUltimo) && !ocupado,
      correr: () => ajustarUltimo?.(-1),
    },
    {
      teclas: "F4",
      activo: paso === "CART" && hayItems && !ocupado,
      correr: irAPagar,
    },
    {
      teclas: "F7",
      activo: hayItems && !ocupado,
      correr: abrirSelectorCliente,
    },
    {
      // Cobrar algo que no está cargado. Letra suelta, misma regla que la
      // "F" del buscador: con el foco en un campo de texto NO se dispara,
      // así que tipear "vestido" en el buscador no abre nada. Desde la
      // grilla (foco en una card) o con nada enfocado, "V" abre el renglón.
      teclas: "v",
      activo: !ocupado,
      correr: abrirVentaLibre,
    },
    // 1 / 2 / 3: qué tipo de venta es. Van SOLO en el paso de pago, que es
    // donde están los botones que representan: un atajo que cambia algo que
    // no está en pantalla deja a la vendedora sin forma de ver qué pasó.
    //
    // Teclas sueltas, así que el hook las ignora mientras se escribe: tipear
    // "2" en el monto del pago no convierte la venta en fiado. Y no chocan
    // con los Alt+1…9 de la grilla, que exigen el modificador.
    {
      teclas: "1",
      activo: paso === "PAYMENT" && !ocupado,
      correr: () => elegirTipoVenta("COMUN"),
    },
    {
      teclas: "2",
      activo: paso === "PAYMENT" && !ocupado,
      correr: () => elegirTipoVenta("CUENTA_CORRIENTE"),
    },
    {
      teclas: "3",
      activo: paso === "PAYMENT" && !ocupado && puedeReservar,
      correr: () => elegirTipoVenta("RESERVA"),
    },
    {
      // La MISMA tecla avanza el ticket: en el carrito lleva al pago y en
      // el pago confirma. F4 sigue existiendo para ir al pago directo.
      //
      // El freno de 500 ms es lo que hace que esto sea seguro: sin él, dos
      // Ctrl+Enter rápidos —o una tecla que rebota— cobran la venta sin que
      // nadie haya mirado el paso de pago. Solo corre cuando al pago se
      // llegó CON el atajo; entrando por el botón, confirmar es inmediato.
      teclas: "ctrl+Enter",
      activo: hayItems && !ocupado,
      correr: () => {
        if (paso === "CART") {
          llegadaAPagoPorAtajo.current = Date.now();
          irAPagar();
          return;
        }

        if (Date.now() - llegadaAPagoPorAtajo.current < 500) return;
        confirmar();
      },
    },
    {
      teclas: "Escape",
      activo: paso === "PAYMENT" && !ocupado,
      correr: volverAlCarrito,
    },
    {
      // Incómodo a propósito: es lo único destructivo de la lista, y encima
      // pide confirmar. Un ticket cargado a mano que se borra de una tecla es
      // la clienta esperando mientras se vuelve a cargar todo.
      teclas: "ctrl+shift+Backspace",
      activo: hayItems && !ocupado,
      correr: () => {
        toast.warning("¿Vaciar el ticket?", {
          description: "Se van a quitar todos los productos cargados.",
          action: {
            label: "Vaciar",
            onClick: vaciarTicket,
          },
        });
      },
    },
  ]);

  return null;
}
