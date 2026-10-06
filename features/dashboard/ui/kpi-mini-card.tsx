import type { ReactNode } from "react";

interface KpiMiniCardProps {
  label: string;
  value: string;
  sublabel: string;
  rightSlot?: ReactNode;
}

/** Card compacta para la grilla 2x2 de KPIs — v2 del panel: nada de tamaño
 * "héroe" acá (eso quedó en v1 y generaba scroll), valores en un escalón
 * más chico para no cortar en la columna angosta (40% del ancho).
 *
 * En el bento pasó al revés de lo que decía este comentario: las KPIs se
 * quedan con el alto que Insights no necesita (`h-full` + `flex-1` en la
 * grilla), porque son cuatro números que se leen de lejos y compactarlas para
 * darle aire a una lista de texto era el reparto equivocado. */
export function KpiMiniCard({
  label,
  value,
  sublabel,
  rightSlot,
}: Readonly<KpiMiniCardProps>) {
  return (
    <div className="bg-card border border-border rounded-xl px-3.5 py-3 flex flex-col justify-between gap-1.5 min-w-0 h-full">
      <div className="flex items-center justify-between gap-1">
        <span className="text-xs font-medium text-muted-foreground truncate">
          {label}
        </span>
        {rightSlot}
      </div>
      <p className="font-sans tabular-nums text-xl sm:text-2xl font-semibold text-foreground truncate">
        {value}
      </p>
      <p className="text-xs text-muted-foreground truncate">{sublabel}</p>
    </div>
  );
}
