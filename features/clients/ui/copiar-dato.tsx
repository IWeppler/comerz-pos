"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Un dato del resumen público (alias, monto) con botón de copiar.
 *
 * El botón ES la fila entera: en el celular de la clienta el blanco táctil
 * tiene que ser grande, y lo que quiere hacer con el alias es una sola cosa.
 * Si el portapapeles no está disponible (navegador viejo, http) el dato queda
 * a la vista y seleccionable igual.
 */
export function CopiarDato({
  etiqueta,
  valor,
  textoACopiar,
  className,
}: Readonly<{
  etiqueta: string;
  /** Lo que se ve. */
  valor: string;
  /** Lo que se copia, si no es lo que se ve (el monto sin "$" ni puntos). */
  textoACopiar?: string;
  className?: string;
}>) {
  const [copiado, setCopiado] = useState(false);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(textoACopiar ?? valor);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Sin portapapeles: el dato sigue a la vista para copiarlo a mano.
    }
  };

  return (
    <button
      type="button"
      onClick={copiar}
      className={cn(
        "w-full min-h-11 flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2 text-left transition-colors hover:bg-muted active:scale-[0.99]",
        className,
      )}
    >
      <span className="min-w-0">
        <span className="block text-[11px] text-muted-foreground">
          {etiqueta}
        </span>
        <span className="block font-mono text-sm font-semibold text-foreground break-all select-all">
          {valor}
        </span>
      </span>
      <span
        className={cn(
          "shrink-0 inline-flex items-center gap-1 text-xs font-medium",
          copiado ? "text-success" : "text-primary",
        )}
        aria-live="polite"
      >
        {copiado ? (
          <>
            <Check className="size-4" /> Copiado
          </>
        ) : (
          <>
            <Copy className="size-4" /> Copiar
          </>
        )}
      </span>
    </button>
  );
}
