"use client";

import { useState } from "react";
import type { VistaFinanzas } from "@/features/admin/lib/vista-finanzas";
import type { CotizacionMep } from "@/features/admin/lib/cotizacion-mep";
import { formatearUsd } from "@/features/admin/lib/cotizacion-mep";
import { formatearMoneda } from "@/shared/utils/formatters";
import { FinanzasChart, type MonedaVista } from "./finanzas-chart";

export interface MetricasRapidas {
  mrr: number;
  activos: number;
  enPrueba: number;
  suspendidos: number;
}

/**
 * Los números del mes a un lado y el gráfico con la previsión al otro.
 *
 * "Ganado" es ingresos menos egresos del mes: lo que entró menos lo que salió.
 * Antes el número grande era solo lo cobrado, y mirar eso solo hacía parecer
 * que el negocio iba mejor de lo que iba (ver docs/finanzas-comerz.md).
 *
 * El botón de dólares solo existe si hay cotización: sin MEP no se convierte
 * nada, y se avisa en vez de inventar un número.
 */
export function PanelFinanzas({
  vista,
  mep,
  metricas,
}: Readonly<{
  vista: VistaFinanzas;
  mep: CotizacionMep | null;
  metricas: MetricasRapidas;
}>) {
  const [moneda, setMoneda] = useState<MonedaVista>("ARS");
  const cotizacion = mep?.venta ?? null;
  const enUsd = moneda === "USD" && cotizacion !== null;

  const dinero = (n: number) =>
    enUsd && cotizacion ? formatearUsd(n / cotizacion) : formatearMoneda(n);

  const { mesActual, mesAnterior } = vista;
  const ganado = mesActual.ganado;
  const delta = mesAnterior ? ganado - mesAnterior.ganado : null;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.9fr)] xl:items-stretch">
      {/* ── KPIs ── */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs font-medium uppercase tracking-wider text-white/40">
            Ganado este mes
          </p>
          {cotizacion !== null && (
            <div className="flex shrink-0 rounded-lg border border-white/10 p-0.5 text-[11px]">
              {(["ARS", "USD"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMoneda(m)}
                  aria-pressed={moneda === m}
                  className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                    moneda === m
                      ? "bg-white/15 text-white"
                      : "text-white/45 hover:text-white/80"
                  }`}
                >
                  {m === "ARS" ? "$" : "US$"}
                </button>
              ))}
            </div>
          )}
        </div>

        <p
          className={`mt-1 text-4xl font-semibold tracking-tight ${
            ganado < 0 ? "text-rose-400" : "text-white"
          }`}
        >
          {dinero(ganado)}
        </p>
        {delta !== null && (
          <p
            className={`mt-1 text-xs font-medium ${delta >= 0 ? "text-emerald-400" : "text-rose-400"}`}
          >
            {delta >= 0 ? "▲" : "▼"} {dinero(Math.abs(delta))} vs. el mes pasado
          </p>
        )}

        <div className="mt-5 grid grid-cols-2 gap-3">
          <Bloque
            titulo="Ingresos"
            total={dinero(mesActual.ingresos)}
            lineas={[
              ["Fijos", dinero(mesActual.ingresosFijos), "#34d399"],
              ["Variables", dinero(mesActual.ingresosVariables), "#38bdf8"],
            ]}
          />
          <Bloque
            titulo="Egresos"
            total={dinero(mesActual.egresos)}
            lineas={[
              ["Fijos", dinero(mesActual.egresosFijos), "#fb7185"],
              ["Variables", dinero(mesActual.egresosVariables), "#fbbf24"],
            ]}
          />
        </div>

        <dl className="mt-5 space-y-3 border-t border-white/10 pt-4">
          <Dato
            titulo="Acumulado"
            detalle="ingresos − egresos desde el primer cobro"
            valor={dinero(vista.acumuladoHoy)}
          />
          <Dato
            titulo="Mes que viene"
            detalle="renovaciones al día − gastos fijos"
            valor={
              vista.netoProximoMes === null ? "—" : dinero(vista.netoProximoMes)
            }
          />
          {vista.enRiesgo > 0 && (
            <Dato
              titulo="En riesgo"
              detalle="planes vencidos: no cuenta como ingreso"
              valor={dinero(vista.enRiesgo)}
              alerta
            />
          )}
          <Dato
            titulo="MRR teórico"
            detalle={`${metricas.activos} activos · ${metricas.enPrueba} en prueba${
              metricas.suspendidos > 0
                ? ` · ${metricas.suspendidos} suspendidos`
                : ""
            }`}
            valor={dinero(metricas.mrr)}
          />
        </dl>

        {vista.sinFecha > 0 && (
          <p className="mt-4 text-[11px] leading-snug text-amber-300/80">
            {vista.sinFecha === 1
              ? "1 comercio activo no tiene fecha de vencimiento"
              : `${vista.sinFecha} comercios activos no tienen fecha de vencimiento`}
            : no entra en la previsión.
          </p>
        )}

        <p className="mt-4 text-[11px] leading-snug text-white/30">
          {mep === null
            ? "Sin cotización del dólar MEP ahora: solo pesos."
            : `MEP $${mep.venta.toLocaleString("es-AR", { maximumFractionDigits: 2 })} · ${new Date(mep.fecha).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", timeZone: "America/Argentina/Buenos_Aires" })}${mep.vieja ? " · desactualizada" : ""}`}
        </p>
      </div>

      {/* ── Gráfico ── */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
        <div className="mb-4">
          <p className="text-sm font-semibold text-white/90">
            Ingresos, egresos y previsión
          </p>
        </div>
        <FinanzasChart puntos={vista.puntos} moneda={moneda} mep={cotizacion} />
      </div>
    </div>
  );
}

function Bloque({
  titulo,
  total,
  lineas,
}: Readonly<{
  titulo: string;
  total: string;
  lineas: [string, string, string][];
}>) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
      <p className="text-[10px] font-medium uppercase tracking-wider text-white/35">
        {titulo}
      </p>
      <p className="mt-0.5 text-lg font-semibold text-white/90">{total}</p>
      <ul className="mt-2 space-y-1">
        {lineas.map(([nombre, valor, color]) => (
          <li
            key={nombre}
            className="flex items-center justify-between gap-2 text-[11px] text-white/50"
          >
            <span className="flex items-center gap-1.5">
              <span
                className="size-2 rounded-sm"
                style={{ backgroundColor: color }}
              />
              {nombre}
            </span>
            <span className="font-mono tabular-nums text-white/70">
              {valor}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Dato({
  titulo,
  detalle,
  valor,
  alerta,
}: Readonly<{
  titulo: string;
  detalle: string;
  valor: string;
  alerta?: boolean;
}>) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <div className="min-w-0">
        <dt className="text-xs font-medium text-white/70">{titulo}</dt>
        <dd className="text-[11px] leading-snug text-white/30">{detalle}</dd>
      </div>
      <span
        className={`shrink-0 font-mono text-sm tabular-nums ${alerta ? "text-amber-300" : "text-white/90"}`}
      >
        {valor}
      </span>
    </div>
  );
}
