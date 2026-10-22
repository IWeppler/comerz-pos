"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { formatearMoneda } from "@/shared/utils/formatters";
import { pagarCuentaConMpAction } from "../actions/pago-online-cc";
import type { AlcancePagoCc, OpcionPagoCc } from "../lib/pago-online-cc";

/**
 * "Pagar con Mercado Pago" en el resumen de la clienta. Solo aparece si el
 * comercio conectó Mercado Pago y hay deuda (lo decide la página). Al tocar,
 * el server recalcula el monto, crea el pago y la manda a Mercado Pago en la
 * misma pestaña; vuelve al resumen con `?pago=` y ahí se ve el resultado.
 */
export function PagarConMercadoPago({
  token,
  opciones,
}: Readonly<{ token: string; opciones: OpcionPagoCc[] }>) {
  const [cargando, setCargando] = useState<AlcancePagoCc | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pagar = async (alcance: AlcancePagoCc) => {
    setCargando(alcance);
    setError(null);
    const { url, error } = await pagarCuentaConMpAction(token, alcance);
    if (url) {
      window.location.assign(url);
      return;
    }
    setError(error);
    setCargando(null);
  };

  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-foreground">Pagá con Mercado Pago</p>
      <div className="grid gap-2">
        {opciones.map((o, i) => (
          <Button
            key={o.alcance}
            type="button"
            size="lg"
            variant={i === 0 ? "default" : "outline"}
            className="h-12 w-full justify-between"
            disabled={cargando !== null}
            onClick={() => void pagar(o.alcance)}
          >
            <span className="flex items-center">
              {cargando === o.alcance && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {o.etiqueta}
            </span>
            <span className="font-mono">{formatearMoneda(o.total)}</span>
          </Button>
        ))}
      </div>
      {opciones.some((o) => o.mora > 0) && (
        <p className="text-[11px] text-muted-foreground">
          Incluye {formatearMoneda(opciones[0].mora)} de recargo por mora.
        </p>
      )}
      <p className="text-[11px] text-muted-foreground">
        Con tarjeta, dinero en cuenta o lo que tengas en Mercado Pago. El pago se
        registra solo en tu cuenta.
      </p>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
