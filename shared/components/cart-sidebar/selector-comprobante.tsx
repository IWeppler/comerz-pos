"use client";

import { ArrowLeftRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface SelectorComprobanteProps {
  /** true = factura con CAE; false = ticket interno. */
  facturar: boolean;
  /** Lo que saldría si se factura: "Factura C", "Factura B"... Sale de la
   * misma matriz que usa el server (`determinarComprobanteFiscal`), así el
   * control no promete una letra y sale otra. */
  etiquetaFactura: string;
  /**
   * Ausente = solo se muestra (sin permiso `ventas.elegir_comprobante`, o
   * ARCA caído): la vendedora ve qué va a salir, pero no lo cambia. Que no
   * se pueda elegir es distinto de que no exista.
   */
  onChange?: (facturar: boolean) => void;
  /** Por qué no se puede elegir. Va en el `title`, no en la pantalla. */
  motivoBloqueo?: string;
}

/**
 * Factura / ticket interno, por venta. Vive en el HEADER del ticket durante
 * el paso de cobro, no como sección del formulario.
 *
 * Hubo una sección "Comprobante" de dos botones de 44px con su título y su
 * leyenda en el paso de pago: ~130px para una decisión que en el uso normal
 * no se toca (vale `facturar_por_defecto`). El header tiene ese lugar libre y
 * es el mismo en desktop y en el sheet de celular.
 *
 * Es UN chip que muestra el estado y lo da vuelta al tocarlo: "Factura C" ⇄
 * "Sin factura". El ícono de intercambio es lo que lo distingue de una
 * etiqueta. Hubo una versión segmentada con las dos opciones a la vista; en
 * un header de 360px con el título, la flecha y la X no entraba, y lo que
 * importa leer es qué va a salir, no qué no va a salir.
 *
 * "Sin factura" y no "Ticket" porque al lado está el título del panel, que
 * ya dice "Ticket" con otro sentido.
 */
export function SelectorComprobante({
  facturar,
  etiquetaFactura,
  onChange,
  motivoBloqueo,
}: Readonly<SelectorComprobanteProps>) {
  const bloqueado = !onChange;
  const texto = facturar ? etiquetaFactura : "Sin factura";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={facturar}
      aria-label={`Comprobante: ${texto}`}
      disabled={bloqueado}
      onClick={() => onChange?.(!facturar)}
      title={bloqueado ? motivoBloqueo : `Cambiar a ${facturar ? "sin factura" : etiquetaFactura}`}
      className={cn(
        // `-my-2`: mide 32px pero aporta 20px al header, igual que la flecha
        // de volver, así el header no cambia de altura al entrar al cobro.
        "-my-2 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold normal-case tracking-normal whitespace-nowrap transition-colors",
        facturar
          ? "border-primary/30 bg-primary/10 text-primary"
          : "border-border bg-muted text-muted-foreground",
        bloqueado
          ? "cursor-default opacity-70"
          : "cursor-pointer hover:border-primary/50",
      )}
    >
      {texto}
      {!bloqueado ? <ArrowLeftRight className="h-3 w-3 opacity-70" /> : null}
    </button>
  );
}
