import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

interface KpiMiniCardProps {
  label: string;
  value: string;
  /** La línea de abajo: la variación (`GrowthBadge`) o un dato de contexto. */
  pie: ReactNode;
  icono: LucideIcon;
  /** Un dato chico al lado del título ("32% de margen", "41 ventas"). */
  detalle?: string;
}

/**
 * Una tarjeta de número del panel (ver `KpiFranja`).
 *
 * Tarjeta blanca propia (12/10/2026, referencias de Nacho): título arriba a la
 * izquierda, ícono de contorno en un círculo arriba a la derecha, el número
 * grande y la variación como texto abajo. Sin fondos de color: el número es
 * lo que se lee.
 */
export function KpiMiniCard({ label, value, pie, icono: Icono, detalle }: Readonly<KpiMiniCardProps>) {
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="flex min-h-10 items-start justify-between gap-2">
        <p className="min-w-0 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{label}</span>
          {detalle && <span className="mt-0.5 block truncate text-xs">{detalle}</span>}
        </p>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground">
          <Icono className="size-4" strokeWidth={1.75} />
        </span>
      </div>
      <div className="min-w-0 space-y-1.5">
        <p className="truncate text-2xl font-semibold tracking-tight tabular-nums text-foreground sm:text-[28px]">
          {value}
        </p>
        <div className="min-w-0 truncate">{pie}</div>
      </div>
    </div>
  );
}

/** Las cuatro tarjetas: 2×2 en celular, 4 en fila desde lg. */
export function KpiFranja({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>;
}
