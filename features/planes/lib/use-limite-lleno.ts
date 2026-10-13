"use client";

import { useCallback } from "react";
import { toast } from "@/shared/ui/toast";
import { useContextoPlan } from "@/features/planes/ui/plan-provider";
import { planQueSubeElLimite } from "./beneficios-al-subir";
import type { ReglasPlan } from "@/shared/lib/planes";

/**
 * ¿Se agotó un límite del plan?, más el aviso listo para usar.
 *
 * Existe para apagar las PUERTAS de una acción cuando hay varias y están
 * repartidas: cargar productos se dispara desde cinco lugares distintos
 * (carga rápida en mobile y en desktop, carga manual, "Nuevo Producto",
 * remito/planilla). Envolver cada uno con el medidor llenaría la barra de
 * paneles repetidos, así que acá se devuelve un booleano y un `avisar()`, y
 * cada disparador decide cómo se apaga.
 *
 * El aviso es un toast con acción y no un modal: varios de esos disparadores
 * viven adentro de un dropdown, y abrir un Dialog desde ahí pelea por el foco
 * con el menú que se está cerrando.
 *
 * Fail-open igual que el resto del paywall: sin plan cargado o sin límite
 * declarado, nunca está lleno.
 */
export function useLimiteLleno(
  claveLimite: keyof ReglasPlan,
  usado: number | undefined,
  etiquetaPlural: string,
) {
  const contexto = useContextoPlan();
  const limiteBruto = contexto?.reglasActuales?.[claveLimite];
  const limite = typeof limiteBruto === "number" ? limiteBruto : null;

  const lleno =
    !contexto?.sinPlan &&
    typeof usado === "number" &&
    limite !== null &&
    usado >= limite;

  const destino =
    limite !== null ? planQueSubeElLimite(contexto, claveLimite, limite) : null;

  const avisar = useCallback(() => {
    if (!lleno) return;

    toast.error(`Llegaste a los ${limite} ${etiquetaPlural} de tu plan`, {
      description: destino
        ? `Podés seguir vendiendo y editando lo que ya tenés. Para cargar más, el plan ${destino.nombre} te permite ${destino.limite === null ? "los que necesites" : destino.limite}.`
        : "Podés seguir vendiendo y editando lo que ya tenés. Escribinos para ampliarlo.",
      action: destino
        ? {
            label: "Ver planes",
            onClick: () => {
              window.location.href = "/perfil?tab=plan";
            },
          }
        : undefined,
    });
  }, [lleno, limite, etiquetaPlural, destino]);

  return { lleno, limite, avisar };
}
