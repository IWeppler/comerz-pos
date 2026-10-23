import { AlertTriangle, Infinity as InfinityIcon } from "lucide-react";
import type { UsoLimite } from "@/shared/lib/suscripcion";
import { nivelDeUso, porcentajeDeUso } from "@/shared/lib/suscripcion";

/**
 * "Uso de tu plan". Sólo se listan límites que EXISTEN en `planes.reglas` y
 * cuyo uso se puede contar de verdad; los que no se pueden contar todavía se
 * muestran como dato del plan, sin barra y sin número inventado.
 */
export function UsoDelPlanSeccion({ limites }: { limites: UsoLimite[] }) {
  if (limites.length === 0) return null;

  return (
    <section aria-labelledby="uso-plan-titulo" className="space-y-4">
      <div>
        <h3
          id="uso-plan-titulo"
          className="text-sm font-semibold text-foreground"
        >
          Uso de tu plan
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Cuánto estás usando de lo que incluye tu plan.
        </p>
      </div>

      <ul className="grid gap-4 sm:grid-cols-2">
        {limites.map((limite) => (
          <li
            key={limite.clave}
            className="rounded-xl border border-border bg-card p-4"
          >
            <FilaLimite limite={limite} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function FilaLimite({ limite }: { limite: UsoLimite }) {
  const nivel = nivelDeUso(limite);
  const porcentaje = porcentajeDeUso(limite);

  const colorBarra =
    nivel === "lleno"
      ? "bg-danger"
      : nivel === "cerca"
        ? "bg-warning"
        : "bg-primary";

  return (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-foreground">
          {limite.nombre}
        </span>
        <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
          {nivel === "sin-limite" ? (
            <span className="inline-flex items-center gap-1 font-medium text-foreground">
              <InfinityIcon className="h-3.5 w-3.5" aria-hidden="true" />
              Sin límite
            </span>
          ) : nivel === "desconocido" ? (
            <span>Hasta {limite.limite}</span>
          ) : (
            <span className="font-semibold text-foreground">
              {limite.usado} de {limite.limite}
            </span>
          )}
        </span>
      </div>

      {porcentaje !== null && (
        <div
          className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={porcentaje}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${limite.nombre}: ${limite.usado} de ${limite.limite}`}
        >
          <div
            className={`h-full rounded-full transition-all ${colorBarra}`}
            style={{ width: `${porcentaje}%` }}
          />
        </div>
      )}

      {/* El estado nunca queda sólo en el color de la barra. */}
      {nivel === "lleno" && (
        <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-danger">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {limite.blando ? "Llegaste al tope del plan" : "Límite alcanzado"}
        </p>
      )}
      {nivel === "cerca" && (
        <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-warning">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Cerca del límite
        </p>
      )}
      {limite.detalle && (
        <p className="mt-2 text-xs text-muted-foreground">{limite.detalle}</p>
      )}
    </>
  );
}
