"use client";

import { cn } from "@/lib/utils";
import { formatearMoneda } from "@/shared/utils/formatters";
import {
  coberturaDelPago,
  montosSugeridos,
  type GrupoDeuda,
} from "../lib/deuda-por-mes";
import { DeudaPorMesLista } from "./deuda-por-mes-lista";

/**
 * La parte del modal de cobro que le dice a la cajera QUÉ está cobrando: la
 * deuda por mes, un botón por mes con el monto acumulado (mora incluida), y
 * debajo del monto tipeado, qué meses salda.
 *
 * Lo comparten el modal global (POS / caja) y el de la ficha del cliente.
 */
export function QueCobrar({
  grupos,
  mora,
  montoActual,
  onElegir,
}: Readonly<{
  grupos: GrupoDeuda[];
  mora: number;
  montoActual: number;
  onElegir: (monto: number) => void;
}>) {
  const sugeridos = montosSugeridos(grupos, mora);
  const cobertura = coberturaDelPago(grupos, mora, montoActual);

  return (
    <div className="space-y-2">
      <DeudaPorMesLista grupos={grupos} compacta />

      <div className="flex flex-wrap gap-1.5">
        {sugeridos.map((s) => {
          const elegido = Math.abs(s.monto - montoActual) < 0.005;
          return (
            <button
              key={s.etiqueta}
              type="button"
              onClick={() => onElegir(s.monto)}
              className={cn(
                "min-h-11 rounded-lg border px-3 py-1.5 text-left text-xs transition-colors",
                elegido
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border hover:border-primary/60",
              )}
            >
              <span className="block font-semibold">{s.etiqueta}</span>
              <span className="block font-mono">
                {formatearMoneda(s.monto)}
              </span>
            </button>
          );
        })}
      </div>

      {montoActual > 0 && (
        <p className="text-[11px] text-muted-foreground">
          {cobertura.completos.length > 0 && (
            <>
              Salda{" "}
              <strong className="text-foreground">
                {cobertura.completos.join(", ")}
              </strong>
              .{" "}
            </>
          )}
          {cobertura.parcial && (
            <>
              {cobertura.parcial.etiqueta}: paga{" "}
              {formatearMoneda(cobertura.parcial.cubre)}, quedan{" "}
              <strong className="text-foreground">
                {formatearMoneda(cobertura.parcial.falta)}
              </strong>
              .{" "}
            </>
          )}
          {mora > 0 && montoActual < mora && (
            <>No alcanza a cubrir el recargo por mora.</>
          )}
        </p>
      )}
    </div>
  );
}
