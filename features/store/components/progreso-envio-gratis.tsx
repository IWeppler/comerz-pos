"use client";

import { progresoEnvioGratis, type ConfigEnvioGratis } from "@/shared/lib/totales-pedido-publico";
import type { CartItemStore } from "@/entities/cart/types";

export function ProgresoEnvioGratis({ items, base, config, destino }: {
  items: CartItemStore[]; base: number; config?: ConfigEnvioGratis | null; destino?: "LOCAL" | "LEJOS" | null;
}) {
  const progreso = progresoEnvioGratis({ items, base, config });
  if (!progreso.aplica || !items.length || (destino === "LEJOS" && config?.envio_gratis_alcance !== "TODOS")) return null;
  const monto = Number(config?.envio_gratis_desde_monto);
  const unidades = Number(config?.envio_gratis_desde_unidades);
  const mostrarMonto = progreso.faltaMonto !== null && (progreso.faltaUnidades === null || progreso.faltaMonto / monto <= progreso.faltaUnidades / unidades);
  const faltan = Math.ceil(progreso.faltaUnidades ?? 0);
  const texto = progreso.alcanzado ? "¡Tenés envío gratis!" : mostrarMonto
    ? `Te faltan $${Math.ceil(progreso.faltaMonto!).toLocaleString("es-AR")} para el envío gratis`
    : faltan === 1 ? "Te falta 1 producto para el envío gratis" : `Te faltan ${faltan} productos para el envío gratis`;
  return <div className="space-y-2 rounded-lg bg-muted/60 p-3 text-xs">
    <p aria-live="polite" className="font-medium">{texto}</p>
    {config?.envio_gratis_alcance !== "TODOS" && !destino && <p className="text-muted-foreground">Para envíos en la localidad del comercio.</p>}
    <div role="progressbar" aria-label="Progreso hacia el envío gratis" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progreso.porcentaje)} className="h-1.5 overflow-hidden rounded-full bg-border">
      {/* El naranja del logo de Comerz, lo único con color en el catálogo.
          Completa, pasa al degradé del logo (naranja → rosa). */}
      <div className="h-full rounded-full transition-[width] duration-200 motion-reduce:transition-none" style={{
        width: `${progreso.porcentaje}%`,
        background: progreso.alcanzado
          ? "linear-gradient(90deg, var(--marca-naranja), var(--marca-rosa))"
          : "var(--marca-naranja)",
      }} />
    </div>
  </div>;
}
