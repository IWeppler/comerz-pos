import { ArrowUpRight, ArrowDownRight } from "lucide-react";

interface GrowthBadgeProps {
  /** null = no hay variación mostrable (ver `etiquetaSinValor`). */
  value: number | null;
  /** "vs. mes anterior" — se muestra como title, para que el % se entienda
   * contra qué se mide sin agrandar la card. */
  titulo?: string;
  /** Por qué no hay comparación, cuando `value` es null. */
  motivoSinDato?: string;
  /** Qué se muestra cuando no hay valor. "s/d" es "no hay período anterior";
   * "≈" es "no hay cambio distinguible del ruido", que es información y no
   * ausencia de dato — por eso se distinguen. */
  etiquetaSinValor?: string;
}

export function GrowthBadge({
  value,
  titulo,
  motivoSinDato = "Sin datos en el período anterior",
  etiquetaSinValor = "s/d",
}: Readonly<GrowthBadgeProps>) {
  // Sin período anterior no se inventa un +0% verde (se leería como "igual
  // que antes" cuando en realidad no hay con qué comparar).
  if (value === null) {
    return (
      <span
        title={motivoSinDato}
        className="inline-flex shrink-0 items-center text-xs font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground"
      >
        {etiquetaSinValor}
      </span>
    );
  }

  const isPositive = value >= 0;
  return (
    <span
      title={titulo}
      className={`inline-flex shrink-0 items-center gap-0.5 text-xs font-medium tabular-nums px-1.5 py-0.5 rounded-full ${
        isPositive
          ? "bg-success-subtle text-success"
          : "bg-danger-subtle text-danger"
      }`}
    >
      {isPositive ? (
        <ArrowUpRight className="w-3 h-3" />
      ) : (
        <ArrowDownRight className="w-3 h-3" />
      )}
      {isPositive ? "+" : ""}
      {value.toFixed(0)}%
    </span>
  );
}
