"use client";

import { useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { Download, Sparkles } from "lucide-react";
import { useInstalacionPwa } from "@/shared/lib/use-instalacion-pwa";
import { InstruccionesInstalacion } from "./instrucciones-instalacion";

export function InstallAppWidget({
  isCollapsed,
}: Readonly<{ isCollapsed: boolean }>) {
  const { metodo, instalar } = useInstalacionPwa();
  const [instruccionesAbiertas, setInstruccionesAbiertas] = useState(false);

  // `metodo` es null hasta que monta: la detección necesita el navegador.
  if (!metodo) return null;
  if (metodo.tipo === "instalada" || metodo.tipo === "no-disponible") {
    return null;
  }

  // En iOS no hay prompt nativo, así que el botón abre las instrucciones. Es
  // el caso que antes no mostraba nada: el widget colgaba de un evento que
  // Safari no dispara nunca.
  const alTocar = () => {
    if (metodo.tipo === "prompt") {
      void instalar();
      return;
    }
    setInstruccionesAbiertas(true);
  };

  const titulo =
    metodo.tipo === "abrir-en-navegador"
      ? "Abrir para instalar"
      : "Instalar Comerz";
  const detalle =
    metodo.tipo === "abrir-en-navegador"
      ? "Abrila en el navegador para poder instalarla."
      : "Obtené la experiencia de pantalla completa y mayor velocidad.";
  const textoBoton =
    metodo.tipo === "prompt" ? "Instalar ahora" : "Ver cómo se instala";

  return (
    <>
      <div
        className={`transition-all duration-300 ${isCollapsed ? "" : "w-full rounded-xl border border-border bg-linear-to-b from-promo-from to-promo-to p-4 shadow-sm"}`}
      >
        {isCollapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={alTocar}
                aria-label={titulo}
                className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-card text-primary shadow-sm transition-colors hover:bg-muted"
              >
                <Download className="h-5 w-5" strokeWidth={2.5} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{titulo}</TooltipContent>
          </Tooltip>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-card shadow-sm">
                <Sparkles
                  className="h-4 w-4 text-primary"
                  fill="currentColor"
                />
              </div>
              <div className="min-w-0 leading-tight">
                <p className="text-xs text-muted-foreground">App nativa</p>
                <p className="truncate text-sm font-bold text-foreground">
                  {titulo}
                </p>
              </div>
            </div>
            <p className="text-xs leading-snug text-muted-foreground">
              {detalle}
            </p>
            <button
              type="button"
              onClick={alTocar}
              className="flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-border bg-card text-sm font-medium text-foreground shadow-xs transition-all hover:bg-muted hover:shadow-sm cursor-pointer"
            >
              <Download className="h-4 w-4 text-primary" strokeWidth={2.5} />
              {textoBoton}
            </button>
          </div>
        )}
      </div>

      <InstruccionesInstalacion
        metodo={metodo}
        abierto={instruccionesAbiertas}
        onAbiertoChange={setInstruccionesAbiertas}
      />
    </>
  );
}
