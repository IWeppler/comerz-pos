"use client";

import Image from "next/image";
import { Button } from "@/shared/ui/button";
import { BOTON_CATALOGO } from "../lib/estilos-catalogo";
import type { TotalesPedido } from "@/shared/lib/totales-pedido-publico";

const pesos = (monto: number) =>
  monto.toLocaleString("es-AR", { style: "currency", currency: "ARS" });

/**
 * El desglose y el botón de enviar.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EL DESGLOSE REEMPLAZA AL DISCLAIMER
 *
 * Acá había tres bloques de texto —promos aplicadas, promos según método de
 * pago, métodos con recargo— explicando cuáles estaban y cuáles no estaban
 * incluidas en el total. Existían por una sola razón: el carrito no sabía cómo
 * iba a pagar la clienta, así que no podía calcular el precio real y lo
 * compensaba con prosa. Ahora el paso 2 pregunta, y cada una de esas líneas es
 * un renglón con un número.
 *
 * DESCUENTO Y RECARGO SON RENGLONES PROPIOS, nunca absorbidos en el total.
 * Un negocio puede tener los dos a la vez sobre el mismo medio (Evens: 30% OFF
 * con tarjeta y 15% de recargo con tarjeta), y mostrar solo el neto escondería
 * que hay un recargo. El renglón lleva el porcentaje justamente para que se
 * lea como recargo y no como "un descuento más chico".
 *
 * NO CALCULA NADA: recibe `TotalesPedido` ya resuelto, el mismo objeto que
 * viaja al mensaje de WhatsApp. Ver `shared/lib/totales-pedido-publico.ts`.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function CartDesglosePublico({
  totales,
  onEnviarPedido,
  isPending = false,
}: Readonly<{
  totales: TotalesPedido;
  /**
   * Valida y, si está todo, abre WhatsApp. Abrir la ventana NO se hace acá
   * aunque el botón viva acá: primero hay que validar, y si el link se abriera
   * desde este componente habría que validar dos veces o abrirlo igual con
   * campos vacíos.
   */
  onEnviarPedido: () => void;
  isPending?: boolean;
}>) {
  return (
    <div className="shrink-0 border-t border-border bg-card px-4 py-4">
      <div className="space-y-1 text-xs">
        <Renglon etiqueta="Subtotal" valor={pesos(totales.subtotal)} />
        {totales.descuento && (
          <Renglon
            etiqueta={totales.descuento.etiqueta}
            valor={`− ${pesos(totales.descuento.monto)}`}
            tono="text-success"
          />
        )}
        {totales.recargo && (
          <Renglon
            etiqueta={totales.recargo.etiqueta}
            valor={`+ ${pesos(totales.recargo.monto)}`}
            tono="text-warning"
          />
        )}
        {totales.envio && (
          <Renglon etiqueta="Envío" valor={totales.envio.etiqueta === "Envío gratis" ? "Gratis" : pesos(totales.envio.monto)} />
        )}
      </div>

      <div className="mt-2 flex items-baseline justify-between border-t border-border pt-2">
        <span className="text-sm font-semibold text-muted-foreground">
          Total
        </span>
        <span className="text-2xl font-bold text-foreground">
          {pesos(totales.total)}
        </span>
      </div>

      <Button
        type="button"
        onClick={onEnviarPedido}
        disabled={isPending}
        className={`mt-4 flex h-12 w-full cursor-pointer items-center justify-center gap-3 text-sm font-bold uppercase tracking-widest shadow-none disabled:cursor-not-allowed ${BOTON_CATALOGO}`}
      >
        <Image src="/whatsappp.png" alt="" width={20} height={20} />
        Enviar pedido
      </Button>
    </div>
  );
}

function Renglon({
  etiqueta,
  valor,
  tono = "text-muted-foreground",
}: Readonly<{ etiqueta: string; valor: string; tono?: string }>) {
  return (
    <div className={`flex items-center justify-between gap-3 ${tono}`}>
      <span className="min-w-0 truncate">{etiqueta}</span>
      <span className="shrink-0 font-medium">{valor}</span>
    </div>
  );
}
