"use client";

import { CloudOff, WifiOff } from "lucide-react";
import { useHayConexion } from "@/shared/hooks/use-conexion";
import {
  antiguedadEnPalabras,
  hayQueAvisar,
} from "@/shared/lib/antiguedad-dato";

/**
 * "Sin conexión — precios de hace 12 minutos".
 *
 * Va donde se muestra catálogo guardado (POS e Inventario). Es la contraparte
 * obligatoria del cache offline: sin fecha a la vista, un precio viejo se lee
 * igual que uno actual, y la vendedora cobra con él.
 *
 * NO bloquea nada ni pide confirmación. En el mostrador, un cartel que hay que
 * cerrar antes de seguir cuesta más de lo que ahorra: esto informa y se queda
 * quieto.
 */
export function AvisoDatosGuardados({
  actualizadoEn,
  que = "Datos",
}: Readonly<{
  /** `dataUpdatedAt` de React Query: cuándo respondió el server por última vez. */
  actualizadoEn: number | undefined;
  /** Qué es lo que está viejo, para que la frase diga algo: "Precios", "Stock". */
  que?: string;
}>) {
  const hayConexion = useHayConexion();

  if (!hayQueAvisar(actualizadoEn, hayConexion)) return null;

  return (
    <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
      {hayConexion ? (
        <CloudOff className="h-3.5 w-3.5 shrink-0" />
      ) : (
        <WifiOff className="h-3.5 w-3.5 shrink-0" />
      )}
      <span>
        {hayConexion ? (
          <>
            {que} de {antiguedadEnPalabras(actualizadoEn!)}.
          </>
        ) : (
          <>
            Sin conexión. {que} de {antiguedadEnPalabras(actualizadoEn!)},
            guardados en este dispositivo.
          </>
        )}
      </span>
    </div>
  );
}
