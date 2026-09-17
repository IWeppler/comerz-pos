"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { Loader2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import type { TicketData } from "@/entities/ventas/types";
import type { ConfiguracionPOS } from "@/entities/config/types";
import { TicketPrintable } from "@/features/sales/ui/ticket-printable";
import { TicketSheet } from "@/features/sales/ui/ticket-sheet";
import { useEntregaComprobante } from "@/features/sales/ui/use-entrega-comprobante";
import { useAtajosTeclado } from "@/shared/hooks/use-atajos-teclado";
import {
  cssImpresionTicket,
  normalizarAnchoTicket,
} from "@/shared/lib/ancho-ticket";
import { resumirVentaExitosa } from "../lib/resumen-venta-exitosa";

/**
 * Cuánto tiene que estar en pantalla antes de aceptar Enter.
 *
 * La venta se confirma con Ctrl+Enter, y una tecla que rebota —o un Enter de
 * más— cerraría esta pantalla antes de que nadie la vea. Mismo criterio que
 * el freno de 500 ms de `atajos-carrito.tsx`, con la misma pregunta atrás:
 * ¿alguien miró lo que acaba de pasar?
 */
const ESPERA_ENTER_MS = 400;

interface VentaExitosaProps {
  ticket: TicketData;
  config: ConfiguracionPOS | null;
  onNuevaVenta: () => void;
}

/**
 * El estado del panel del TICKET entre una venta y la siguiente.
 *
 * Vive en el lugar del carrito —la columna derecha en escritorio, el sheet en
 * tablet, el drawer en celular— y no en una capa encima: el carrito recién
 * cobrado está vacío, así que ese espacio es justo el que dice "terminaste,
 * listos para la próxima". El catálogo sigue a la vista y usable.
 *
 * Es confirmación, no visualización: qué pasó, cuánto fue y, si quedó deuda,
 * cuánta. El ticket completo sigue existiendo (`TicketSheet`) y se abre desde
 * "Ver detalle" para la vendedora que sí lo necesita —la clienta pregunta un
 * precio, se cargó mal un talle— sin mandarla al historial.
 *
 * Teclado: Enter o Escape → nueva venta, P → imprimir. El botón existe igual:
 * las vendedoras nuevas no saben que Enter hace eso.
 */
export function VentaExitosa({
  ticket,
  config,
  onNuevaVenta,
}: Readonly<VentaExitosaProps>) {
  const resumen = resumirVentaExitosa(ticket);
  const {
    qrDataUrl,
    isDownloading,
    compartirWhatsapp,
    imprimir,
    precargarPdf,
    descargarPdf,
  } = useEntregaComprobante(ticket, config, "POS");
  const anchoTicket = normalizarAnchoTicket(config?.ancho_ticket_mm);

  const [detalleAbierto, setDetalleAbierto] = useState(false);
  const montadoEn = useRef(0);
  const botonNuevaVenta = useRef<HTMLButtonElement>(null);

  // El foco arranca en "Nueva venta": es lo que sigue en el 99% de los casos,
  // y con el foco ahí Tab recorre las otras acciones en orden. `preventScroll`
  // porque el contenedor del POS es el que scrollea, no la ventana.
  useEffect(() => {
    montadoEn.current = Date.now();
    botonNuevaVenta.current?.focus({ preventScroll: true });
  }, []);

  const nuevaVenta = () => {
    if (Date.now() - montadoEn.current < ESPERA_ENTER_MS) return;
    onNuevaVenta();
  };

  // P imprime. Con el detalle abierto, el teclado es del sheet (el hook lo
  // resuelve mirando el DOM): su propia P imprime y su Escape lo cierra.
  useAtajosTeclado([{ teclas: "p", correr: imprimir }]);

  /**
   * Enter y Escape → nueva venta. Van a mano y no por `useAtajosTeclado`
   * porque ese hook hace `preventDefault` ANTES de correr el atajo, y acá
   * Enter tiene dueño según dónde esté el foco: sobre WhatsApp tiene que
   * mandar el WhatsApp (Tab + Enter es cómo se navega sin mouse), y sobre
   * "Nueva venta" o sobre nada, cerrar la pantalla. Un atajo global que se
   * quede con la tecla deja a los otros botones sin teclado.
   */
  useEffect(() => {
    if (detalleAbierto) return;

    const alTeclado = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === "Escape") {
        e.preventDefault();
        nuevaVenta();
        return;
      }
      if (e.key !== "Enter") return;

      const foco = document.activeElement;
      const enOtroControl =
        foco instanceof HTMLElement &&
        foco !== botonNuevaVenta.current &&
        ["BUTTON", "A", "INPUT", "TEXTAREA", "SELECT"].includes(foco.tagName);
      if (enOtroControl) return;

      e.preventDefault();
      nuevaVenta();
    };

    window.addEventListener("keydown", alTeclado);
    return () => window.removeEventListener("keydown", alTeclado);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detalleAbierto]);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-10">
      <div className="flex w-full max-w-xs flex-col items-center gap-8 text-center">
        <Image
          src="/icon-check.webp"
          alt=""
          width={80}
          height={80}
          priority
          className="h-24 w-24"
        />

        <div className="space-y-3">
          <h2 className="text-base font-medium text-foreground">
            {resumen.titulo}
          </h2>
          <p className="font-mono text-4xl font-medium tracking-tight text-foreground">
            {resumen.total}
          </p>
          {resumen.detalleCobro && (
            <p className="text-sm text-warning">{resumen.detalleCobro}</p>
          )}
        </div>

        <div className="space-y-1 text-sm text-muted-foreground">
          <p>{resumen.contexto}</p>
          <p>{resumen.comprobante}</p>
        </div>

        <Button
          ref={botonNuevaVenta}
          className="h-11 w-full max-w-60 gap-2 text-sm font-semibold"
          onClick={nuevaVenta}
        >
          Nueva venta
          <span aria-hidden className="text-primary-foreground/60">
            ↵
          </span>
        </Button>

        {/* Las tres formas de entregar el comprobante, al mismo nivel y sin
            color: ninguna es "la" acción después de cobrar — la mayoría de
            las ventas no entrega nada. Lo que sigue es "Nueva venta". */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground"
            onClick={imprimir}
            title="Imprimir ticket (P)"
          >
            Imprimir
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground"
            onClick={compartirWhatsapp}
          >
            WhatsApp
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground"
            onClick={descargarPdf}
            onPointerEnter={precargarPdf}
            onFocus={precargarPdf}
            disabled={isDownloading}
          >
            {isDownloading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Descargar"
            )}
          </Button>
        </div>

        <button
          type="button"
          className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          onClick={() => setDetalleAbierto(true)}
        >
          Ver detalle
        </button>
      </div>

      {/* El detalle completo, a pedido. Es el mismo sheet del historial. */}
      <TicketSheet
        ticket={detalleAbierto ? ticket : null}
        config={config}
        onClose={() => setDetalleAbierto(false)}
      />

      {/* Lo que sale por la impresora al apretar P o "Imprimir". Va porteado
          a body porque el CSS de impresión lo posiciona absoluto y esconde
          todo lo demás: adentro del POS quedaría recortado por los
          `overflow-hidden` del layout. Y solo cuando el sheet NO está abierto,
          que monta el suyo con el mismo id: dos wrappers son dos tickets en
          el mismo papel. */}
      {!detalleAbierto &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            <style>{cssImpresionTicket(anchoTicket)}</style>
            <TicketPrintable
              ticket={ticket}
              config={config}
              qrDataUrl={qrDataUrl}
            />
          </>,
          document.body,
        )}
    </div>
  );
}
