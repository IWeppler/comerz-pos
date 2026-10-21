"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { TabsContent } from "@/shared/ui/tabs";
import {
  AlertTriangle,
  Calculator,
  CreditCard,
  Package,
  PiggyBank,
  Percent,
  Receipt,
  TrendingDown,
  Trophy,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { formatearMoneda } from "@/shared/utils/formatters";
import { ReportesMetrics } from "@/entities/reportes/types";

interface RentabilidadTabProps {
  metrics: ReportesMetrics;
  costoMercaderiaVendida: number;
}

/** Color por tipo de paso. La identidad va en la paleta de gráficos (`--viz-*`);
 * los de estado (verde/rojo) solo para el resultado, que es un estado. */
const COLOR_TONO = {
  ingresos: "var(--viz-1)",
  costo: "var(--muted-foreground)",
  bruta: "var(--foreground)",
  recargo: "var(--viz-3)",
  comision: "var(--viz-4)",
  gasto: "var(--viz-2)",
  neta: "var(--success)",
  perdida: "var(--danger)",
} as const;

type Tono = keyof typeof COLOR_TONO;

interface Paso {
  etiqueta: string;
  signo: "Menos" | "Más" | "Total";
  monto: number;
  /** En la escala de pesos: de dónde a dónde se mueve la barra. */
  desde: number;
  hasta: number;
  tono: Tono;
  Icono: LucideIcon;
}

export function RentabilidadTab({
  metrics,
  costoMercaderiaVendida,
}: Readonly<RentabilidadTabProps>) {
  const ingresos = metrics.ingresos;
  const brutaValor = metrics.gananciaBrutaVentas;
  const conRecargo = brutaValor + metrics.recargosCobrados;
  const conComision = conRecargo - metrics.totalComisiones;
  const neta = metrics.gananciaNeta;
  const enRojo = neta < 0;

  const pasos: Paso[] = [
    { etiqueta: "Ingresos por ventas", signo: "Total", monto: ingresos, desde: 0, hasta: ingresos, tono: "ingresos", Icono: Receipt },
    { etiqueta: "Costo de la mercadería", signo: "Menos", monto: costoMercaderiaVendida, desde: ingresos, hasta: brutaValor, tono: "costo", Icono: Package },
    { etiqueta: "Ganancia bruta", signo: "Total", monto: brutaValor, desde: 0, hasta: brutaValor, tono: brutaValor < 0 ? "perdida" : "bruta", Icono: Calculator },
    { etiqueta: "Recargos cobrados al cliente", signo: "Más", monto: metrics.recargosCobrados, desde: brutaValor, hasta: conRecargo, tono: "recargo", Icono: Percent },
    { etiqueta: "Comisiones de tarjetas y MP", signo: "Menos", monto: metrics.totalComisiones, desde: conRecargo, hasta: conComision, tono: "comision", Icono: CreditCard },
    { etiqueta: "Gastos operativos", signo: "Menos", monto: metrics.totalEgresos, desde: conComision, hasta: neta, tono: "gasto", Icono: Wallet },
    { etiqueta: "Resultado operativo", signo: "Total", monto: neta, desde: 0, hasta: neta, tono: enRojo ? "perdida" : "neta", Icono: enRojo ? TrendingDown : PiggyBank },
  ];

  // Escala común: todas las barras comparten el mismo 100% (la venta total o
  // el pico del recorrido si supera la venta).
  const escala = Math.max(ingresos, conRecargo, 1);
  const pct = (v: number) => Math.min(Math.max((v / escala) * 100, 0), 100);

  return (
    <TabsContent
      value="rentabilidad"
      className="space-y-6 outline-none animate-in fade-in-50 pt-2"
    >
      {/* ── DE LA VENTA A LA GANANCIA: cascada ── */}
      <Card className="border-border shadow-none">
        <CardHeader>
          <CardTitle className="text-lg">De la venta a la ganancia</CardTitle>
          <p className="text-sm text-muted-foreground">
            Cada barra muestra cuánto suma o resta ese paso sobre lo vendido. El resultado incluye los gastos cargados en caja y las comisiones. No descuenta impuestos, ni sueldos o retiros que no se hayan cargado como gasto.
          </p>
        </CardHeader>
        <CardContent>
          <ol className="flex flex-col gap-4">
            {pasos.map((p) => {
              const inicio = pct(Math.min(p.desde, p.hasta));
              const ancho = Math.max(pct(Math.max(p.desde, p.hasta)) - inicio, 0.5);
              const esTotal = p.signo === "Total";
              const color = COLOR_TONO[p.tono];
              return (
                <li key={p.etiqueta} className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 sm:grid-cols-[minmax(0,13rem)_1fr_auto] sm:items-center">
                  <div className="flex min-w-0 items-center gap-2.5 sm:col-span-1">
                    <span
                      className="flex size-8 shrink-0 items-center justify-center rounded-lg"
                      style={{ background: `color-mix(in oklab, ${color} 14%, transparent)`, color }}
                    >
                      <p.Icono className="size-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <p className={`break-words text-sm leading-snug ${esTotal ? "font-semibold text-foreground" : "text-foreground"}`}>
                        {p.etiqueta}
                      </p>
                      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        {p.signo}
                      </p>
                    </div>
                  </div>
                  <div className="relative col-span-2 h-3 w-full rounded-full bg-muted/60 sm:col-span-1">
                    <div
                      role="img"
                      aria-label={`${p.etiqueta}: ${p.signo === "Menos" ? "resta" : p.signo === "Más" ? "suma" : "total"} ${formatearMoneda(Math.abs(p.monto))}`}
                      className="absolute top-0 h-full rounded-full transition-[left,width] duration-500 ease-out"
                      style={{ left: `${inicio}%`, width: `${ancho}%`, background: color }}
                    />
                  </div>
                  <span className={`text-right text-sm tabular-nums sm:w-28 ${esTotal ? "font-semibold" : ""} ${p.tono === "perdida" ? "text-danger" : "text-foreground"}`}>
                    {p.tono === "perdida" && p.monto < 0 ? "Pierde " : ""}
                    {formatearMoneda(Math.abs(p.monto))}
                  </span>
                </li>
              );
            })}
          </ol>

          {metrics.coberturaCosto != null ? (
            <p className={`mt-5 text-sm ${metrics.coberturaCosto < 95 ? "text-warning" : "text-muted-foreground"}`}>
              Costo cargado en <span className="font-semibold tabular-nums">{metrics.coberturaCosto}%</span> de lo vendido.
              {metrics.coberturaCosto < 95
                ? " Lo que no tiene costo cuenta como margen completo: cargá el costo de los productos que lo necesitan para que el margen sea real."
                : ""}
            </p>
          ) : null}

          {enRojo ? (
            <p className="mt-5 flex items-start gap-2 rounded-lg bg-danger-subtle px-3 py-2 text-sm text-danger">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              El período cerró en pérdida: los gastos y comisiones superaron la ganancia bruta más los recargos.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <MargenPorCategoria
        ganancias={metrics.rentabilidadPorCategoria}
        ventasPorCategoria={metrics.ventasPorCategoria}
      />

      {/* ── PRODUCTOS ── */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <Card className="border-border shadow-none">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Trophy className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
              Los que más dejan
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {metrics.topProductosRentables.length > 0 ? (
              <ol className="divide-y divide-border">
                {metrics.topProductosRentables.slice(0, 5).map((producto, idx) => (
                  <li key={idx} className="flex items-center justify-between gap-3 px-6 py-3">
                    <span className="min-w-0 break-words text-sm font-medium text-foreground">
                      {idx + 1}. {producto.nombre}
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums text-foreground">
                      {formatearMoneda(producto.ganancia)}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="p-8 text-center text-sm text-muted-foreground">Sin datos.</p>
            )}
          </CardContent>
        </Card>

        <Card className="border-border shadow-none">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
              Los que menos dejan
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {metrics.peoresProductosRentables && metrics.peoresProductosRentables.length > 0 ? (
              <ol className="divide-y divide-border">
                {metrics.peoresProductosRentables.map((producto, idx) => (
                  <li key={idx} className="flex items-center justify-between gap-3 px-6 py-3">
                    <span className="min-w-0 break-words text-sm text-foreground">
                      {producto.nombre}
                    </span>
                    {producto.ganancia < 0 ? (
                      <span className="shrink-0 text-sm font-semibold tabular-nums text-danger">
                        Pierde {formatearMoneda(Math.abs(producto.ganancia))}
                      </span>
                    ) : (
                      <span className="shrink-0 font-semibold tabular-nums text-foreground">
                        {formatearMoneda(producto.ganancia)}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="p-8 text-center text-sm text-muted-foreground">Sin datos.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </TabsContent>
  );
}

/**
 * Margen por categoría en barra 100%: la parte gris es lo que costó la
 * mercadería y la azul es la ganancia. Así el margen se ve, no hay que
 * leerlo como porcentaje. Una categoría que pierde llena la barra de costo y
 * dice cuánto perdió.
 */
function MargenPorCategoria({
  ganancias,
  ventasPorCategoria,
}: Readonly<{
  ganancias: { label: string; value: number }[];
  ventasPorCategoria: { label: string; ingresos: number }[];
}>) {
  const ingresosPorCategoria = new Map(
    ventasPorCategoria.map((c) => [c.label, c.ingresos]),
  );
  const filas = ganancias
    .map((g) => {
      const ingresos = ingresosPorCategoria.get(g.label) ?? 0;
      return { label: g.label, ganancia: g.value, ingresos };
    })
    .filter((f) => f.ingresos > 0)
    // Mayor margen arriba. Se ordena por porcentaje, no por pesos: una categoría
    // que deja poco en plata pero casi todo de lo que vende, va primero.
    .sort((a, b) => b.ganancia / b.ingresos - a.ganancia / a.ingresos)
    .slice(0, 10);

  return (
    <Card className="border-border shadow-none">
      <CardHeader>
        <CardTitle className="text-lg">Margen por categoría</CardTitle>
        <div className="flex flex-wrap items-center gap-4 pt-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-muted-foreground" aria-hidden="true" /> Costo
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-primary" aria-hidden="true" /> Ganancia
          </span>
        </div>
      </CardHeader>
      <CardContent>
        {filas.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Sin datos en este período.</p>
        ) : (
          <ol className="flex flex-col gap-4">
            {filas.map((f) => {
              const pierde = f.ganancia < 0;
              const gananciaPct = pierde ? 0 : Math.min((f.ganancia / f.ingresos) * 100, 100);
              const margenTexto = Math.round((f.ganancia / f.ingresos) * 100);
              return (
                <li key={f.label} className="flex flex-col gap-1.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 break-words text-sm font-medium text-foreground">{f.label}</span>
                    {pierde ? (
                      <span className="shrink-0 text-sm font-semibold tabular-nums text-danger">
                        Pierde {formatearMoneda(Math.abs(f.ganancia))}
                      </span>
                    ) : (
                      <span className="shrink-0 text-sm tabular-nums">
                        <span className="font-semibold text-foreground">{formatearMoneda(f.ganancia)}</span>
                        <span className="ml-1.5 text-xs text-muted-foreground">{margenTexto}%</span>
                      </span>
                    )}
                  </div>
                  <div
                    role="img"
                    aria-label={
                      pierde
                        ? `${f.label}: pierde ${formatearMoneda(Math.abs(f.ganancia))}`
                        : `${f.label}: ganancia ${formatearMoneda(f.ganancia)}, margen ${margenTexto}%`
                    }
                    className="flex h-3 w-full overflow-hidden rounded-full bg-muted-foreground/25"
                  >
                    <div className="h-full bg-primary transition-[width] duration-500 ease-out" style={{ width: `${gananciaPct}%` }} />
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
