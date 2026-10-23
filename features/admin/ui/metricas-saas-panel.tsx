"use client";

import type { MetricaConMotivo } from "@/features/admin/lib/metricas-saas";
import { formatearMoneda } from "@/shared/utils/formatters";

/**
 * Una métrica que puede no existir todavía.
 *
 * Cuando no hay número muestra "—" y el motivo, en vez del valor que saldría
 * de la cuenta. Con 4 comercios, un churn de 25% mensual es aritmética
 * correcta y estadística sin sentido —proyectado dice que el negocio se
 * termina en cuatro meses— y un número así, puesto en un tablero, termina
 * siendo una decisión.
 */
function Metrica({
  titulo,
  metrica,
  formato = "moneda",
  detalle,
}: Readonly<{
  titulo: string;
  metrica: MetricaConMotivo;
  formato?: "moneda" | "porcentaje";
  detalle?: string;
}>) {
  const hay = metrica.valor !== null;

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
      <p className="text-[10px] font-medium uppercase tracking-wider text-white/35">
        {titulo}
      </p>
      <p
        className={`mt-1 text-xl font-semibold ${hay ? "text-white" : "text-white/25"}`}
      >
        {hay
          ? formato === "moneda"
            ? formatearMoneda(metrica.valor!)
            : `${metrica.valor!.toFixed(1)}%`
          : "—"}
      </p>
      <p className="mt-1 text-[11px] leading-snug text-white/35">
        {hay ? (detalle ?? "") : metrica.motivo}
      </p>
    </div>
  );
}

export function MetricasSaasPanel({
  arpu,
  churn,
  ltv,
}: Readonly<{
  arpu: MetricaConMotivo;
  churn: MetricaConMotivo;
  ltv: MetricaConMotivo;
}>) {
  // Solo ARPU, churn y LTV. Lo ganado del mes está arriba (PanelFinanzas) y los
  // gastos tienen su propio bloque, con su lista editable: ver GastosDelMes.
  return (
      <div className="grid gap-3 sm:grid-cols-3">
        <Metrica
          titulo="ARPU"
          metrica={arpu}
          detalle="Cobrado este mes por comercio activo"
        />
        <Metrica
          titulo="Churn mensual"
          metrica={churn}
          formato="porcentaje"
          detalle="Bajas sobre los activos al empezar el mes"
        />
        <Metrica
          titulo="LTV"
          metrica={ltv}
          detalle="Lo que deja un comercio en toda su vida"
        />
      </div>
  );
}
