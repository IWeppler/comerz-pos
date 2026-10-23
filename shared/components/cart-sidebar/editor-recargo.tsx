"use client";

import { useState } from "react";
import {
  ATAJOS_RECARGO_PCT,
  RECARGO_PCT_MAX,
  formatearPct,
  normalizarPctRecargo,
} from "@/shared/lib/recargo-ticket";

/**
 * Elegir el porcentaje de recargo de ESTE ticket: el de cuenta corriente
 * ("Modificar" el recargo de fiar) o el libre de una venta de contado.
 *
 * Los atajos son los de siempre en un mostrador (0 · 5 · 10 · 15) y un campo
 * numérico para cualquier otro. El 0 es "sin recargo". "Restaurar" vuelve al
 * porcentaje del comercio, que es lo que rige en cuenta corriente si nadie
 * toca nada; en el recargo libre no hay nada que restaurar (se manda
 * `hayEleccion={false}`).
 *
 * Lo que se elige es solo el PORCENTAJE; el monto lo calcula el POS para
 * mostrarlo y el servidor otra vez para cobrarlo (y para pedir el permiso si
 * se aparta del default).
 */
export function EditorRecargo({
  pctActual,
  pctDefault,
  hayEleccion,
  onElegir,
  onCerrar,
  deshabilitado = false,
}: Readonly<{
  /** El porcentaje que rige ahora para el ticket. */
  pctActual: number;
  /** El del comercio (`cc_recargo_default`). */
  pctDefault: number;
  /** true si la vendedora ya lo cambió: habilita "Restaurar". */
  hayEleccion: boolean;
  onElegir: (pct: number | null) => void;
  onCerrar: () => void;
  deshabilitado?: boolean;
}>) {
  const [texto, setTexto] = useState("");
  const [error, setError] = useState<string | null>(null);

  const aplicarTexto = () => {
    const pct = normalizarPctRecargo(texto);
    if (pct === null) {
      setError(`Poné un número de 0 a ${RECARGO_PCT_MAX}.`);
      return;
    }
    setError(null);
    onElegir(pct);
    onCerrar();
  };

  const elegir = (pct: number | null) => {
    onElegir(pct);
    onCerrar();
  };

  const chip = (activo: boolean) =>
    `min-h-9 min-w-11 rounded-md border px-2.5 text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer ${
      activo
        ? "border-primary bg-primary/10 text-foreground"
        : "border-border text-muted-foreground hover:border-primary hover:text-foreground"
    }`;

  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/30 p-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {ATAJOS_RECARGO_PCT.map((pct) => (
          <button
            key={pct}
            type="button"
            disabled={deshabilitado}
            onClick={() => elegir(pct)}
            aria-pressed={pctActual === pct}
            className={chip(pctActual === pct)}
          >
            {pct === 0 ? "Sin recargo" : `${pct}%`}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1.5">
        <input
          type="text"
          inputMode="decimal"
          value={texto}
          disabled={deshabilitado}
          onChange={(e) => {
            setTexto(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              aplicarTexto();
            }
          }}
          placeholder="Otro %"
          aria-label="Otro porcentaje de recargo"
          aria-invalid={error !== null}
          className="h-9 w-24 rounded-md border border-border bg-background px-2 text-sm font-mono outline-none focus:border-primary"
        />
        <button
          type="button"
          disabled={deshabilitado || texto.trim() === ""}
          onClick={aplicarTexto}
          className="min-h-9 rounded-md border border-border px-3 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-foreground disabled:opacity-50 cursor-pointer"
        >
          Aplicar
        </button>
        <button
          type="button"
          onClick={onCerrar}
          className="ml-auto text-[11px] uppercase tracking-wide text-muted-foreground underline underline-offset-2 hover:text-foreground cursor-pointer"
        >
          Cerrar
        </button>
      </div>

      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}

      {hayEleccion && pctDefault !== pctActual ? (
        <button
          type="button"
          disabled={deshabilitado}
          onClick={() => elegir(null)}
          className="text-[11px] uppercase tracking-wide text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50 cursor-pointer"
        >
          Restaurar {formatearPct(pctDefault)}
        </button>
      ) : null}
    </div>
  );
}
