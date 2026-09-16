"use client";

import { useEffect } from "react";
import { Printer, Wallet } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/shared/ui/sheet";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import {
  cssImpresionTicket,
  normalizarAnchoTicket,
} from "@/shared/lib/ancho-ticket";
import { useReciboCcStore } from "@/shared/store/recibo-cc-store";
import { formatTicketMoney } from "@/features/sales/ui/ticket-utils";
import { lineasCuentaRecibo, numeroReciboCC } from "../lib/recibo-cc";
import { ReciboCcPrintable } from "./recibo-cc-printable";

/**
 * El recibo del cobro de cuenta corriente, con el botón de imprimir.
 *
 * Es el hermano de `TicketSheet` para el cobro de deuda: se abre solo cuando
 * un cobro se registró de verdad (el server devolvió el recibo) y muestra los
 * números que quedaron escritos. Montado UNA vez en el layout del panel, lo
 * abren los dos modales de cobro vía `recibo-cc-store`.
 *
 * Imprimir reusa el CSS de impresión del ticket de venta: mismo ancho de papel
 * configurado (58/80 mm), misma regla de esconder la app. Comparten el
 * `#ticket-print-wrapper` sin pisarse porque Radix desmonta el contenido del
 * sheet cerrado, y nunca hay un ticket de venta y un recibo abiertos a la vez.
 */
export function ReciboCcSheet() {
  const recibo = useReciboCcStore((s) => s.recibo);
  const cerrar = useReciboCcStore((s) => s.cerrar);
  const anchoTicket = normalizarAnchoTicket(recibo?.comercio.anchoTicketMm);

  const imprimir = () => {
    if (!recibo) return;
    window.print();
  };

  // P para imprimir, igual que en el ticket de venta.
  useEffect(() => {
    if (!recibo) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "p" || event.ctrlKey || event.metaKey) return;
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      event.preventDefault();
      imprimir();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- imprimir solo depende de `recibo`
  }, [recibo]);

  return (
    <>
      <style>{cssImpresionTicket(anchoTicket)}</style>

      <Sheet open={recibo !== null} onOpenChange={(open) => !open && cerrar()}>
        <SheetContent
          side="right"
          className="ticket-sheet-print-scope w-full md:max-w-110 p-0 flex flex-col h-dvh overflow-hidden bg-background border-l border-border"
        >
          {recibo && (
            <>
              <div className="ticket-screen-only flex min-h-0 flex-1 flex-col">
                <SheetHeader className="flex-row items-center justify-between px-2 md:px-5 py-4 border-b border-border bg-card shrink-0 mt-4 sm:mt-0">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Wallet className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <SheetTitle className="text-md font-semibold text-foreground leading-tight">
                        Recibo de pago
                      </SheetTitle>
                      <p className="text-xs text-muted-foreground leading-tight mt-0.5">
                        #{numeroReciboCC(recibo)} · {recibo.clienteNombre}
                      </p>
                    </div>
                  </div>
                </SheetHeader>

                <div className="flex-1 overflow-y-auto min-h-0">
                  <div className="p-2 space-y-4 md:px-5 md:space-y-6">
                    <div className="rounded-xl border border-border bg-card p-5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                          Pagó
                        </p>
                        <Badge
                          variant={recibo.saldoNuevo > 0 ? "warning" : "success"}
                          className="px-3 py-1 text-[10px] font-bold uppercase tracking-widest"
                        >
                          {recibo.saldoNuevo > 0 ? "Queda saldo" : "Al día"}
                        </Badge>
                      </div>
                      <p className="mt-1 text-3xl font-mono font-medium text-foreground">
                        {formatTicketMoney(recibo.montoBruto)}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {recibo.metodoNombre}
                        {recibo.recargoMetodoMonto > 0 &&
                          ` · incluye ${formatTicketMoney(recibo.recargoMetodoMonto)} de recargo (${recibo.recargoMetodoPorcentaje}%)`}
                      </p>
                    </div>

                    <div className="rounded-xl border border-border bg-card divide-y divide-border">
                      {lineasCuentaRecibo(recibo).map((linea) => (
                        <div
                          key={linea.etiqueta}
                          className="flex items-center justify-between px-4 py-3 gap-4"
                        >
                          <span className="text-xs text-muted-foreground">
                            {linea.etiqueta}
                          </span>
                          <span className="text-xs font-mono font-medium text-foreground">
                            {linea.signo}
                            {formatTicketMoney(linea.monto)}
                          </span>
                        </div>
                      ))}
                      <div className="flex items-center justify-between px-4 py-3 gap-4">
                        <span className="text-xs font-semibold text-foreground">
                          Saldo
                        </span>
                        <span className="text-sm font-mono font-semibold text-foreground">
                          {formatTicketMoney(recibo.saldoNuevo)}
                        </span>
                      </div>
                      {recibo.saldoNuevo > 0 && recibo.fechaVencimiento && (
                        <div className="flex items-center justify-between px-4 py-3 gap-4">
                          <span className="text-xs text-muted-foreground">Vence</span>
                          <span className="text-xs font-mono font-medium text-foreground">
                            {recibo.fechaVencimiento.slice(0, 10).split("-").reverse().join("/")}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="p-2 md:p-5 border-t border-border bg-card shrink-0 flex gap-2">
                  <Button
                    className="flex-1 gap-2 h-11 text-sm font-semibold"
                    onClick={imprimir}
                    title="Imprimir recibo (P)"
                  >
                    <Printer className="h-4 w-4" />
                    Imprimir recibo
                  </Button>
                  <Button
                    variant="outline"
                    className="h-11 text-sm font-semibold"
                    onClick={cerrar}
                  >
                    Cerrar
                  </Button>
                </div>
              </div>

              <ReciboCcPrintable recibo={recibo} />
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
