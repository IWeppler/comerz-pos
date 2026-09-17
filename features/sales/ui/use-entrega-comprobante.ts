"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { TicketData } from "@/entities/ventas/types";
import type { ConfiguracionPOS } from "@/entities/config/types";
import { buildWhatsappMessage } from "../utils/whatsapp-helper";
import { getTicketSubtotal } from "./ticket-utils";
import { useQrFiscal } from "./use-qr-fiscal";
import {
  registrarEntregaComprobanteAction,
  type OrigenEntregaComprobante,
} from "../actions/registrar-uso";

/**
 * Las tres formas de ENTREGAR un comprobante —imprimir, WhatsApp, PDF— con su
 * telemetría, en un solo lugar.
 *
 * Las usan dos pantallas que no se parecen en nada: el detalle completo
 * (`TicketSheet`, que abre el historial) y el estado de "venta realizada" del
 * POS (`VentaExitosa`, que no muestra el ticket). Lo que NO puede pasar es que
 * el WhatsApp de una diga una cosa y el de la otra otra, o que una cuente el
 * PDF y la otra no: por eso la lógica vive acá y las pantallas solo dibujan
 * botones.
 */
export function useEntregaComprobante(
  ticket: TicketData | null,
  config: ConfiguracionPOS | null,
  origen: OrigenEntregaComprobante,
) {
  const [isDownloading, setIsDownloading] = useState(false);

  // Con factura: el QR de ARCA, generado en el navegador. Null en el ticket
  // interno, que no lo lleva. Va al papel impreso y al PDF.
  const qrDataUrl = useQrFiscal(ticket, config?.cuit);

  /** Se registra y se sigue: la telemetría nunca bloquea la entrega. */
  const registrarUso = (metodo: "PDF" | "WHATSAPP" | "IMPRESION") => {
    void registrarEntregaComprobanteAction(metodo, origen);
  };

  const compartirWhatsapp = () => {
    if (!ticket) return;

    const mensaje = buildWhatsappMessage(
      ticket,
      config,
      getTicketSubtotal(ticket),
    );
    const url = `https://wa.me/?text=${encodeURIComponent(mensaje)}`;
    window.open(url, "_blank");
    registrarUso("WHATSAPP");
  };

  /**
   * Imprimir es el diálogo del sistema sobre el template de 58/80mm.
   *
   * Se cuenta ANTES de abrirlo: `window.print()` bloquea el hilo hasta que la
   * persona cierra el diálogo, y no devuelve si imprimió o canceló. O sea que
   * este evento significa "abrió el diálogo", no "salió el papel" — y así hay
   * que leerlo.
   */
  const imprimir = () => {
    if (!ticket) return;
    registrarUso("IMPRESION");
    window.print();
  };

  /**
   * `@react-pdf/renderer` se carga recién cuando hace falta.
   *
   * Es la dependencia más pesada de la app —342 kB gzip entre sus dos chunks—
   * y entraba al bundle de /pos por esta pantalla, o sea que TODA vendedora la
   * bajaba en cada carga de la terminal por si alguna vez tocaba este botón.
   * Con el import acá adentro, la paga solo quien descarga un comprobante.
   *
   * `precargarPdf` la trae al pasar el mouse o al enfocar el botón: en desktop
   * llega antes del click y en mobile arranca con el primer toque. El módulo
   * queda cacheado, así que llamarlo dos veces no lo baja dos veces.
   */
  const precargarPdf = () => {
    void import("./download-sale-receipt-pdf");
  };

  const descargarPdf = async () => {
    if (!ticket) return;

    setIsDownloading(true);
    const { downloadSaleReceiptPdf } =
      await import("./download-sale-receipt-pdf");
    const success = await downloadSaleReceiptPdf(ticket, config, qrDataUrl);
    setIsDownloading(false);

    // El éxito no se avisa: el navegador ya muestra la descarga y el archivo
    // aparece solo. El error SÍ, que es el único caso en que no pasa nada
    // visible y hay que decir por qué.
    if (!success) {
      toast.error("Ocurrió un error al generar el PDF");
      return;
    }

    // Solo cuando el archivo se generó de verdad: contar el intento fallido
    // como uso inflaría justo el número que hay que decidir.
    registrarUso("PDF");
  };

  return {
    qrDataUrl,
    isDownloading,
    compartirWhatsapp,
    imprimir,
    precargarPdf,
    descargarPdf,
  };
}
