"use client";

import { useEffect, type ReactNode } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/shared/ui/sheet";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import {
  Share2,
  Download,
  Loader2,
  ShoppingBasket,
  Calendar,
  CreditCard,
  User,
  Hash,
  Package,
  Tag,
  Printer,
  Wallet,
} from "lucide-react";
import { TicketData } from "@/entities/ventas/types";
import { ConfiguracionPOS } from "@/entities/config/types";
import { TicketPrintable } from "./ticket-printable";
import { useEntregaComprobante } from "./use-entrega-comprobante";
import {
  fechaCorta,
  numeroComprobanteFiscal,
  tituloComprobante,
} from "@/shared/lib/comprobante-fiscal-ticket";
import {
  formatTicketMoney,
  getTicketFinancialSummary,
  getTicketSubtotal,
} from "./ticket-utils";
import {
  cssImpresionTicket,
  normalizarAnchoTicket,
} from "@/shared/lib/ancho-ticket";
import type { OrigenEntregaComprobante } from "../actions/registrar-uso";

interface TicketSheetProps {
  ticket: TicketData | null;
  config: ConfiguracionPOS | null;
  onClose: () => void;
  /**
   * Desde dónde se abrió este ticket. Solo lo usa la telemetría, y sirve
   * para la pregunta que sigue a "¿usan el PDF?": si se descarga al cerrar la
   * venta o recién después, buscándola en el historial.
   */
  origen?: OrigenEntregaComprobante;
}

export function TicketSheet({
  ticket,
  config,
  onClose,
  origen = "POS",
}: Readonly<TicketSheetProps>) {
  const fiscal = ticket?.fiscal ?? null;
  const {
    qrDataUrl,
    isDownloading,
    compartirWhatsapp,
    imprimir,
    precargarPdf,
    descargarPdf,
  } = useEntregaComprobante(ticket, config, origen);

  // El ancho del papel del comercio. Sin configurar son 80mm, que es lo que
  // se imprimía antes de que esto existiera.
  const anchoTicket = normalizarAnchoTicket(config?.ancho_ticket_mm);

  const subtotalCarrito = getTicketSubtotal(ticket);
  const { esFiado, montoCobrado, montoPendiente } =
    getTicketFinancialSummary(ticket);
  const tieneSaldoPendiente =
    Number(ticket?.montoPendiente ?? montoPendiente) > 0.05 ||
    montoPendiente > 0.05;
  const estadoEsFiado =
    esFiado || Boolean(ticket?.esFiadoDirecto) || tieneSaldoPendiente;
  const badgeEstadoLabel = estadoEsFiado
    ? tieneSaldoPendiente
      ? "PENDIENTE DE PAGO"
      : "CUENTA CORRIENTE"
    : "PAGADO";
  const estadoTexto = estadoEsFiado
    ? tieneSaldoPendiente
      ? "Pendiente de pago"
      : "Cuenta corriente"
    : "Pagado";

  /**
   * P para imprimir, con el ticket abierto.
   *
   * Mismo criterio que los atajos del carrito: la mano ya está en el teclado
   * y el ticket es la pantalla donde se sabe qué se quiere. Se ignora si el
   * foco está en un input —no hay ninguno en este sheet hoy, pero el día que
   * lo haya, tipear "p" no puede mandar a la impresora— y con Ctrl/Cmd
   * apretado, que es el atajo de imprimir del navegador y hace lo mismo.
   */
  useEffect(() => {
    if (!ticket) return;

    const alTeclado = (e: KeyboardEvent) => {
      if (e.key?.toLowerCase() !== "p") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const foco = document.activeElement;
      const editando =
        foco instanceof HTMLElement &&
        (foco.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(foco.tagName));
      if (editando) return;

      e.preventDefault();
      imprimir();
    };

    window.addEventListener("keydown", alTeclado);
    return () => window.removeEventListener("keydown", alTeclado);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket]);

  return (
    <>
      <style>{cssImpresionTicket(anchoTicket)}</style>

      <Sheet
        open={ticket !== null}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <SheetContent
          side="right"
          className="ticket-sheet-print-scope w-full md:max-w-110 p-0 flex flex-col h-dvh overflow-hidden bg-background border-l border-border"
        >
          <div className="ticket-screen-only flex min-h-0 flex-1 flex-col">
            <SheetHeader className="flex-row items-center justify-between px-2 md:px-5 py-4 border-b border-border bg-card shrink-0 mt-4 sm:mt-0">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                  <ShoppingBasket className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <SheetTitle className="text-md font-semibold text-foreground leading-tight">
                    {fiscal ? tituloComprobante(fiscal.tipo) : "Detalle de venta"}
                  </SheetTitle>
                  <p className="text-xs text-muted-foreground leading-tight mt-0.5">
                    {fiscal ? numeroComprobanteFiscal(fiscal) : `#${ticket?.nroRecibo}`}
                  </p>
                </div>
              </div>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto min-h-0">
              <div className="p-2 space-y-4 md:px-5 md:space-y-6">
                <div className="rounded-xl border border-border bg-card p-5 text-center">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Total
                    </p>

                    <Badge
                      variant={estadoEsFiado ? "warning" : "success"}
                      className="px-3 py-1 text-[10px] font-bold uppercase tracking-widest"
                    >
                      {badgeEstadoLabel}
                    </Badge>
                  </div>
                  <p className="mt-1 text-3xl font-mono font-medium text-left text-foreground">
                    {formatTicketMoney(ticket?.total)}
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-muted-foreground/70" />
                    <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">
                      Detalle de Transaccion
                    </h3>
                  </div>

                  <div className="rounded-xl border border-border bg-card divide-y divide-border">
                    <DetailRow
                      icon={<Hash className="w-3.5 h-3.5" />}
                      label={fiscal ? "Nro. comprobante" : "Nro. recibo"}
                      value={fiscal ? numeroComprobanteFiscal(fiscal) : `#${ticket?.nroRecibo}`}
                    />
                    {fiscal && (
                      <DetailRow
                        icon={<Hash className="w-3.5 h-3.5" />}
                        label={`CAE${fiscal.ambiente === "HOMOLOGACION" ? " (prueba)" : ""}`}
                        value={fiscal.cae}
                      />
                    )}
                    {fiscal && (
                      <DetailRow
                        icon={<Calendar className="w-3.5 h-3.5" />}
                        label="Vto. CAE"
                        value={fechaCorta(fiscal.caeVencimiento)}
                      />
                    )}
                    <DetailRow
                      icon={<Calendar className="w-3.5 h-3.5" />}
                      label="Fecha y hora"
                      value={
                        ticket?.fecha ||
                        new Date().toLocaleString("es-AR", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })
                      }
                    />
                    <DetailRow
                      icon={<User className="w-3.5 h-3.5" />}
                      label="Vendedor"
                      value={ticket?.vendedor || "Administrador"}
                    />
                    <DetailRow
                      icon={<User className="w-3.5 h-3.5" />}
                      label="Cliente"
                      value={ticket?.clienteNombre || "Consumidor final"}
                    />
                    {(ticket?.descuentoMonto ?? 0) > 0 && (
                      <DetailRow
                        icon={<Tag className="w-3.5 h-3.5 text-neutral-900" />}
                        label="Promocion"
                        value={ticket?.promocionNombre || "Descuento aplicado"}
                      />
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Wallet className="w-4 h-4 text-muted-foreground/70" />
                    <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">
                      Totales
                    </h3>
                  </div>

                  <div className="divide-y divide-border rounded-xl border border-border bg-card overflow-hidden">
                    <DetailRow
                      icon={<CreditCard className="w-3.5 h-3.5" />}
                      label="Total de la venta"
                      value={formatTicketMoney(ticket?.total)}
                    />
                    <DetailRow
                      icon={<CreditCard className="w-3.5 h-3.5" />}
                      label={estadoEsFiado ? "Pagado (Anticipo)" : "Pagado"}
                      value={formatTicketMoney(
                        estadoEsFiado ? montoCobrado : ticket?.total,
                      )}
                    />
                    <DetailRow
                      icon={<Wallet className="w-3.5 h-3.5" />}
                      label="Saldo pendiente"
                      value={formatTicketMoney(
                        estadoEsFiado ? montoPendiente : 0,
                      )}
                    />
                    <div className="flex items-center justify-between px-4 py-3 gap-4">
                      <span className="text-xs text-muted-foreground">
                        Estado
                      </span>
                      <span
                        className={`text-xs font-semibold ${
                          estadoEsFiado ? "text-warning" : "text-success"
                        }`}
                      >
                        {estadoTexto}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Package className="w-4 h-4 text-muted-foreground" />
                    <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">
                      Productos ({ticket?.items.length ?? 0})
                    </h3>
                  </div>

                  <div className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
                    {ticket?.items.map((item, idx) => {
                      const precioUnidad =
                        item.precioUnitario || item.precio || 0;
                      return (
                        <div
                          key={idx}
                          className="flex items-start justify-between gap-3 px-4 py-3"
                        >
                          <div className="w-6 h-6 rounded-md bg-muted flex items-center justify-center shrink-0 mt-0.5">
                            <span className="text-[10px] font-bold text-muted-foreground">
                              {item.cantidad}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground truncate leading-tight">
                              {item.nombre}
                            </p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {item.variante}
                              {item.cantidad > 1 && (
                                <span className="font-mono text-muted-foreground/70">
                                  {formatTicketMoney(precioUnidad)} c/u
                                </span>
                              )}
                            </p>
                          </div>
                          <p className="font-mono text-sm font-medium text-foreground shrink-0">
                            {formatTicketMoney(precioUnidad * item.cantidad)}
                          </p>
                        </div>
                      );
                    })}

                    <div className="px-4 py-3 bg-muted/40 space-y-1.5 border-t border-border">
                      <div className="flex justify-between font-mono text-xs text-muted-foreground">
                        <span>SUBTOTAL</span>
                        <span>{formatTicketMoney(subtotalCarrito)}</span>
                      </div>

                      {(ticket?.descuentoMonto ?? 0) > 0 ? (
                        <div className="flex justify-between font-mono text-xs text-success font-bold">
                          <span>DESC. ({ticket?.promocionNombre})</span>
                          <span>
                            -{formatTicketMoney(ticket?.descuentoMonto)}
                          </span>
                        </div>
                      ) : (
                        <div className="flex justify-between font-mono text-xs text-muted-foreground">
                          <span>DESCUENTOS</span>
                          <span>$0</span>
                        </div>
                      )}

                      {/* Con qué lista se cobró. Solo si no fue el precio
                          base: en una venta normal no hay nada que aclarar. */}
                      {ticket?.listaPrecioNombre ? (
                        <div className="flex justify-between font-mono text-xs font-bold text-warning">
                          <span className="uppercase">Lista</span>
                          <span className="uppercase">
                            {ticket.listaPrecioNombre}
                          </span>
                        </div>
                      ) : null}

                      {(ticket?.recargoMetodoMonto ?? 0) > 0 ? (
                        <div className="flex justify-between font-mono text-xs text-warning font-bold">
                          <span className="uppercase">
                            {ticket?.recargoMetodoEtiqueta || "Recargo método"}
                          </span>
                          <span>
                            +{formatTicketMoney(ticket?.recargoMetodoMonto)}
                          </span>
                        </div>
                      ) : null}

                      <div className="my-1" />
                      <div className="flex justify-between font-mono text-sm font-semibold text-foreground">
                        <span>TOTAL</span>
                        <span>{formatTicketMoney(ticket?.total)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="shrink-0 border-t border-border bg-card px-5 py-4 flex flex-col gap-3 z-10">
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1 gap-2 h-11 text-sm font-semibold"
                  onClick={descargarPdf}
                  onPointerEnter={precargarPdf}
                  onFocus={precargarPdf}
                  disabled={isDownloading || !ticket}
                >
                  {isDownloading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4" />
                  )}
                  Descargar
                </Button>
                <Button
                  className="flex-1 gap-2 h-11 text-sm font-semibold bg-[#25D366] hover:bg-[#1ebe5d] text-white border-0"
                  onClick={compartirWhatsapp}
                >
                  <Share2 className="w-4 h-4" />
                  WhatsApp
                </Button>

                {/* IMPRIMIR: ícono chico, sin texto y sin robarle ancho a los
                    otros dos. La impresora es de la vendedora que ya sabe que
                    la tiene; el PDF y WhatsApp son las acciones que se
                    descubren leyendo. El atajo va en el `title` porque un
                    <kbd> acá sería más ruido que el botón entero. */}
                <Button
                  variant="outline"
                  size="icon"
                  className="h-11 w-11 shrink-0"
                  onClick={imprimir}
                  disabled={!ticket}
                  title="Imprimir ticket (P)"
                  aria-label="Imprimir ticket"
                >
                  <Printer className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          <TicketPrintable ticket={ticket} config={config} qrDataUrl={qrDataUrl} />
        </SheetContent>
      </Sheet>
    </>
  );
}

function DetailRow({
  icon,
  label,
  value,
}: {
  icon?: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3 gap-4">
      <span className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
        <span className="text-muted-foreground/60">{icon}</span>
        {label}
      </span>
      <span className="text-xs font-mono font-medium text-foreground text-right truncate max-w-[55%]">
        {value}
      </span>
    </div>
  );
}
