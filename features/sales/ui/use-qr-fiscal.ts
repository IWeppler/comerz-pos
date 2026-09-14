"use client";

import { useEffect, useState } from "react";
import type { TicketData } from "@/entities/ventas/types";
import { urlQrArca } from "@/shared/lib/comprobante-fiscal-ticket";

/**
 * El QR de la factura (RG 4892) como data URL, o null si el ticket no es
 * fiscal. Se genera en el navegador con `qrcode`, que se carga recién cuando
 * hay una factura que imprimir: un comercio con ticket interno no baja la
 * librería nunca.
 */
export function useQrFiscal(
  ticket: TicketData | null,
  cuitEmisor: string | null | undefined,
): string | null {
  const [qr, setQr] = useState<{ clave: string; dataUrl: string } | null>(null);

  const fiscal = ticket?.fiscal ?? null;
  const clave = fiscal && cuitEmisor ? `${fiscal.cae}|${cuitEmisor}` : null;

  useEffect(() => {
    if (!fiscal || !cuitEmisor || !clave) return;
    let vigente = true;
    import("@/features/arca/lib/qr-imagen").then(async ({ generarQrDataUrl }) => {
      const dataUrl = await generarQrDataUrl(urlQrArca(fiscal, cuitEmisor));
      if (vigente) setQr({ clave, dataUrl });
    });
    return () => {
      vigente = false;
    };
  }, [fiscal, cuitEmisor, clave]);

  return qr && qr.clave === clave ? qr.dataUrl : null;
}
