"use client";

import { useState } from "react";
import type { PuntoGrafico } from "@/features/admin/lib/vista-finanzas";
import { formatearMoneda } from "@/shared/utils/formatters";
import { formatearUsd } from "@/features/admin/lib/cotizacion-mep";

/**
 * Ingresos y egresos, fijos y variables, mes a mes, con lo que se espera de
 * los meses que vienen.
 *
 * Arriba de la línea del cero, lo que entra (fijo abajo, variable arriba);
 * abajo, lo que sale. La línea blanca es el ganado ACUMULADO desde el primer
 * cobro, y sigue punteada hacia adelante con la previsión. Lo previsto se
 * dibuja con borde punteado y más tenue: no pasó todavía.
 *
 * La escala cubre barras Y líneas: un mes con pérdida o un acumulado negativo
 * tiene que verse, no salirse del dibujo.
 *
 * SVG a mano, como el resto de los gráficos del panel: son doce meses.
 */

const ANCHO = 760;
const ALTO = 300;
const MARGEN = { izq: 58, der: 10, arr: 14, abajo: 30 };

const COLOR = {
  ingresoFijo: "#34d399",
  ingresoVariable: "#38bdf8",
  egresoFijo: "#fb7185",
  egresoVariable: "#fbbf24",
  linea: "rgba(255,255,255,0.85)",
};

const compacto = new Intl.NumberFormat("es-AR", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export type MonedaVista = "ARS" | "USD";

export function FinanzasChart({
  puntos,
  moneda,
  mep,
}: Readonly<{
  puntos: PuntoGrafico[];
  moneda: MonedaVista;
  mep: number | null;
}>) {
  const [activo, setActivo] = useState<number | null>(null);

  // En dólares solo si hay cotización; si no, el padre ya no ofrece el botón.
  const aMoneda = (n: number) => (moneda === "USD" && mep ? n / mep : n);
  const dinero = (n: number) =>
    moneda === "USD" && mep ? formatearUsd(aMoneda(n)) : formatearMoneda(n);

  const lineas = puntos.flatMap((p) =>
    [p.acumulado, p.proyectado].filter((v): v is number => v !== null),
  );
  const arriba = puntos.map((p) => p.ingresosFijos + p.ingresosVariables + p.ingresosPrevistos);
  const abajo = puntos.map((p) => p.egresosFijos + p.egresosVariables + p.egresosPrevistos);

  const maxY = Math.max(0, ...arriba, ...lineas) * 1.1 || 1;
  const minY = Math.min(0, ...abajo.map((v) => -v), ...lineas) * 1.1;

  const anchoUtil = ANCHO - MARGEN.izq - MARGEN.der;
  const altoUtil = ALTO - MARGEN.arr - MARGEN.abajo;
  const banda = anchoUtil / Math.max(puntos.length, 1);
  const anchoBarra = Math.min(banda * 0.56, 38);

  const x = (i: number) => MARGEN.izq + banda * i + banda / 2;
  const y = (v: number) => MARGEN.arr + ((maxY - v) / (maxY - minY)) * altoUtil;
  const cero = y(0);

  const idxActual = puntos.findIndex((p) => p.esMesActual);
  const trazo = (clave: "acumulado" | "proyectado") =>
    puntos
      .map((p, i) => ({ v: p[clave], i }))
      .filter((q): q is { v: number; i: number } => q.v !== null)
      .map((q, k) => `${k === 0 ? "M" : "L"}${x(q.i).toFixed(1)},${y(q.v).toFixed(1)}`)
      .join(" ");

  const marcas = [maxY, 0, minY].filter((v, i, arr) => arr.indexOf(v) === i);

  const p = activo !== null ? puntos[activo] : null;

  return (
    <div className="relative">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        <Referencia color={COLOR.ingresoFijo} texto="Ingreso fijo" />
        <Referencia color={COLOR.ingresoVariable} texto="Ingreso variable" />
        <Referencia color={COLOR.egresoFijo} texto="Egreso fijo" />
        <Referencia color={COLOR.egresoVariable} texto="Egreso variable" />
        <span className="flex items-center gap-1.5 text-[11px] text-white/50">
          <span className="h-0.5 w-4 bg-white/85" /> Ganado acumulado
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-white/50">
          <span className="h-0 w-4 border-t-2 border-dashed border-white/60" /> Previsión
        </span>
      </div>

      <svg
        viewBox={`0 0 ${ANCHO} ${ALTO}`}
        className="h-auto w-full"
        role="img"
        aria-label="Ingresos y egresos por mes, con previsión"
        onMouseLeave={() => setActivo(null)}
      >
        {/* La zona de previsión, apenas más clara, desde el mes siguiente al actual. */}
        {idxActual >= 0 && idxActual < puntos.length - 1 && (
          <rect
            x={MARGEN.izq + banda * (idxActual + 1)}
            y={MARGEN.arr}
            width={banda * (puntos.length - idxActual - 1)}
            height={altoUtil}
            fill="rgba(255,255,255,0.03)"
          />
        )}

        {marcas.map((v) => (
          <g key={v}>
            <line
              x1={MARGEN.izq}
              x2={ANCHO - MARGEN.der}
              y1={y(v)}
              y2={y(v)}
              stroke="rgba(255,255,255,0.08)"
              strokeDasharray={v === 0 ? undefined : "3 4"}
            />
            <text x={MARGEN.izq - 8} y={y(v) + 3} textAnchor="end" fontSize="10" fill="rgba(255,255,255,0.4)">
              {compacto.format(aMoneda(v))}
            </text>
          </g>
        ))}
        <line x1={MARGEN.izq} x2={ANCHO - MARGEN.der} y1={cero} y2={cero} stroke="rgba(255,255,255,0.25)" />

        {puntos.map((pt, i) => {
          const bx = x(i) - anchoBarra / 2;
          // Pila hacia arriba: ingreso fijo, variable, previsto.
          const hFijo = y(0) - y(pt.ingresosFijos);
          const hVar = y(0) - y(pt.ingresosVariables);
          const hPrev = y(0) - y(pt.ingresosPrevistos);
          // Pila hacia abajo: egreso fijo, variable, previsto.
          const hEF = y(-pt.egresosFijos) - y(0);
          const hEV = y(-pt.egresosVariables) - y(0);
          const hEP = y(-pt.egresosPrevistos) - y(0);

          const topeFijo = cero - hFijo;
          const topeVar = topeFijo - hVar;
          const topeEF = cero + hEF;
          const topeEV = topeEF + hEV;

          return (
            <g key={pt.mes} opacity={activo === null || activo === i ? 1 : 0.55}>
              {hFijo > 0 && <rect x={bx} y={topeFijo} width={anchoBarra} height={hFijo} fill={COLOR.ingresoFijo} rx={2} />}
              {hVar > 0 && <rect x={bx} y={topeVar} width={anchoBarra} height={hVar} fill={COLOR.ingresoVariable} rx={2} />}
              {hPrev > 0 && (
                <rect
                  x={bx}
                  y={topeVar - hPrev}
                  width={anchoBarra}
                  height={hPrev}
                  fill={COLOR.ingresoFijo}
                  fillOpacity={0.22}
                  stroke={COLOR.ingresoFijo}
                  strokeDasharray="3 3"
                  rx={2}
                />
              )}
              {hEF > 0 && <rect x={bx} y={cero} width={anchoBarra} height={hEF} fill={COLOR.egresoFijo} rx={2} />}
              {hEV > 0 && <rect x={bx} y={topeEF} width={anchoBarra} height={hEV} fill={COLOR.egresoVariable} rx={2} />}
              {hEP > 0 && (
                <rect
                  x={bx}
                  y={topeEV}
                  width={anchoBarra}
                  height={hEP}
                  fill={COLOR.egresoFijo}
                  fillOpacity={0.22}
                  stroke={COLOR.egresoFijo}
                  strokeDasharray="3 3"
                  rx={2}
                />
              )}

              <text
                x={x(i)}
                y={ALTO - 10}
                textAnchor="middle"
                fontSize="10.5"
                fill={pt.esMesActual ? "#fff" : "rgba(255,255,255,0.45)"}
                fontWeight={pt.esMesActual ? 600 : 400}
              >
                {pt.etiqueta}
              </text>
            </g>
          );
        })}

        <path d={trazo("acumulado")} fill="none" stroke={COLOR.linea} strokeWidth={2} strokeLinejoin="round" />
        <path d={trazo("proyectado")} fill="none" stroke={COLOR.linea} strokeWidth={2} strokeDasharray="5 5" strokeLinejoin="round" opacity={0.7} />
        {puntos.map((pt, i) => {
          const v = pt.acumulado ?? pt.proyectado;
          return v === null ? null : (
            <circle key={pt.mes} cx={x(i)} cy={y(v)} r={pt.acumulado !== null ? 3 : 2.5} fill={pt.acumulado !== null ? "#fff" : "#18181b"} stroke={COLOR.linea} strokeWidth={1.5} />
          );
        })}

        {/* Una banda transparente por mes para el hover: el blanco de mouse es
            el mes entero, no la barra. */}
        {puntos.map((pt, i) => (
          <rect
            key={`h-${pt.mes}`}
            x={MARGEN.izq + banda * i}
            y={MARGEN.arr}
            width={banda}
            height={altoUtil + MARGEN.abajo}
            fill="transparent"
            onMouseEnter={() => setActivo(i)}
            onTouchStart={() => setActivo(i)}
          />
        ))}
      </svg>

      {p && activo !== null && (
        <div
          className="pointer-events-none absolute top-8 z-10 w-56 rounded-lg border border-white/10 bg-zinc-900/95 p-3 text-xs shadow-xl"
          style={{
            left: `${Math.min(Math.max(((x(activo) / ANCHO) * 100), 14), 86)}%`,
            transform: "translateX(-50%)",
          }}
        >
          <p className="mb-2 font-semibold text-white">
            {p.etiqueta}
            {p.esMesActual && <span className="ml-1.5 text-white/40">· este mes</span>}
          </p>
          <Fila color={COLOR.ingresoFijo} texto="Ingreso fijo" valor={dinero(p.ingresosFijos)} oculto={p.ingresosFijos === 0} />
          <Fila color={COLOR.ingresoVariable} texto="Ingreso variable" valor={dinero(p.ingresosVariables)} oculto={p.ingresosVariables === 0} />
          <Fila color={COLOR.ingresoFijo} texto="Por cobrar (previsto)" valor={dinero(p.ingresosPrevistos)} oculto={p.ingresosPrevistos === 0} />
          <Fila color={COLOR.egresoFijo} texto="Egreso fijo" valor={dinero(p.egresosFijos)} oculto={p.egresosFijos === 0} />
          <Fila color={COLOR.egresoVariable} texto="Egreso variable" valor={dinero(p.egresosVariables)} oculto={p.egresosVariables === 0} />
          <Fila color={COLOR.egresoFijo} texto="Egreso previsto" valor={dinero(p.egresosPrevistos)} oculto={p.egresosPrevistos === 0} />
          <div className="mt-2 border-t border-white/10 pt-2 text-white/80">
            {p.acumulado !== null && <p>Acumulado: <b>{dinero(p.acumulado)}</b></p>}
            {p.proyectado !== null && p.acumulado === null && <p>Acumulado previsto: <b>{dinero(p.proyectado)}</b></p>}
            {p.enRiesgo > 0 && <p className="mt-1 text-amber-300/90">En riesgo: {dinero(p.enRiesgo)} (planes vencidos)</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function Referencia({ color, texto }: Readonly<{ color: string; texto: string }>) {
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-white/50">
      <span className="size-2.5 rounded-sm" style={{ backgroundColor: color }} />
      {texto}
    </span>
  );
}

function Fila({
  color,
  texto,
  valor,
  oculto,
}: Readonly<{ color: string; texto: string; valor: string; oculto: boolean }>) {
  if (oculto) return null;
  return (
    <p className="flex items-center justify-between gap-2 py-0.5">
      <span className="flex items-center gap-1.5 text-white/60">
        <span className="size-2 rounded-sm" style={{ backgroundColor: color }} />
        {texto}
      </span>
      <span className="font-mono tabular-nums text-white/90">{valor}</span>
    </p>
  );
}
