"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatearMoneda } from "@/shared/utils/formatters";
import { etiquetaDeuda, type GrupoDeuda } from "../lib/deuda-por-mes";

function fechaCorta(iso: string): string {
  const [, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}`;
}

/**
 * Lo que debe una clienta, por mes de vencimiento, con los tickets de cada mes
 * a un toque. Lo usan el detalle del cliente y el modal de cobro: la cajera ve
 * lo mismo en los dos lados.
 *
 * Lo vencido va arriba y en rojo: es lo primero que se cobra (el pago cancela
 * lo más viejo primero) y lo que genera recargo.
 */
export function DeudaPorMesLista({
  grupos,
  compacta = false,
}: Readonly<{
  grupos: GrupoDeuda[];
  /** En el modal: sin abrir los tickets por default, menos alto. */
  compacta?: boolean;
}>) {
  const [abiertos, setAbiertos] = useState<Set<string>>(
    () => new Set(compacta ? [] : grupos.slice(0, 1).map((g) => g.clave)),
  );

  if (grupos.length === 0) return null;

  const alternar = (clave: string) =>
    setAbiertos((actual) => {
      const siguiente = new Set(actual);
      if (siguiente.has(clave)) siguiente.delete(clave);
      else siguiente.add(clave);
      return siguiente;
    });

  return (
    <div className="rounded-lg border border-border divide-y divide-border bg-background">
      {grupos.map((grupo) => {
        const abierto = abiertos.has(grupo.clave);
        return (
          <div key={grupo.clave}>
            <button
              type="button"
              onClick={() => alternar(grupo.clave)}
              aria-expanded={abierto}
              className={cn(
                "flex w-full items-center justify-between gap-3 px-3 text-left",
                compacta ? "min-h-11 py-2" : "min-h-12 py-2.5",
              )}
            >
              <span className="flex items-center gap-1.5 min-w-0">
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                    abierto ? "rotate-0" : "-rotate-90",
                  )}
                />
                <span
                  className={cn(
                    "text-sm font-semibold truncate",
                    grupo.vencido ? "text-danger" : "text-foreground",
                  )}
                >
                  {grupo.etiqueta}
                </span>
                <span className="text-[11px] text-muted-foreground shrink-0">
                  · {grupo.deudas.length}{" "}
                  {grupo.deudas.length === 1 ? "compra" : "compras"}
                </span>
              </span>
              <span
                className={cn(
                  "font-mono text-sm font-semibold shrink-0",
                  grupo.vencido ? "text-danger" : "text-foreground",
                )}
              >
                {formatearMoneda(grupo.monto)}
              </span>
            </button>

            {abierto && (
              <ul className="px-3 pb-2.5 space-y-1.5">
                {grupo.deudas.map((deuda) => (
                  <li
                    key={deuda.debitoId}
                    className="flex items-start justify-between gap-3 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-foreground">
                        {etiquetaDeuda(deuda)}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        Compra {fechaCorta(deuda.fecha)} · vence{" "}
                        {fechaCorta(deuda.venceEl)}
                        {deuda.vivo < deuda.monto &&
                          ` · de ${formatearMoneda(deuda.monto)}`}
                      </p>
                    </div>
                    <span className="font-mono text-foreground shrink-0">
                      {formatearMoneda(deuda.vivo)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
