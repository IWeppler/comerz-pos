"use client";

import { CalendarClock } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * El filtro del ciclo de cobro ("A abonar 15/10"), al lado del de estado y
 * no dentro: se combina con él (por ejemplo "A abonar" + "Vencido" = los que
 * deben de antes). Es un toggle porque tiene dos posiciones; prendido, la
 * tabla muestra solo los del ciclo y los KPI de arriba pasan a contar el
 * ciclo (ver `ClientsView`).
 *
 * Solo existe en comercios con cierre mensual: sin ciclo no se dibuja.
 */
export function FiltroCicloCobro({
  etiqueta,
  cantidad,
  activo,
  onCambiar,
}: Readonly<{
  etiqueta: string;
  cantidad: number;
  activo: boolean;
  onCambiar: (activo: boolean) => void;
}>) {
  return (
    <button
      type="button"
      onClick={() => onCambiar(!activo)}
      aria-pressed={activo}
      className={cn(
        "flex h-11 w-full shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border px-3 text-sm font-medium transition-colors sm:w-auto",
        activo
          ? "border-primary/50 bg-primary/10 text-foreground"
          : "border-border bg-muted text-muted-foreground hover:text-foreground",
      )}
    >
      <CalendarClock
        className={cn("h-4 w-4", activo ? "text-primary" : "text-warning")}
      />
      {etiqueta}
      <span
        className={cn(
          "rounded-md px-1.5 py-0.5 font-mono text-xs",
          activo
            ? "bg-primary/15 text-primary"
            : "bg-background text-muted-foreground",
        )}
      >
        {cantidad}
      </span>
    </button>
  );
}
