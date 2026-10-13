"use client";

import { forwardRef } from "react";
import { Building2, CreditCard, Landmark, Wallet } from "lucide-react";
import type { OpcionPagoPublica } from "@/shared/lib/opciones-pago-publicas";
import { OpcionRadio } from "./opcion-radio";
import { pesos } from "./formato";

/** Dos opciones son la misma si coinciden canal (online) o tipo. */
export const claveOpcionPago = (opcion: OpcionPagoPublica) => opcion.online ?? opcion.tipo;

/** Qué es cada medio, en una línea, y qué pasa al elegirlo. */
function textos(opcion: OpcionPagoPublica): { detalle: string; alElegir?: string } {
  switch (opcion.online) {
    case "MP_CHECKOUT":
      return {
        detalle: "Tarjeta de crédito, débito o dinero en tu cuenta",
        alElegir: "Al tocar «Pagar» vas a Mercado Pago, pagás y volvés acá con tu pedido confirmado.",
      };
    case "MP_CREDITO":
      return {
        detalle: "Hasta 12 cuotas fijas, sin tarjeta",
        alElegir:
          "Vas a Mercado Pago, iniciás sesión y elegís las cuotas. Depende del cupo de Mercado Crédito de tu cuenta.",
      };
    case "TRANSFERENCIA":
      return {
        detalle: "Te mostramos el alias al confirmar",
        alElegir: "Transferí el monto exacto y confirmamos tu pago solos. Tus productos quedan reservados mientras tanto.",
      };
    default:
      return { detalle: "Coordinás el pago con la tienda por WhatsApp" };
  }
}

function icono(opcion: OpcionPagoPublica) {
  if (opcion.online === "MP_CHECKOUT" || opcion.online === "MP_CREDITO") {
    return (
      <span className="rounded-md bg-[#00b1ea] px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
        mercado pago
      </span>
    );
  }
  if (opcion.tipo === "TRANSFERENCIA") return <Landmark className="h-5 w-5" />;
  if (opcion.tipo === "TARJETA") return <CreditCard className="h-5 w-5" />;
  if (opcion.tipo === "BILLETERA_VIRTUAL") return <Wallet className="h-5 w-5" />;
  return <Building2 className="h-5 w-5" />;
}

/**
 * Los medios de pago como lista con radio (como Tiendanube y Shopify), no
 * como grilla de botones iguales. Cada uno dice qué es; si el medio cambia el
 * precio (descuento por transferencia, recargo por tarjeta) lo dice con el
 * número, en una etiqueta, y lo que pasa al confirmar se abre debajo del
 * elegido.
 */
export const MediosPagoCheckout = forwardRef<
  HTMLDivElement,
  {
    opciones: OpcionPagoPublica[];
    elegida: OpcionPagoPublica | null;
    onElegir: (opcion: OpcionPagoPublica) => void;
    /** Total del pedido pagando con cada opción, por `claveOpcionPago`. */
    totalPorOpcion: Map<string, number>;
    /** Total sin elegir medio: contra esto se compara cada uno. */
    totalSinMedio: number;
  }
>(function MediosPagoCheckout({ opciones, elegida, onElegir, totalPorOpcion, totalSinMedio }, ref) {
  return (
    <div ref={ref} role="radiogroup" aria-label="Medio de pago" className="overflow-hidden rounded-xl border border-border">
      {opciones.map((opcion) => {
        const clave = claveOpcionPago(opcion);
        const activa = !!elegida && claveOpcionPago(elegida) === clave;
        const total = totalPorOpcion.get(clave) ?? totalSinMedio;
        const { detalle, alElegir } = textos(opcion);
        const etiqueta =
          total < totalSinMedio - 0.005 ? (
            <span className="rounded bg-success/15 px-1.5 py-0.5 text-xs font-semibold text-success">
              Pagás {pesos(total)}
            </span>
          ) : opcion.recargoPorcentaje > 0 ? (
            <span className="rounded bg-warning/15 px-1.5 py-0.5 text-xs font-semibold text-warning">
              +{opcion.recargoPorcentaje}%
            </span>
          ) : null;
        return (
          <OpcionRadio
            key={clave}
            activa={activa}
            onElegir={() => onElegir(opcion)}
            titulo={opcion.etiqueta}
            detalle={detalle}
            derecha={etiqueta}
            icono={icono(opcion)}
          >
            {activa && alElegir ? <p className="pl-8 text-xs text-muted-foreground">{alElegir}</p> : null}
          </OpcionRadio>
        );
      })}
    </div>
  );
});
