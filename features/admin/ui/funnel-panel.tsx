import { AlertTriangle } from "lucide-react";
import {
  SIN_ORIGEN,
  type ComercioEnFunnel,
  type FilaPorOrigen,
  type ResumenFunnel,
} from "@/features/admin/lib/funnel";

/**
 * Registro → activación → pago, y quién se está yendo.
 *
 * Server Component: son cuentas sobre datos que ya vienen resueltos, no hay
 * nada que el navegador tenga que hacer acá.
 *
 * ACTIVADO = vendió alguna vez. En un POS es la única definición que significa
 * algo: el producto sirve para vender, y quien nunca vendió nunca lo usó.
 */
export function FunnelPanel({
  resumen,
  riesgo,
  origenes,
}: Readonly<{
  resumen: ResumenFunnel;
  riesgo: ComercioEnFunnel[];
  origenes: FilaPorOrigen[];
}>) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-white/90">
          Registro → activación → pago
        </h2>
        <p className="text-xs text-white/40">
          Activado = vendió alguna vez.
          {resumen.migrados > 0 &&
            ` ${resumen.migrados} vienen migrados de otro sistema y no cuentan para el tiempo de activación.`}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Paso
          titulo="Registrados"
          valor={String(resumen.registrados)}
          detalle="Comercios creados"
        />
        <Paso
          titulo="Activados"
          valor={String(resumen.activados)}
          detalle={
            resumen.tasaActivacion !== null
              ? `${resumen.tasaActivacion.toFixed(0)}% de los registrados`
              : "Sin registrados todavía"
          }
        />
        <Paso
          titulo="Pagaron"
          valor={String(resumen.pagaron)}
          detalle={
            resumen.tasaPago !== null
              ? // Sobre los ACTIVADOS: mezclar a los que nunca lo probaron
                // esconde si el problema es el producto o el precio.
                `${resumen.tasaPago.toFixed(0)}% de los que activaron`
              : "Nadie activó todavía"
          }
        />
        <Paso
          titulo="Tiempo de activación"
          valor={
            resumen.medianaDiasActivacion !== null
              ? `${resumen.medianaDiasActivacion} d`
              : "—"
          }
          detalle={
            resumen.medianaDiasActivacion !== null
              ? "Mediana del alta a la primera venta"
              : "Ninguna alta nueva vendió todavía"
          }
        />
      </div>

      {/* Por origen: de dónde vienen y cuáles de esos canales terminan
          pagando. Solo cuando hay algo medido: con todo en "Sin dato" la
          tabla no dice nada. */}
      {origenes.some((o) => o.etiqueta !== SIN_ORIGEN) && (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <p className="text-sm font-semibold text-white/90">Por origen</p>
          <ul className="mt-3 divide-y divide-white/[0.06]">
            {origenes.map((o) => (
              <li
                key={o.etiqueta}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2"
              >
                <span
                  className={`text-sm ${o.etiqueta === SIN_ORIGEN ? "text-white/40" : "text-white/80"}`}
                >
                  {o.etiqueta}
                </span>
                <span className="text-xs tabular-nums text-white/50">
                  {o.registrados} {o.registrados === 1 ? "alta" : "altas"} ·{" "}
                  {o.activados} vendieron · {o.pagaron} pagaron
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* El indicador ADELANTADO. El churn avisa cuando ya perdiste al
          cliente; esto avisa mientras todavía se puede llamar. */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <div className="flex items-center gap-2">
          <AlertTriangle
            className={`size-4 ${riesgo.length > 0 ? "text-amber-400" : "text-white/25"}`}
          />
          <p className="text-sm font-semibold text-white/90">
            En riesgo{riesgo.length > 0 && ` (${riesgo.length})`}
          </p>
        </div>

        {riesgo.length === 0 ? (
          <p className="mt-2 text-xs text-white/30">
            Todos los comercios vendieron en las últimas dos semanas.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-white/[0.06]">
            {riesgo.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2"
              >
                <span className="text-sm text-white/80">{c.nombre}</span>
                <span
                  className={`text-xs ${
                    c.activado ? "text-amber-400/80" : "text-rose-400"
                  }`}
                >
                  {c.activado
                    ? `${c.diasSinVender} días sin vender`
                    : `Nunca vendió · alta hace ${diasDesde(c.alta)} días`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function diasDesde(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

function Paso({
  titulo,
  valor,
  detalle,
}: Readonly<{ titulo: string; valor: string; detalle: string }>) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
      <p className="text-[10px] font-medium uppercase tracking-wider text-white/35">
        {titulo}
      </p>
      <p className="mt-1 text-xl font-semibold text-white">{valor}</p>
      <p className="mt-1 text-[11px] leading-snug text-white/35">{detalle}</p>
    </div>
  );
}
