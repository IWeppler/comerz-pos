import { ArrowDownRight, ArrowUpRight } from "lucide-react";

interface GrowthBadgeProps {
  /** null = no hay variación mostrable (ver `etiquetaSinValor`). */
  value: number | null;
  /** "vs. mes anterior": se muestra al lado, en gris. */
  titulo?: string;
  /** Por qué no hay comparación, cuando `value` es null. */
  motivoSinDato?: string;
  /** "s/d" = no hay período anterior; "≈" = sin cambio distinguible del ruido. */
  etiquetaSinValor?: string;
}

/**
 * La variación de un número, como TEXTO y no como pastilla: flecha + % en
 * verde o rojo, y contra qué se compara en gris. El color es lo único que
 * marca la dirección; sin fondo, no compite con el número de arriba.
 */
export function GrowthBadge({
  value,
  titulo,
  motivoSinDato = "Sin datos en el período anterior",
  etiquetaSinValor = "s/d",
}: Readonly<GrowthBadgeProps>) {
  if (value === null) {
    return (
      <span title={motivoSinDato} className="text-xs text-muted-foreground">
        {etiquetaSinValor === "s/d" ? "Sin período anterior para comparar" : "Sin cambios"}
      </span>
    );
  }

  const sube = value >= 0;
  const Flecha = sube ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-xs">
      <span className={`inline-flex shrink-0 items-center gap-0.5 font-medium tabular-nums ${sube ? "text-success" : "text-danger"}`}>
        <Flecha className="size-3.5" />
        {Math.abs(value).toFixed(0)}%
      </span>
      {titulo && <span className="truncate text-muted-foreground">{titulo}</span>}
    </span>
  );
}
