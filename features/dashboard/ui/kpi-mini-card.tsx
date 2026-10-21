import type { ReactNode } from "react";

interface KpiMiniCardProps {
  label: string;
  value: string;
  /** Arriba a la derecha: la variación (`GrowthBadge`). */
  variacion: ReactNode;
  /** Un dato chico debajo del título ("32% de margen", "41 ventas"). */
  detalle?: string;
  /** Color del número. Por defecto el texto principal; el rojo solo para un
   * valor que está mal (margen negativo), no para decorar. */
  valorClassName?: string;
}

/**
 * Una tarjeta de número del panel (ver `KpiFranja`).
 *
 * Minimalista (13/10/2026): título arriba a la izquierda, la variación arriba
 * a la derecha y el número grande abajo. Sin íconos ni leyenda de contra qué
 * se compara: el número es lo que se lee.
 */
export function KpiMiniCard({ label, value, variacion, detalle, valorClassName = "text-foreground" }: Readonly<KpiMiniCardProps>) {
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="flex min-h-10 items-start justify-between gap-2">
        <p className="min-w-0 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{label}</span>
          {detalle && <span className="mt-0.5 block truncate text-xs">{detalle}</span>}
        </p>
        <div className="shrink-0 pt-0.5">{variacion}</div>
      </div>
      <p className={`truncate text-2xl font-semibold tracking-tight tabular-nums sm:text-[28px] ${valorClassName}`}>
        {value}
      </p>
    </div>
  );
}

/** Las cuatro tarjetas: 2×2 en celular, 4 en fila desde lg. */
export function KpiFranja({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>;
}
